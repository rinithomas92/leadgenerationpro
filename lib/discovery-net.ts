// Network access for discovery. Each call retries transient failures and
// reports a clear error instead of returning a silently partial result.
import type { Campaign, DiscoveryReport, Lead, Scope } from "./leadgen.ts";
import {
  areaName,
  enclosingAreasQuery,
  geoFromAreas,
  locationParts,
  osmLeads,
  overpassQuery,
  pickPlaces,
  researchStep,
  regionsByDistance,
  regionsQuery,
  resolvePlacesQuery,
  sourceNames,
  classifyCandidates,
  placeIds,
  wikidataCandidatesQuery,
  wikidataPlacesQuery,
  wikidataLeads,
  hasChannel,
  lastItem,
  WIKIDATA_PAGE,
  type Geo,
  type Place,
  type Step,
  type Binding,
} from "./discovery-engine.ts";

const agent = "LeadGenPro/1.0 (user-initiated discovery; https://www.openstreetmap.org/copyright)";
// overpass.kumi.systems is deliberately excluded: in testing it returned
// silently incomplete results (1 of ~430 Maharashtra listings, no remark).
export const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Fetch = typeof fetch;

/**
 * Runs an Overpass query within a total time budget so one slow tier cannot
 * stall a whole run. The main server is preferred; when it is rate limited
 * (HTTP 429) the client waits as instructed instead of failing, and mirrors
 * are tried when it is overloaded.
 */
export async function overpass(query: string, f: Fetch = fetch, budgetMs = 85000, wait = sleep) {
  return (await overpassFrom(query, f, budgetMs, wait)).elements;
}
/** As overpass(), also returning the host that answered. */
export async function overpassFrom(query: string, f: Fetch = fetch, budgetMs = 85000, wait = sleep) {
  const deadline = Date.now() + budgetMs;
  const errors: string[] = [];
  const [main, ...mirrors] = overpassEndpoints;
  const order = [main, mirrors[0], main, mirrors[1], mirrors[0], main];
  let waited = 0;
  for (let i = 0; i < order.length; i++) {
    const endpoint = order[i];
    const remaining = deadline - Date.now();
    if (remaining < 5000) break;
    try {
      const r = await f(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": agent },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(remaining),
      });
      if (r.status === 429) {
        const after = Number(r.headers.get("retry-after")) || 12;
        errors.push(`${new URL(endpoint).hostname}: rate limited`);
        await wait(Math.min(after * 1000, Math.max(0, deadline - Date.now() - 10000)));
        // A rate-limited server is asked again after the wait (at most twice).
        if (waited++ < 2) order.splice(i + 1, 0, endpoint);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { elements?: unknown[]; remark?: string };
      // Overpass only adds a remark when something went wrong (timeouts,
      // memory limits); the elements are then incomplete, so never use them.
      if (d.remark) throw new Error(d.remark.slice(0, 120));
      if (!Array.isArray(d.elements)) throw new Error("Malformed response");
      return { elements: d.elements as Parameters<typeof osmLeads>[3], host: new URL(endpoint).hostname };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : "failed";
      errors.push(`${new URL(endpoint).hostname}: ${msg}`);
      if (deadline - Date.now() > 8000) await wait(2000);
    }
  }
  throw new Error(`OpenStreetMap search did not complete (${errors.join("; ") || "time budget exhausted"})`);
}
export async function sparql(query: string, f: Fetch = fetch) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await f("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/sparql-results+json",
          "User-Agent": agent,
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(70000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { results?: { bindings?: Record<string, { value: string }>[] } };
      if (!Array.isArray(d.results?.bindings)) throw new Error("Malformed response");
      return d.results.bindings;
    } catch (e) {
      last = e instanceof Error ? e.message : "failed";
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error(`Wikidata query service unavailable (${last})`);
}
async function getJson<T>(url: string, f: Fetch, label: string): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await f(url, { headers: { "User-Agent": agent, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 403 || r.status === 400) {
        const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        throw Object.assign(new Error(body.error?.message || `HTTP ${r.status}`), { fatal: true });
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      last = e instanceof Error ? e.message : "failed";
      if ((e as { fatal?: boolean }).fatal) break;
      await sleep(1500);
    }
  }
  throw new Error(`${label} unavailable (${last})`);
}

/** Resolves the campaign location into locality, city, state and country. */
/**
 * Other first-level regions of the country, nearest to the city first. Uses
 * Overpass, or Wikidata (which records each region's OpenStreetMap relation)
 * when Overpass is unavailable.
 */
export async function loadRegions(geo: Geo, f: Fetch = fetch) {
  let overpassError: unknown;
  if (geo.country?.areaId)
    try {
      const rels = await overpass(regionsQuery(geo.country.areaId), f, 45000);
      if (rels.length) return regionsByDistance(rels as never, geo);
    } catch (e) {
      overpassError = e;
    }
  if (!geo.country?.wikidata) throw overpassError ?? new Error("Country not resolved.");
  const rows = await sparql(
    `SELECT DISTINCT ?s ?name ?rel ?coord WHERE {
  ?s wdt:P31/wdt:P279* wd:Q10864048 ; wdt:P17 wd:${geo.country.wikidata} ; wdt:P402 ?rel .
  FILTER NOT EXISTS { ?s wdt:P576 [] }
  OPTIONAL { ?s wdt:P625 ?coord }
  OPTIONAL { ?s rdfs:label ?name FILTER(LANG(?name) = "en") }
}`,
    f,
  );
  const relations = rows.flatMap((r) => {
    const id = Number(r.rel?.value);
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value || "");
    if (!Number.isSafeInteger(id) || !r.name?.value || r.s?.value.endsWith(`/${geo.state?.wikidata}`)) return [];
    return [{ type: "relation", id, tags: { name: r.name.value }, center: m ? { lat: Number(m[2]), lon: Number(m[1]) } : undefined }];
  });
  return regionsByDistance(relations as never, geo);
}
export async function resolveGeo(location: string, f: Fetch = fetch): Promise<{ geo: Geo; report: DiscoveryReport[] }> {
  const parts = locationParts(location);
  const report: DiscoveryReport[] = [];
  if (!parts.length) throw new Error("Use a location such as Pune or Baner, Pune.");
  // Both Overpass lookups (the place, then its enclosing areas) fall back to
  // Nominatim and Wikidata if either one fails.
  const fallback = async (e: unknown) => {
    const geo = await resolveFallback(location, parts, f);
    report.push({ source: "OpenStreetMap", scope: "all", area: location, status: "partial", found: 0, added: 0, refreshed: 0, message: `Location lookup on Overpass failed (${e instanceof Error ? e.message : "error"}); resolved with Nominatim and Wikidata instead; the city tier uses a 20 km radius around the city centre.` });
    return { geo, report };
  };
  let elements;
  try {
    elements = await overpass(resolvePlacesQuery(parts), f, 30000);
  } catch (e) {
    return fallback(e);
  }
  const { city, locality, missingLocality } = pickPlaces(parts, elements as never);
  if (!city) throw new Error(`“${parts.join(", ")}” could not be found as a city or town on OpenStreetMap.`);
  let areas;
  try {
    areas = await overpass(enclosingAreasQuery(city.type, city.id), f, 30000);
  } catch (e) {
    return fallback(e);
  }
  let localityPlace: Place | undefined = locality && {
    name: locality.tags!.name,
    lat: (locality.center ?? locality).lat!,
    lon: (locality.center ?? locality).lon!,
  };
  if (missingLocality) {
    // Fallback: OpenStreetMap's Nominatim geocoder, one request per run.
    try {
      const hits = await getJson<{ lat: string; lon: string; name?: string }[]>(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(`${missingLocality}, ${city.tags!.name}`)}`,
        f,
        "Nominatim",
      );
      if (hits[0]) localityPlace = { name: missingLocality, lat: Number(hits[0].lat), lon: Number(hits[0].lon) };
      else report.push({ source: "OpenStreetMap", scope: "locality", area: missingLocality, status: "failed", found: 0, added: 0, refreshed: 0, message: `Locality “${missingLocality}” was not found; searching the whole city instead.` });
    } catch (e) {
      report.push({ source: "OpenStreetMap", scope: "locality", area: missingLocality, status: "failed", found: 0, added: 0, refreshed: 0, message: e instanceof Error ? e.message : "Locality lookup failed." });
    }
  }
  return { geo: geoFromAreas(location, city as never, areas as never, localityPlace), report };
}

/** Location lookup without Overpass: Nominatim for coordinates, Wikidata for the hierarchy. */
async function resolveFallback(location: string, parts: string[], f: Fetch): Promise<Geo> {
  type Hit = { lat: string; lon: string; name?: string; osm_type?: string; osm_id?: number; extratags?: { wikidata?: string }; address?: Record<string, string> };
  let calls = 0;
  // Nominatim's usage policy allows at most one request per second.
  const search = async (q: string, featureType = "") => {
    if (calls++) await sleep(1100);
    return getJson<Hit[]>(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&extratags=1${featureType ? `&featureType=${featureType}` : ""}&q=${encodeURIComponent(q)}`,
      f,
      "Nominatim",
    );
  };
  // An administrative relation's Overpass area id is 3600000000 + relation id.
  const areaOf = (hit?: Hit) => (hit?.osm_type === "relation" && hit.osm_id ? 3600000000 + hit.osm_id : undefined);
  const cityName = parts[parts.length - 1];
  const [cityHit] = await search(cityName);
  if (!cityHit) throw new Error(`“${cityName}” could not be found.`);
  const qid = cityHit.extratags?.wikidata;
  let state: Place | undefined;
  let country: Place | undefined;
  if (qid && /^Q\d+$/.test(qid)) {
    const rows = await sparql(
      `SELECT ?state ?stateLabel ?country ?countryLabel ?iso WHERE { wd:${qid} wdt:P17 ?country . OPTIONAL { ?country wdt:P297 ?iso } OPTIONAL { wd:${qid} wdt:P131+ ?state . ?state wdt:P31/wdt:P279* wd:Q107390 . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 1`,
      f,
    );
    const r = rows[0] || {};
    const id = (k: string) => r[k]?.value.split("/").pop();
    if (id("state")) state = { name: r.stateLabel?.value || "", wikidata: id("state") };
    if (id("country")) country = { name: r.countryLabel?.value || "", wikidata: id("country"), code: r.iso?.value };
  }
  let locality: Place | undefined;
  if (parts.length > 1) {
    const [hit] = await search(`${parts[0]}, ${cityName}`);
    if (hit) locality = { name: parts[0], lat: Number(hit.lat), lon: Number(hit.lon) };
  }
  state = state ?? (cityHit.address?.state ? { name: cityHit.address.state } : undefined);
  country = country ?? (cityHit.address?.country ? { name: cityHit.address.country, code: cityHit.address.country_code?.toUpperCase() } : undefined);
  // Resolve the state and country as OpenStreetMap areas so those tiers can
  // still be searched when Overpass could not do the lookup itself.
  if (state?.name) state.areaId = areaOf((await search(state.name, "state").catch(() => []))[0]);
  if (country?.name) country.areaId = areaOf((await search(country.name, "country").catch(() => []))[0]);
  return {
    input: location,
    locality,
    city: { name: cityHit.name || cityName, lat: Number(cityHit.lat), lon: Number(cityHit.lon), wikidata: qid },
    state,
    country,
  };
}

export type StepResult = { leads: Lead[]; report: DiscoveryReport; cursor?: number };
/** Keeps only reachable records and says how many were left out. */
function reachable(leads: Lead[]) {
  const kept = leads.filter(hasChannel);
  return { kept, skipped: leads.length - kept.length };
}
/**
 * Runs one source in one geographic tier. Never throws: failures become
 * reports. Paged sources return a cursor when more results remain; the caller
 * calls again with it until none is returned, so nothing is capped.
 */
export async function runStep(campaign: Campaign, geo: Geo, step: Step, f: Fetch = fetch, budgetMs = 60000): Promise<StepResult> {
  const base = { source: sourceNames[step.source], scope: step.scope, area: step.region?.name ?? areaName(geo, step.scope), added: 0, refreshed: 0 };
  try {
    if (step.source === "research") {
      const leads = researchStep(campaign);
      return { leads, report: { ...base, status: leads.length ? "ok" : "empty", found: leads.length, message: "Business website research snapshot checked 14 Sep 2026; not re-checked live." } };
    }
    if (step.source === "osm") {
      const { elements, host } = await overpassFrom(overpassQuery(campaign, geo, step.scope, step.region), f);
      const { kept, skipped } = reachable(osmLeads(campaign, geo, step.scope, elements));
      return {
        leads: kept,
        report: {
          ...base,
          status: kept.length ? "ok" : "empty",
          found: kept.length,
          message:
            `${kept.length} listings with at least one reach-out channel (phone, email, website or social link).` +
            (skipped ? ` ${skipped} listings publish no contact channel and were left out.` : "") +
            ` Served by ${host}.`,
        },
      };
    }
    // Wikidata: page through candidates until done or the time budget is used.
    const started = Date.now();
    let cursor = step.cursor ?? 0;
    const leads: Lead[] = [];
    let invalid = 0;
    let more = true;
    // At least one page per call, so every call makes progress.
    do {
      const candidates = await sparql(wikidataCandidatesQuery(campaign, geo, step.scope, cursor), f);
      const people = new Set(candidates.map((r) => r.p?.value)).size;
      more = people >= WIKIDATA_PAGE;
      if (!candidates.length) break;
      cursor = lastItem(candidates);
      let rows: Binding[] = candidates;
      if (step.scope !== "global") {
        const ids = placeIds(candidates);
        const places = [];
        for (let i = 0; i < ids.length; i += 300) places.push(...(await sparql(wikidataPlacesQuery(ids.slice(i, i + 300), geo), f)));
        rows = classifyCandidates(candidates, places, geo, step.scope);
      } else rows = classifyCandidates(candidates, [], geo, "global");
      const page = wikidataLeads(campaign, step.scope, rows);
      leads.push(...page.leads);
      invalid += page.invalid;
    } while (more && Date.now() - started < budgetMs);
    return {
      leads,
      cursor: more ? cursor : undefined,
      report: {
        ...base,
        status: leads.length ? (more ? "partial" : "ok") : "empty",
        found: leads.length,
        message:
          "Notable people with at least one published profile or website; location comes from residence or birthplace." +
          (invalid ? ` ${invalid} records had no usable name or channel and were left out.` : "") +
          (more ? " More results follow in the next page." : ""),
      },
    };
  } catch (e) {
    return { leads: [], report: { ...base, status: "failed", found: 0, message: e instanceof Error ? e.message : "Search failed." } };
  }
}
export const scopesFor = (geo: Geo): Scope[] => [...(geo.locality ? (["locality"] as const) : []), "city", "state", "country", "global"];
