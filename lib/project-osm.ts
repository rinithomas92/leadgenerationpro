// OpenStreetMap (Overpass) and Wikidata queries for custom lead projects.
// Pure: builds queries from a segment's tag sets and maps responses to leads.
// The Gloss query builders in discovery-engine.ts are not used or changed.
import { distanceKm, regionsQuery } from "./discovery-engine.ts";
import { now, safeUrl, type Campaign, type Lead } from "./leadgen.ts";
import { projectLead } from "./project.ts";
import { readable, socialFields } from "./project-sources.ts";
import type { Tier } from "./project-schema.ts";

/** One OSM tag filter, e.g. { key: "office", values: ["architect"] }, for one category. */
export type TagSet = { key: string; values: string[]; category: string };
export type OsmArea =
  | { kind: "around"; lat: number; lon: number; m: number }
  | { kind: "area"; areaId: number };
export type OsmQuery = {
  tags: TagSet[];
  include?: string[];
  exclude?: string[];
  area: OsmArea;
  // Nearer tiers, subtracted so each place belongs to one tier.
  excludeAreas?: OsmArea[];
};

const keyRe = /^[a-z][a-z0-9_:]{0,40}$/;
const valueRe = /^[a-zA-Z0-9_;:. -]{1,60}$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
/** Rejects anything that is not a plain tag key/value, so no query text can be injected. */
export function validTags(tags: TagSet[]) {
  return tags.filter((t) => keyRe.test(t.key) && t.values.length && t.values.every((v) => valueRe.test(v)));
}
const target = (a: OsmArea, set: string) =>
  a.kind === "around" ? `(around:${Math.round(a.m)},${a.lat},${a.lon})` : `(area.${set})`;

/** Overpass QL for a segment in one area; `count` returns only the number of matches. */
export function osmQuery(q: OsmQuery, count = false) {
  const tags = validTags(q.tags);
  if (!tags.length) throw new Error("No OpenStreetMap tags are known for these categories.");
  const timeout = q.area.kind === "area" ? 90 : 45;
  const name =
    (q.include?.length ? `["name"~"${q.include.map(escapeRe).join("|")}",i]` : "") +
    (q.exclude?.length ? `["name"!~"${q.exclude.map(escapeRe).join("|")}",i]` : "");
  const areas = [q.area, ...(q.excludeAreas ?? [])];
  const head = areas.map((a, i) => (a.kind === "area" ? `area(${a.areaId})->.a${i};` : "")).join("");
  const select = (a: OsmArea, i: number, out: string) =>
    "(" + tags.map((t) => `nwr["${t.key}"~"^(${t.values.map(escapeRe).join("|")})$"]["name"]${name}${target(a, `a${i}`)};`).join("") + `)->.${out};`;
  let body = select(q.area, 0, "r");
  (q.excludeAreas ?? []).forEach((a, i) => {
    body += select(a, i + 1, `x${i}`) + `(.r; - .x${i};)->.r;`;
  });
  return `[out:json][timeout:${timeout}];${head}${body}.r out ${count ? "count" : "tags center"};`;
}
/** Elements by id (e.g. ["node/1", "way/2"]), for re-checking leads already found. */
export function osmIdsQuery(ids: string[]) {
  const by: Record<string, number[]> = { node: [], way: [], relation: [] };
  for (const id of ids) {
    const m = /^(node|way|relation)\/(\d{1,15})$/.exec(id);
    if (m) by[m[1]].push(Number(m[2]));
  }
  const parts = Object.entries(by).filter(([, v]) => v.length).map(([t, v]) => `${t}(id:${v.join(",")});`);
  if (!parts.length) throw new Error("No OpenStreetMap ids to look up.");
  return `[out:json][timeout:60];(${parts.join("")});out tags center;`;
}
/** Sub-areas used to split a state (districts) or a country (states) into smaller queries. */
export function subAreasQuery(areaId: number, adminLevel: 4 | 5) {
  return adminLevel === 4
    ? regionsQuery(areaId)
    : `[out:json][timeout:30];area(${areaId})->.p;rel(area.p)["boundary"="administrative"]["admin_level"="5"];out tags center;`;
}
export function countFrom(elements: { type?: string; tags?: Record<string, string> }[]) {
  const c = elements.find((e) => e.type === "count");
  return Number(c?.tags?.total ?? 0);
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
const first = (...values: (string | undefined)[]) => (values.find((v) => v && v.trim()) || "").split(";")[0].trim().slice(0, 300);
const handleUrl = (host: string, prefix: string, raw?: string) => {
  const v = (raw || "").split(";")[0].trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  return /^[\w.-]{1,100}$/.test(h) ? `https://www.${host}/${prefix}${h}` : "";
};
/** OSM marks closed places with lifecycle tags; they are skipped and counted. */
export function isClosed(t: Record<string, string>) {
  return t.disused === "yes" || t.abandoned === "yes" || t.opening_hours === "closed" || t["closed"] === "yes" || /^(vacant|disused)$/.test(t.shop || "");
}
export type OsmMapped = { leads: Lead[]; closed: number; noChannel: number };
/** Maps Overpass elements to project leads (only those with a reach-out channel). */
export function osmProjectLeads(
  campaign: Campaign,
  elements: OsmElement[],
  where: { tier: Tier; segmentId: string; tags: TagSet[]; base?: { lat: number; lon: number }; country?: string },
): OsmMapped {
  let closed = 0, noChannel = 0;
  const leads: Lead[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    const t = e.tags;
    if (!t?.name || !["node", "way", "relation"].includes(e.type) || !Number.isSafeInteger(e.id) || seen.has(e.type + e.id)) continue;
    seen.add(e.type + e.id);
    if (isClosed(t)) {
      closed++;
      continue;
    }
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : undefined);
    const match = where.tags.find((s) => s.values.includes(t[s.key]));
    const creator = socialFields(
      [
        handleUrl("instagram.com", "", first(t["contact:instagram"], t.instagram)),
        handleUrl("facebook.com", "", first(t["contact:facebook"], t.facebook)),
        handleUrl("linkedin.com", "company/", first(t["contact:linkedin"], t.linkedin)),
        handleUrl("youtube.com", "@", first(t["contact:youtube"], t.youtube)),
        handleUrl("tiktok.com", "@", first(t["contact:tiktok"], t.tiktok)),
      ].filter(Boolean),
    );
    const website = safeUrl(first(t["contact:website"], t.website, t.url));
    const email = first(t["contact:email"], t.email);
    const phone = [t["contact:phone"], t.phone, t["contact:mobile"], t.mobile, t["contact:whatsapp"]].filter(Boolean).join("; ");
    if (!website && !email && !phone && !creator) {
      noChannel++;
      continue;
    }
    const verified = first(t.check_date, t["survey:date"]);
    const locality = first(t["addr:suburb"], t["addr:neighbourhood"], t["addr:quarter"]);
    const city = first(t["addr:city"], t["addr:district"]);
    const lead = projectLead(campaign, {
      name: t.name,
      segmentId: where.segmentId,
      tier: where.tier,
      source: {
        name: "OpenStreetMap",
        id: `osm:${e.type}/${e.id}`,
        url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        label: "OpenStreetMap contributors (ODbL) · public map data",
      },
      category: readable(match?.category || ""),
      location: [locality, city, first(t["addr:state"])].filter(Boolean).join(", "),
      website,
      email,
      phone,
      creator: creator ?? undefined,
      sourceVerifiedAt: /^\d{4}-\d{2}(-\d{2})?$/.test(verified) ? verified : "",
      project: {
        categories: match ? [match.category] : [],
        address: [first(t["addr:housenumber"]), first(t["addr:street"]), locality, city, first(t["addr:postcode"])].filter(Boolean).join(", "),
        locality,
        city,
        region: first(t["addr:state"]),
        country: first(t["addr:country"]) || where.country || "",
        lat: at?.lat ?? null,
        lon: at?.lon ?? null,
        distanceKm: at && where.base ? Math.round(distanceKm(where.base, at) * 10) / 10 : null,
      },
    });
    leads.push(lead);
  }
  return { leads, closed, noChannel };
}

// ---------- Wikidata (segments that map to occupations) ----------
export const WIKIDATA_PROJECT_PAGE = 1000;
/**
 * Notable people or organisations with an occupation (P106) in the list and at
 * least one published channel, for one country (citizenship) or, for the
 * Global tier, a chosen foreign country. Paged by item number.
 */
export function wikidataProjectQuery(occupations: string[], countryQid: string, after = 0) {
  const ids = occupations.filter((q) => /^Q\d+$/.test(q));
  if (!ids.length || !/^Q\d+$/.test(countryQid)) throw new Error("No Wikidata occupations or country for this segment.");
  return `SELECT ?p ?num ?name ?ig ?yt ?tt ?fb ?li ?web ?place WHERE {
  { SELECT DISTINCT ?p ?num WHERE {
    VALUES ?occ { ${ids.map((q) => `wd:${q}`).join(" ")} }
    ?p wdt:P106 ?occ ; wdt:P27 wd:${countryQid} .
    FILTER EXISTS { ?p wdt:P2003|wdt:P2397|wdt:P7085|wdt:P2013|wdt:P6634|wdt:P856 [] }
    FILTER NOT EXISTS { ?p wdt:P570 [] }
    BIND(xsd:integer(STRAFTER(STR(?p), "entity/Q")) AS ?num)
    FILTER(?num > ${Math.max(0, Math.floor(after))})
  } ORDER BY ?num LIMIT ${WIKIDATA_PROJECT_PAGE} }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?p rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  BIND(COALESCE(?en, ?mul) AS ?name)
  OPTIONAL { ?p wdt:P2003 ?ig } OPTIONAL { ?p wdt:P2397 ?yt } OPTIONAL { ?p wdt:P7085 ?tt }
  OPTIONAL { ?p wdt:P2013 ?fb } OPTIONAL { ?p wdt:P6634 ?li } OPTIONAL { ?p wdt:P856 ?web }
  OPTIONAL { ?p wdt:P551|wdt:P19|wdt:P937 ?place }
}`;
}
type Binding = Record<string, { value: string } | undefined>;
/** Maps classified Wikidata rows (see classifyCandidates) to project leads. */
export function wikidataProjectLeads(campaign: Campaign, rows: Binding[], where: { tier: Tier; segmentId: string; category: string; country?: string }) {
  const people = new Map<string, Binding[]>();
  for (const r of rows) {
    const id = r.p?.value.split("/").pop();
    if (id && /^Q\d+$/.test(id)) people.set(id, [...(people.get(id) ?? []), r]);
  }
  const leads: Lead[] = [];
  let invalid = 0;
  for (const [id, list] of people) {
    const v = (k: string) => list.map((r) => r[k]?.value).find(Boolean) || "";
    const name = v("pLabel") || v("name");
    const creator = socialFields(
      [
        v("ig") && /^[\w.]{1,30}$/.test(v("ig")) ? `https://www.instagram.com/${v("ig")}/` : "",
        /^UC[\w-]{22}$/.test(v("yt")) ? `https://www.youtube.com/channel/${v("yt")}` : "",
        /^[\w.]{1,40}$/.test(v("tt")) ? `https://www.tiktok.com/@${v("tt")}` : "",
        /^[\w.-]{1,100}$/.test(v("fb")) ? `https://www.facebook.com/${v("fb")}` : "",
        /^[\p{L}\p{N}_-]{1,100}$/u.test(v("li")) ? `https://www.linkedin.com/in/${encodeURIComponent(v("li"))}/` : "",
      ].filter(Boolean),
    );
    const website = safeUrl(v("web"));
    if (!name || /^Q\d+$/.test(name) || (!creator && !website)) {
      invalid++;
      continue;
    }
    leads.push({
      ...projectLead(campaign, {
        name,
        segmentId: where.segmentId,
        tier: where.tier,
        source: { name: "Wikidata", id: `wd:${id}`, url: `https://www.wikidata.org/wiki/${id}`, label: "Wikidata (CC0) · public identifiers" },
        category: readable(where.category),
        location: [v("placeLabel"), v("countryLabel")].filter((x, i, a) => x && a.indexOf(x) === i).join(", "),
        website,
        creator: creator ?? undefined,
        project: { categories: [where.category], city: v("placeLabel"), country: where.country ?? "" },
      }),
      history: [{ at: now(), event: "Discovered via Wikidata" }],
    });
  }
  return { leads, invalid };
}
