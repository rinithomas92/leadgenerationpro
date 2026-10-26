// Network calls for custom lead projects, run by the Worker. Reuses the
// existing Overpass, Wikidata and location clients (with their retries,
// rate-limit handling and mirror failover) without changing them.
import { classifyCandidates, lastItem, placeIds, wikidataPlacesQuery, type Geo } from "./discovery-engine.ts";
import { overpassFrom, resolveGeo, sparql } from "./discovery-net.ts";
import { countFrom, osmIdsQuery, osmQuery, subAreasQuery, wikidataProjectQuery, WIKIDATA_PROJECT_PAGE, type OsmQuery } from "./project-osm.ts";

type Fetch = typeof fetch;
const agent = "LeadGenPro/1.0 (user-initiated discovery; https://www.openstreetmap.org/copyright)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Bbox = { w: number; s: number; e: number; n: number };
export type ProjectGeo = Geo & {
  // ISO 3166-2 suffix of the state, e.g. "MH", matching Overture addresses.region.
  stateCode?: string;
  stateBbox?: Bbox;
};

// Nominatim's usage policy allows at most one request per second.
let lastNominatim = 0;
async function nominatim<T>(path: string, f: Fetch): Promise<T> {
  const gap = Date.now() - lastNominatim;
  if (gap < 1100) await sleep(1100 - gap);
  lastNominatim = Date.now();
  const r = await f(`https://nominatim.openstreetmap.org/${path}`, {
    headers: { "User-Agent": agent, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Nominatim unavailable (HTTP ${r.status})`);
  return (await r.json()) as T;
}
type Hit = {
  lat: string;
  lon: string;
  name?: string;
  osm_type?: string;
  osm_id?: number;
  boundingbox?: string[];
  extratags?: Record<string, string>;
  address?: Record<string, string>;
};
const bbox = (h?: Hit): Bbox | undefined => {
  const b = h?.boundingbox?.map(Number);
  return b && b.length === 4 && b.every(Number.isFinite) ? { s: b[0], n: b[1], w: b[2], e: b[3] } : undefined;
};

/** Resolves the base location, then the state's ISO code and bbox (used by the Overture State tier). */
export async function projectPlan(location: string, f: Fetch = fetch) {
  const { geo, report } = await resolveGeo(location, f);
  const out: ProjectGeo = { ...geo };
  const rel = geo.state?.areaId && geo.state.areaId > 3600000000 ? geo.state.areaId - 3600000000 : 0;
  try {
    const [hit] = rel
      ? await nominatim<Hit[]>(`lookup?format=jsonv2&extratags=1&addressdetails=1&osm_ids=R${rel}`, f)
      : await nominatim<Hit[]>(`search?format=jsonv2&limit=1&extratags=1&addressdetails=1&featureType=state&q=${encodeURIComponent(`${geo.state?.name}, ${geo.country?.name}`)}`, f);
    const iso = hit?.extratags?.["ISO3166-2"] || hit?.address?.["ISO3166-2-lvl4"] || "";
    if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso)) out.stateCode = iso.split("-")[1];
    out.stateBbox = bbox(hit);
    const cc = (hit?.address?.country_code || "").toUpperCase();
    if (out.country && !out.country.code && /^[A-Z]{2}$/.test(cc)) out.country.code = cc;
  } catch (e) {
    report.push({ source: "Nominatim", scope: "state", area: geo.state?.name ?? "", status: "partial", found: 0, added: 0, refreshed: 0, message: `State code lookup failed (${e instanceof Error ? e.message : "error"}); the State tier uses OpenStreetMap only.` });
  }
  return { geo: out, report };
}

/** A Global-tier country by ISO code: its OpenStreetMap area, Wikidata id and bbox. */
export async function resolveCountry(code: string, f: Fetch = fetch) {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("Use a two-letter country code.");
  const [hit] = await nominatim<Hit[]>(`search?format=jsonv2&limit=1&extratags=1&featureType=country&countrycodes=${code.toLowerCase()}`, f);
  if (!hit) throw new Error(`${code} could not be found on OpenStreetMap.`);
  return {
    code,
    name: hit.name || code,
    areaId: hit.osm_type === "relation" && hit.osm_id ? 3600000000 + hit.osm_id : undefined,
    wikidata: /^Q\d+$/.test(hit.extratags?.wikidata || "") ? hit.extratags!.wikidata : undefined,
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    bbox: bbox(hit),
  };
}

export async function osmSearch(q: OsmQuery, count = false, f: Fetch = fetch) {
  const { elements, host } = await overpassFrom(osmQuery(q, count), f, count ? 60000 : 85000);
  return count ? { count: countFrom(elements as never), host } : { elements, host };
}
export async function osmByIds(ids: string[], f: Fetch = fetch) {
  return (await overpassFrom(osmIdsQuery(ids), f, 60000)).elements;
}
/** Districts of a state (5) or states of a country (4), for chunked queries. */
export async function subAreas(areaId: number, level: 4 | 5, f: Fetch = fetch) {
  const { elements } = await overpassFrom(subAreasQuery(areaId, level), f, 45000);
  return (elements as { type: string; id: number; tags?: Record<string, string> }[])
    .filter((e) => e.type === "relation" && (e.tags?.["name:en"] || e.tags?.name))
    .map((e) => ({ name: e.tags!["name:en"] || e.tags!.name, areaId: 3600000000 + e.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One page of Wikidata people for occupation segments. For the home country,
 * rows are classified into city / state / country by their linked places.
 */
export async function wikidataPage(occupations: string[], countryQid: string, scope: "city" | "state" | "country" | "global", geo: Geo, after = 0, f: Fetch = fetch) {
  const candidates = await sparql(wikidataProjectQuery(occupations, countryQid, after), f);
  const people = new Set(candidates.map((r) => r.p?.value)).size;
  const cursor = people >= WIKIDATA_PROJECT_PAGE ? lastItem(candidates) : undefined;
  if (scope === "global") return { rows: classifyCandidates(candidates, [], geo, "global"), cursor };
  const ids = placeIds(candidates);
  const places = [];
  for (let i = 0; i < ids.length; i += 300) places.push(...(await sparql(wikidataPlacesQuery(ids.slice(i, i + 300), geo), f)));
  return { rows: classifyCandidates(candidates, places, geo, scope), cursor };
}
