// Tiered lead discovery over permitted public sources. This module is pure:
// it builds queries and maps responses. Network access lives in discovery-net.ts.
//
// Priority: locality (if given) → city → state → country → global.
// Sources (open, no API keys):
//   - OpenStreetMap (Overpass API, ODbL): businesses such as salons and studios.
//   - Wikidata (SPARQL, CC0): notable people with published social identifiers.
// Instagram, TikTok, LinkedIn and Facebook offer no permitted public search,
// so they are reported as unavailable instead of being scraped.
// Nothing is capped: every record with at least one reach-out channel is kept.
import {
  assessFit,
  deduplicate,
  localDate,
  normalizeHandle,
  now,
  profileKey,
  safeUrl,
  uid,
  type Campaign,
  type DiscoveryReport,
  type Lead,
  type Scope,
} from "./leadgen.ts";
import {
  allowedPartnerships,
  emptyCreator,
  glossConfig,
  isGloss,
  newCreatorLead,
  profileUrl,
  scoreLead,
} from "./gloss.ts";
import { categories, researchLeads } from "./discovery.ts";

export type Place = {
  name: string;
  areaId?: number;
  wikidata?: string;
  lat?: number;
  lon?: number;
  code?: string;
};
export type Geo = {
  input: string;
  locality?: Place;
  city?: Place;
  state?: Place;
  country?: Place;
  // Other first-level regions of the country, searched one at a time so the
  // country tier never needs a single country-wide query.
  regions?: { name: string; areaId: number }[];
};
export type Source = "osm" | "wikidata" | "research";
export type Step = {
  source: Source;
  scope: Scope;
  region?: { name: string; areaId: number };
  // Continuation point for paged sources (last Wikidata item number seen).
  cursor?: number;
};
export const sourceNames: Record<Source, string> = {
  osm: "OpenStreetMap",
  wikidata: "Wikidata",
  research: "Research snapshot",
};
export const scopeNames: Record<Scope, string> = {
  locality: "Locality",
  city: "City",
  state: "State",
  country: "Country",
  global: "Global",
};
export const scopeRank = (s: string) =>
  ({ locality: 0, city: 1, state: 2, country: 3, global: 4 })[s] ?? 5;

/** "Baner, Pune" / "Pune · Baner" / "Pune" → candidate place names. */
export function locationParts(location: string) {
  return location
    .split(/[,·|/]/)
    .map((s) => s.trim())
    .filter((s) => /^[\p{L}\p{N} .'-]{2,80}$/u.test(s))
    .slice(0, 4);
}
const quote = (s: string) => JSON.stringify(s);

/** Exact-name lookups use the tag index, unlike a worldwide regex scan. */
export function resolvePlacesQuery(parts: string[]) {
  const title = (p: string) => p.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
  const variants = [...new Set(parts.flatMap((p) => [p, title(p.toLowerCase())]))];
  const clauses = variants
    .map((n) => `nwr["name"=${quote(n)}]["place"~"^(city|town|village|suburb|neighbourhood|quarter|locality|borough)$"];`)
    .join("");
  return `[out:json][timeout:25];(${clauses});out tags center 80;`;
}
export function enclosingAreasQuery(nodeType: string, id: number) {
  return `[out:json][timeout:25];${nodeType}(${id});is_in;area._["boundary"="administrative"]["admin_level"~"^(2|3|4|5|6|7|8)$"];out tags;`;
}
type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
const coords = (e: OsmElement) =>
  e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : undefined);
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const cityRank: Record<string, number> = { city: 0, town: 1, borough: 2, village: 3 };
/** Chooses the city place node and an optional locality near it. */
export function pickPlaces(parts: string[], elements: OsmElement[]) {
  const lower = parts.map((p) => p.toLowerCase());
  const named = elements.filter((e) => e.tags?.name && coords(e));
  const cities = named
    .filter((e) => e.tags!.place! in cityRank && lower.includes(e.tags!.name.toLowerCase()))
    .sort(
      (a, b) =>
        // Later parts are usually the city ("Baner, Pune"); larger places win ties.
        lower.indexOf(b.tags!.name.toLowerCase()) - lower.indexOf(a.tags!.name.toLowerCase()) ||
        cityRank[a.tags!.place!] - cityRank[b.tags!.place!] ||
        Number(b.tags!.population || 0) - Number(a.tags!.population || 0),
    );
  const city = cities[0];
  if (!city) return { city: undefined, locality: undefined };
  const cityName = city.tags!.name.toLowerCase();
  const others = lower.filter((p) => p !== cityName);
  const locality = named
    .filter(
      (e) =>
        e !== city &&
        others.includes(e.tags!.name.toLowerCase()) &&
        distanceKm(coords(e)!, coords(city)!) < 40,
    )
    .sort((a, b) => distanceKm(coords(a)!, coords(city)!) - distanceKm(coords(b)!, coords(city)!))[0];
  return { city, locality, missingLocality: others.length > 0 && !locality ? parts.find((p) => others.includes(p.toLowerCase())) : undefined };
}
export function regionsQuery(countryAreaId: number) {
  return `[out:json][timeout:25];area(${countryAreaId})->.c;rel(area.c)["boundary"="administrative"]["admin_level"="4"];out tags center;`;
}
/** Other regions of the country, nearest to the campaign city first. */
export function regionsByDistance(relations: OsmElement[], geo: Geo) {
  const home = geo.city?.lat !== undefined ? { lat: geo.city.lat, lon: geo.city.lon! } : undefined;
  return relations
    .map((r) => ({ name: r.tags?.["name:en"] || r.tags?.name || "", areaId: 3600000000 + r.id, at: coords(r) }))
    .filter((r) => r.name && r.areaId !== geo.state?.areaId)
    .sort((a, b) =>
      home && a.at && b.at ? distanceKm(home, a.at) - distanceKm(home, b.at) : a.name.localeCompare(b.name),
    )
    .map(({ name, areaId }) => ({ name, areaId }));
}
/** Builds the geography from the city node and its enclosing administrative areas. */
export function geoFromAreas(input: string, city: OsmElement, areas: OsmElement[], locality?: Place): Geo {
  const tag = (e: OsmElement, k: string) => e.tags?.[k] || "";
  const cityName = tag(city, "name");
  const level = (e: OsmElement) => Number(tag(e, "admin_level"));
  const areaId = (e: OsmElement) => e.id;
  const cityArea = areas
    .filter((a) => level(a) >= 5 && (tag(a, "name:en") || tag(a, "name")).toLowerCase().includes(cityName.toLowerCase()))
    // The district-level area covers the wider metropolitan region (e.g. Pune District).
    .sort((a, b) => level(a) - level(b))[0];
  const state = areas.find((a) => level(a) === 4) || areas.find((a) => level(a) === 3);
  const country = areas.find((a) => level(a) === 2);
  const c = coords(city)!;
  return {
    input,
    locality,
    city: {
      name: cityName,
      areaId: cityArea ? areaId(cityArea) : undefined,
      wikidata: tag(city, "wikidata") || undefined,
      lat: c.lat,
      lon: c.lon,
    },
    state: state && { name: tag(state, "name:en") || tag(state, "name"), areaId: areaId(state), wikidata: tag(state, "wikidata") || undefined },
    country: country && {
      name: tag(country, "name:en") || tag(country, "name"),
      areaId: areaId(country),
      wikidata: tag(country, "wikidata") || undefined,
      code: tag(country, "ISO3166-1") || undefined,
    },
  };
}
export function areaName(geo: Geo, scope: Scope) {
  return scope === "global"
    ? "Worldwide"
    : scope === "locality"
      ? `${geo.locality?.name}, ${geo.city?.name}`
      : (geo[scope as "city" | "state" | "country"]?.name ?? "");
}

/** Which steps run for a campaign, in priority order. */
export function plan(campaign: Campaign, geo: Geo) {
  const steps: Step[] = [];
  const skipped: DiscoveryReport[] = [];
  const gloss = isGloss(campaign);
  const scopes: Scope[] = [
    ...(geo.locality ? (["locality"] as const) : []),
    "city",
    // Gloss focuses on Pune (or the campaign city) and the rest of its state.
    ...(gloss ? (["state"] as const) : []),
  ];
  const sources: Source[] =
    campaign.audience === "Creator Partners"
      ? ["wikidata"]
      : campaign.audience === "Professional Prospects"
        ? ["osm", "wikidata"]
        : ["research", "osm"];
  for (const scope of scopes)
    for (const source of sources) {
      const area = areaName(geo, scope);
      if (source === "research" && scope !== "city") continue;
      if (source === "osm" && scope === "global") {
        skipped.push({ source: sourceNames.osm, scope, area, status: "skipped", found: 0, added: 0, refreshed: 0, message: "A worldwide OpenStreetMap query is too large for the public Overpass service; Wikidata covers the global tier." });
        continue;
      }
      if (source === "osm" && scope === "country") {
        if (!geo.country?.areaId) {
          skipped.push({ source: sourceNames.osm, scope, area, status: "skipped", found: 0, added: 0, refreshed: 0, message: "This country could not be resolved on OpenStreetMap." });
          continue;
        }
        // Expanded into one step per region when this tier is reached.
        if (geo.regions?.length) for (const region of geo.regions) steps.push({ source, scope, region });
        else steps.push({ source, scope });
        continue;
      }
      if (source === "osm" && scope !== "locality" && !geo[scope as "city" | "state" | "country"]?.areaId && !(scope === "city" && geo.city?.lat)) {
        skipped.push({ source: sourceNames.osm, scope, area, status: "skipped", found: 0, added: 0, refreshed: 0, message: "This area could not be resolved on OpenStreetMap." });
        continue;
      }
      if (source === "wikidata" && scope === "locality") continue;
      if (source === "wikidata" && scope !== "global" && !geo[scope === "locality" ? "city" : (scope as "city" | "state" | "country")]?.wikidata) {
        skipped.push({ source: sourceNames.wikidata, scope, area, status: "skipped", found: 0, added: 0, refreshed: 0, message: "No Wikidata identifier is known for this area." });
        continue;
      }
      steps.push({ source, scope });
    }
  if (gloss)
    skipped.push({ source: "Instagram, TikTok, YouTube, LinkedIn, Facebook", scope: "all", area: "", status: "skipped", found: 0, added: 0, refreshed: 0, message: "These platforms provide no public search without an account or API key, so they are not searched. Their links are kept whenever OpenStreetMap or Wikidata publishes them; use Open Search to find other profiles yourself." });
  return { steps, skipped };
}

// ---------- OpenStreetMap ----------
// Each filter applies to one primary key. Elements with that key are fetched
// from the area once and then filtered, which is far cheaper for Overpass
// than evaluating every clause against the whole area.
type Filter = { key: string; clause: string; label: string; nameOnly?: boolean };
const nameMatch = (re: string, label: string): Filter[] =>
  ["shop", "craft", "office"].map((key) => ({ key, clause: `["name"~"${re}",i]`, label, nameOnly: true }));
/** Overpass tag filters for the campaign's professions or markets. */
export function osmFilters(campaign: Campaign): Filter[] {
  if (!isGloss(campaign))
    return categories
      .filter((k) => campaign.markets.some((m) => k.match.test(m.name)))
      .map((k) => ({ key: k.key, clause: `["${k.key}"~"^(${k.values.join("|")})$"]`, label: k.industry }));
  const filters: Filter[] = [];
  const p = new Set(glossConfig(campaign).professions);
  if (p.has("Makeup Artist") || p.has("Bridal Makeup Artist") || p.has("Beauty Creator") || p.has("Nail Artist"))
    filters.push({ key: "shop", clause: `["shop"~"^(beauty|cosmetics)$"]`, label: "beauty" }, ...nameMatch("make ?-?up|makeover|bridal|mua|nail|meh[ae]n?di", "beauty"));
  if (p.has("Hairstylist")) filters.push({ key: "shop", clause: `["shop"="hairdresser"]`, label: "hair" }, ...nameMatch("hair|salon", "hair"));
  if (p.has("Model")) filters.push({ key: "office", clause: `["office"~"^(talent_agency|modelling_agency|model_agency)$"]`, label: "model" }, ...nameMatch("model(l)?ing", "model"));
  if (p.has("Creative Freelancer"))
    filters.push({ key: "craft", clause: `["craft"="photographer"]`, label: "creative" }, { key: "shop", clause: `["shop"="photo"]`, label: "creative" }, { key: "office", clause: `["office"="photographer"]`, label: "creative" });
  if (p.has("Chef / Hospitality"))
    filters.push({ key: "amenity", clause: `["amenity"~"^(restaurant|cafe)$"]`, label: "hospitality" }, { key: "tourism", clause: `["tourism"~"^(hotel|guest_house)$"]`, label: "hospitality" });
  return [...new Map(filters.map((f) => [f.key + f.clause, f])).values()];
}
const LOCALITY_RADIUS_M = 3000;
const CITY_RADIUS_M = 20000;
export function overpassQuery(campaign: Campaign, geo: Geo, scope: Scope, region?: Step["region"]) {
  // Name matching is only affordable within a city; wider tiers use tags.
  const filters = osmFilters(campaign).filter((f) => !f.nameOnly || scope === "locality" || scope === "city");
  if (!filters.length)
    throw new Error("These markets are not covered by the public map directory yet. Import leads with source links instead.");
  const timeout = scope === "country" ? 75 : scope === "state" ? 60 : 45;
  const keys = [...new Set(filters.map((f) => f.key))];
  // Builds the matching set for a target into the named set `out`.
  const select = (target: string, out: string) =>
    keys.map((k) => `nwr["${k}"]${target}->.${out}_${k};`).join("") +
    "(" + filters.map((f) => `nwr.${out}_${f.key}${f.clause}["name"];`).join("") + `)->.${out};`;
  const cityTarget = geo.city?.areaId ? "(area.c)" : `(around:${CITY_RADIUS_M},${geo.city?.lat},${geo.city?.lon})`;
  const head = `[out:json][timeout:${timeout}];` + (geo.city?.areaId ? `area(${geo.city.areaId})->.c;` : "");
  let body: string;
  let places = "";
  if (scope === "locality") {
    body = select(`(around:${LOCALITY_RADIUS_M},${geo.locality!.lat},${geo.locality!.lon})`, "r");
    places = `node["place"~"^(suburb|neighbourhood|quarter|village|locality)$"](around:${LOCALITY_RADIUS_M + 2000},${geo.locality!.lat},${geo.locality!.lon});out tags center;`;
  } else if (scope === "city") {
    body = select(cityTarget, "r");
    places = `node["place"~"^(suburb|neighbourhood|quarter|village|town)$"]${cityTarget};out tags center;`;
  } else if (region) {
    // One region of the country; the home state is never in this list.
    body = `area(${region.areaId})->.o;` + select("(area.o)", "r");
  } else {
    const outer = geo[scope as "state" | "country"]!;
    const inner = scope === "state" ? cityTarget : geo.state?.areaId ? `(area.s)` : cityTarget;
    // Records already covered by the narrower tier are excluded.
    body =
      `area(${outer.areaId})->.o;` +
      (scope === "country" && geo.state?.areaId ? `area(${geo.state.areaId})->.s;` : "") +
      select("(area.o)", "a") + select(inner, "b") + "(.a; - .b;)->.r;";
    if (scope === "state") places = `node["place"~"^(city|town)$"](area.o);out tags center;`;
  }
  // Results first, then place nodes used to label each record's locality.
  return `${head}${body}.r out tags center;${places}`;
}
const isPlace = (e: OsmElement) =>
  !!e.tags?.place && !["shop", "amenity", "craft", "office", "tourism"].some((k) => e.tags?.[k]);
function categoryLabel(t: Record<string, string>) {
  const name = (t.name || "").toLowerCase();
  if (/bridal/.test(name)) return { industry: "Bridal makeup studio", profession: "Bridal Makeup Artist" };
  if (/make ?-?up|makeover|\bmua\b/.test(name)) return { industry: "Makeup studio", profession: "Makeup Artist" };
  if (t.beauty === "nails" || /\bnail/.test(name)) return { industry: "Nail salon", profession: "Nail Artist" };
  if (/meh[ae]n?di/.test(name)) return { industry: "Mehendi studio", profession: "" };
  if (t.shop === "hairdresser" || /\bhair/.test(name)) return { industry: "Hair salon", profession: "Hairstylist" };
  if (t.shop === "beauty") return { industry: "Beauty salon", profession: "" };
  if (t.shop === "cosmetics") return { industry: "Cosmetics store", profession: "" };
  if (/model/.test(name) || /talent|model/.test(t.office || "")) return { industry: "Model / talent agency", profession: "Model" };
  if (t.craft === "photographer" || t.shop === "photo" || t.office === "photographer") return { industry: "Photography studio", profession: "Creative Freelancer" };
  if (t.amenity === "restaurant") return { industry: "Restaurant", profession: "Chef / Hospitality" };
  if (t.amenity === "cafe") return { industry: "Café", profession: "Chef / Hospitality" };
  if (t.tourism) return { industry: "Hotel", profession: "Chef / Hospitality" };
  return { industry: "Business", profession: "" };
}
const first = (...values: (string | undefined)[]) =>
  (values.find((v) => v && v.trim()) || "").split(";")[0].trim().slice(0, 300);
function socialUrl(platform: "Instagram" | "Facebook" | "YouTube" | "TikTok", raw: string) {
  const v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return profileUrl(platform, v.replace(/^http:/i, "https:"));
  const handle = v.replace(/^@/, "");
  if (!/^[\w.-]{1,100}$/.test(handle)) return "";
  return {
    Instagram: `https://www.instagram.com/${handle}/`,
    Facebook: `https://www.facebook.com/${handle}`,
    YouTube: `https://www.youtube.com/@${handle}`,
    TikTok: `https://www.tiktok.com/@${handle}`,
  }[platform];
}
/** Maps Overpass elements to business leads with inferred localities. */
export function osmLeads(campaign: Campaign, geo: Geo, scope: Scope, elements: OsmElement[], today = localDate()): Lead[] {
  const places = elements.filter(isPlace).map((e) => ({ name: e.tags!.name, place: e.tags!.place, at: coords(e) })).filter((p) => p.name && p.at);
  const area = scope === "locality" || scope === "city" ? geo.city?.name : areaName(geo, scope);
  const nearest = (at?: { lat: number; lon: number }) => {
    if (!at) return "";
    let best = "", d = Infinity;
    for (const p of places) {
      const x = distanceKm(at, p.at!);
      if (x < d) [best, d] = [p.name, x];
    }
    return d <= (scope === "state" ? 15 : 4) ? best : "";
  };
  const seen = new Set<string>();
  return elements
    .filter((e) => !isPlace(e) && e.tags?.name && ["node", "way", "relation"].includes(e.type) && Number.isSafeInteger(e.id))
    .filter((e) => !seen.has(e.type + e.id) && seen.add(e.type + e.id))
    .map((e) => {
      const t = e.tags!;
      const { industry, profession } = categoryLabel(t);
      const locality = first(t["addr:suburb"], t["addr:neighbourhood"], t["addr:quarter"], nearest(coords(e)), t["addr:city"]);
      const location = [locality, area].filter((v, i, a) => v && a.findIndex((x) => x?.toLowerCase() === v.toLowerCase()) === i).join(", ");
      const instagramUrl = socialUrl("Instagram", first(t["contact:instagram"], t.instagram));
      const creator = {
        ...emptyCreator(),
        profession,
        platform: (instagramUrl ? "Instagram" : "Website") as "Instagram" | "Website",
        instagram: instagramUrl ? normalizeHandle(instagramUrl) : "",
        instagramUrl,
        facebookUrl: socialUrl("Facebook", first(t["contact:facebook"], t.facebook)),
        youtubeUrl: socialUrl("YouTube", first(t["contact:youtube"], t.youtube)),
        tiktokUrl: socialUrl("TikTok", first(t["contact:tiktok"], t.tiktok)),
      };
      const hasSocial = !!(creator.instagramUrl || creator.facebookUrl || creator.youtubeUrl || creator.tiktokUrl || profession);
      const verified = first(t.check_date, t["survey:date"], t["check_date:opening_hours"]);
      const lead: Lead = {
        id: uid(),
        campaignId: campaign.id,
        name: t.name.slice(0, 300),
        industry,
        location: location.slice(0, 300),
        website: safeUrl(first(t["contact:website"], t.website)),
        email: first(t["contact:email"], t.email),
        phone: first(t["contact:phone"], t.phone, t["contact:mobile"], t.mobile, t["contact:whatsapp"]),
        source: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        sourceLabel: "OpenStreetMap contributors · public directory",
        discoveredAt: now(),
        score: 0,
        reason: "",
        missing: "",
        stage: "New",
        notes: "",
        tags: "",
        followUp: "",
        contactedAt: "",
        demo: false,
        history: [{ at: now(), event: `Discovered on OpenStreetMap (${scopeNames[scope].toLowerCase()} search${verified ? `; mapper check date ${verified}` : ""})` }],
        kind: "business",
        creator: hasSocial ? creator : undefined,
        checkedAt: today,
        sourceVerifiedAt: /^\d{4}-\d{2}(-\d{2})?$/.test(verified) ? verified : "",
        scope,
      };
      return { ...lead, ...assessFit(lead, campaign) };
    });
}

/** True when a lead has at least one way to reach the outlet or person. */
export function hasChannel(l: Lead) {
  const c = l.creator;
  return !!(
    l.phone ||
    l.email ||
    safeUrl(l.website) ||
    (c && (c.instagram || c.instagramUrl || c.facebookUrl || c.youtubeUrl || c.tiktokUrl || c.linkedinUrl))
  );
}

// ---------- Wikidata ----------
export const occupations: Record<string, { id: string; profession: string }[]> = {
  // Specific beauty, fashion and hospitality occupations only. Generic
  // "social media influencer" (Q2906862) is excluded: it matches creators of
  // every topic and would label unrelated people as beauty creators.
  "Makeup Artist": [{ id: "Q935666", profession: "Makeup Artist" }, { id: "Q2752318", profession: "Makeup Artist" }],
  "Bridal Makeup Artist": [{ id: "Q935666", profession: "Makeup Artist" }],
  Hairstylist: [{ id: "Q55187", profession: "Hairstylist" }, { id: "Q107198", profession: "Hairstylist" }],
  // Esthetician / skincare professionals sit with nail and beauty services.
  "Nail Artist": [{ id: "Q11325221", profession: "Nail Artist" }, { id: "Q12367504", profession: "Nail Artist" }],
  "Beauty Creator": [
    { id: "Q23680154", profession: "Beauty Creator" },
    { id: "Q136769295", profession: "Beauty Creator" },
    { id: "Q55611490", profession: "Beauty Creator" },
    { id: "Q28008159", profession: "Beauty Creator" },
  ],
  Model: [{ id: "Q4610556", profession: "Model" }],
  "Creative Freelancer": [{ id: "Q33231", profession: "Creative Freelancer" }, { id: "Q3501317", profession: "Creative Freelancer" }],
  "Chef / Hospitality": [{ id: "Q3499072", profession: "Chef / Hospitality" }],
};
export function wikidataOccupations(campaign: Campaign) {
  const list = glossConfig(campaign).professions.flatMap((p) => occupations[p] || []);
  // Creator partners also include beauty and fashion influencers and bloggers.
  if (campaign.audience === "Creator Partners") list.push(...occupations["Beauty Creator"]);
  return [...new Map(list.map((o) => [o.id, o])).values()];
}
export type Binding = Record<string, { value: string } | undefined>;
const IDS = "wdt:P2003|wdt:P2397|wdt:P7085|wdt:P2013|wdt:P6634|wdt:P856";
/**
 * Phase 1: candidates by occupation and citizenship with their published
 * identifiers and linked places. Place-hierarchy checks are left to phase 2
 * because evaluating them inside this query times out on the public endpoint.
 */
export const WIKIDATA_PAGE = 1500;
const labelLanguages = ["en", "mul", "hi", "mr", "es", "fr", "de", "pt", "it", "ru", "ja", "zh", "ko", "ar"];
export function wikidataCandidatesQuery(campaign: Campaign, geo: Geo, scope: Scope, after = 0) {
  const occ = wikidataOccupations(campaign);
  if (!occ.length) throw new Error("No Wikidata occupations match the selected professions.");
  const values = `VALUES ?occ { ${occ.map((o) => `wd:${o.id}`).join(" ")} }`;
  const country = geo.country?.wikidata;
  const global = scope === "global" || !country;
  const candidate = global ? (country ? `FILTER NOT EXISTS { ?p wdt:P27 wd:${country} }` : "") : `?p wdt:P27 wd:${country} .`;
  // Pages are taken in item-number order so every candidate is visited once.
  const labels = labelLanguages.map((l, i) => `OPTIONAL { ?p rdfs:label ?l${i} FILTER(LANG(?l${i}) = "${l}") }`).join("\n  ");
  return `SELECT ?p ?num ?name ?occ ?ig ?yt ?tt ?fb ?li ?web ?img ?place ?countryName WHERE {
  { SELECT DISTINCT ?p ?num WHERE {
    ${values}
    ?p wdt:P106 ?occ .
    ${candidate}
    FILTER EXISTS { ?p ${IDS} [] }
    FILTER NOT EXISTS { ?p wdt:P570 [] }
    BIND(xsd:integer(STRAFTER(STR(?p), "entity/Q")) AS ?num)
    FILTER(?num > ${Math.max(0, Math.floor(after))})
  } ORDER BY ?num LIMIT ${WIKIDATA_PAGE} }
  ${values}
  ?p wdt:P106 ?occ .
  ${labels}
  BIND(COALESCE(${labelLanguages.map((_, i) => `?l${i}`).join(", ")}) AS ?name)
  OPTIONAL { ?p wdt:P2003 ?ig } OPTIONAL { ?p wdt:P2397 ?yt } OPTIONAL { ?p wdt:P7085 ?tt }
  OPTIONAL { ?p wdt:P2013 ?fb } OPTIONAL { ?p wdt:P6634 ?li } OPTIONAL { ?p wdt:P856 ?web }
  OPTIONAL { ?p wdt:P18 ?img }
  OPTIONAL { ?p wdt:P551|wdt:P19|wdt:P937 ?place }${
    global ? `\n  OPTIONAL { ?p wdt:P27 ?c . ?c rdfs:label ?countryName FILTER(LANG(?countryName) = "en") }` : ""
  }
}`;
}
/** Highest item number in a page, used as the next cursor. */
export function lastItem(rows: Binding[]) {
  return rows.reduce((m, r) => Math.max(m, Number(r.num?.value) || 0), 0);
}
/** Phase 2: which of the candidates' places lie within the city or state. */
export function wikidataPlacesQuery(placeIds: string[], geo: Geo) {
  const city = geo.city?.wikidata;
  const state = geo.state?.wikidata;
  return `SELECT ?place ?placeName ?inCity ?inState WHERE {
  VALUES ?place { ${placeIds.map((p) => `wd:${p}`).join(" ")} }
  OPTIONAL { ?place rdfs:label ?placeName FILTER(LANG(?placeName) = "en") }
  BIND(${city ? `EXISTS { ?place wdt:P131* wd:${city} }` : "false"} AS ?inCity)
  BIND(${state ? `EXISTS { ?place wdt:P131* wd:${state} }` : "false"} AS ?inState)
}`;
}
const qid = (uri?: string) => uri?.split("/").pop() || "";
/** Keeps the candidates that belong to this tier and labels their location. */
export function classifyCandidates(
  rows: Binding[],
  places: Binding[],
  geo: Geo,
  scope: Scope,
): Binding[] {
  const info = new Map(
    places.map((p) => [qid(p.place?.value), { name: p.placeName?.value || "", city: p.inCity?.value === "true", state: p.inState?.value === "true" }]),
  );
  const byPerson = new Map<string, Binding[]>();
  for (const r of rows) byPerson.set(qid(r.p?.value), [...(byPerson.get(qid(r.p?.value)) || []), r]);
  const out: Binding[] = [];
  for (const personRows of byPerson.values()) {
    const linked = personRows.map((r) => info.get(qid(r.place?.value))).filter((x) => !!x);
    const inCity = linked.some((x) => x.city);
    const inState = linked.some((x) => x.state);
    const tier: Scope = scope === "global" ? "global" : inCity ? "city" : inState ? "state" : "country";
    if (tier !== (scope === "locality" ? "city" : scope)) continue;
    const best = linked.find((x) => (tier === "city" ? x.city : tier === "state" ? x.state : true)) || linked[0];
    for (const r of personRows)
      out.push({
        ...r,
        pLabel: r.name,
        placeLabel: best?.name ? { value: best.name } : undefined,
        // The country is only appended where the linked place is known to be in
        // it (city and state tiers) or no place is known; a citizen's linked
        // place may lie abroad.
        countryLabel:
          scope === "global"
            ? r.countryName
            : (tier !== "country" || !best?.name) && geo.country?.name
              ? { value: geo.country.name }
              : undefined,
      });
  }
  return out;
}
export function placeIds(rows: Binding[]) {
  return [...new Set(rows.map((r) => qid(r.place?.value)).filter((x) => /^Q\d+$/.test(x)))];
}
/** Groups SPARQL rows per person and maps them to validated creator leads. */
export function wikidataLeads(campaign: Campaign, scope: Scope, bindings: Binding[], today = localDate()) {
  const people = new Map<string, Binding[]>();
  for (const b of bindings) {
    const id = b.p?.value.split("/").pop();
    if (id && /^Q\d+$/.test(id)) people.set(id, [...(people.get(id) || []), b]);
  }
  const occ = new Map(wikidataOccupations(campaign).map((o) => [o.id, o.profession]));
  const leads: Lead[] = [];
  let invalid = 0;
  for (const [id, rows] of people) {
    const v = (k: string) => rows.map((r) => r[k]?.value).find(Boolean) || "";
    const name = v("pLabel");
    if (!name || /^Q\d+$/.test(name)) {
      invalid++;
      continue;
    }
    const profession = rows.map((r) => occ.get(r.occ?.value.split("/").pop() || "")).find(Boolean) || "";
    const img = v("img");
    try {
      const lead = newCreatorLead(
        campaign,
        {
          name,
          location: [v("placeLabel"), v("countryLabel")].filter((x, i, a) => x && a.indexOf(x) === i).join(", "),
          website: /^https?:\/\//.test(v("web")) ? v("web") : "",
          email: "",
          phone: "",
          source: `https://www.wikidata.org/wiki/${id}`,
          notes: "",
          tags: "",
          creator: {
            profession,
            platform: v("ig") ? "Instagram" : v("yt") ? "YouTube" : v("tt") ? "TikTok" : v("fb") ? "Facebook" : v("li") ? "LinkedIn" : "Website",
            instagram: normalizeHandle(v("ig")) ? v("ig") : "",
            youtubeUrl: /^UC[\w-]{22}$/.test(v("yt")) ? `https://www.youtube.com/channel/${v("yt")}` : "",
            tiktokUrl: /^[\w.]{1,40}$/.test(v("tt")) ? `https://www.tiktok.com/@${v("tt")}` : "",
            facebookUrl: /^[\w.-]{1,100}$/.test(v("fb")) ? `https://www.facebook.com/${v("fb")}` : "",
            linkedinUrl: /^[\p{L}\p{N}_-]{1,100}$/u.test(v("li")) ? `https://www.linkedin.com/in/${encodeURIComponent(v("li"))}/` : "",
            photoUrl: img ? img.replace(/^http:/, "https:") + "?width=96" : "",
            partnership: allowedPartnerships(campaign)[0],
          },
        },
        "Discovered via Wikidata",
      );
      leads.push({
        ...lead,
        sourceLabel: "Wikidata (CC0) · public identifiers, verify before outreach",
        checkedAt: today,
        scope,
        history: [{ at: now(), event: `Discovered via Wikidata (${scopeNames[scope].toLowerCase()} search)` }],
      });
    } catch {
      invalid++;
    }
  }
  return { leads, invalid };
}

export function researchStep(campaign: Campaign, today = localDate()) {
  // The snapshot was checked against business websites on this date; it is
  // not re-checked live, so its date is reported as-is.
  void today;
  return researchLeads(campaign).map((l) => ({
    ...l,
    checkedAt: "2026-09-14",
    sourceVerifiedAt: "2026-09-14",
    scope: "city" as const,
  }));
}

// ---------- Merge and refresh ----------
/**
 * Adds new leads (up to capacity) and refreshes leads the source already knew:
 * the check date moves forward, empty contact fields are filled and source
 * follower counts are updated. User-entered values are never overwritten.
 */
export function mergeDiscovered(existing: Lead[], incoming: Lead[], capacity = Infinity) {
  const index = new Map<string, number>();
  const leads = existing.slice();
  const key = (l: Lead) => (safeUrl(l.source) ? `${l.campaignId}|${profileKey(l.source)}` : "");
  leads.forEach((l, i) => key(l) && index.set(key(l), i));
  const added: Lead[] = [];
  let refreshed = 0;
  for (const l of incoming) {
    const i = index.get(key(l));
    if (i !== undefined) {
      const old = leads[i];
      const c = old.creator && l.creator
        ? Object.fromEntries(
            Object.entries(old.creator).map(([k, v]) => [
              k,
              k === "followers" ? (l.creator!.followers ?? v) : v === "" ? l.creator![k as keyof typeof l.creator] : v,
            ]),
          )
        : old.creator ?? l.creator;
      leads[i] = {
        ...old,
        email: old.email || l.email,
        phone: old.phone || l.phone,
        website: old.website || l.website,
        creator: c as Lead["creator"],
        checkedAt: l.checkedAt,
        sourceVerifiedAt: l.sourceVerifiedAt || old.sourceVerifiedAt,
        scope: old.scope || l.scope,
        history:
          old.checkedAt === l.checkedAt
            ? old.history
            : [...old.history, { at: now(), event: `Re-confirmed by ${l.sourceLabel.split(" ·")[0]}` }].slice(-500),
      };
      refreshed++;
      continue;
    }
    if (added.length >= capacity) continue;
    if (!deduplicate([...leads, ...added], [l]).length) continue;
    added.push(l);
  }
  return { leads: [...leads, ...added], added, refreshed };
}
/** Rescores leads after a refresh so fit reflects the latest public details. */
export function rescore(leads: Lead[], campaign: Campaign) {
  return leads.map((l) => (l.campaignId === campaign.id && !l.demo ? { ...l, ...scoreLead(l, campaign) } : l));
}
