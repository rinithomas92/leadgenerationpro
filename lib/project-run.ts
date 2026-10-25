// Browser orchestration for custom lead projects. Fills a project's pool
// tier by tier (nearest first), segment by segment, from:
//   - Overture Maps Places, through the local sources service (primary);
//   - OpenStreetMap (Overpass) for Locality, City and State, and for the
//     wider tiers only when the sources service is offline;
//   - Wikidata, for segments that map to occupations.
// Every search is reported; failures are never hidden. Discovery tops the
// pool up to what the next batches need and continues from saved cursors, so
// nothing is capped and nothing is fetched twice.
import { hasChannel } from "./discovery-engine.ts";
import { expandCategories, relatedCategories } from "./categories.ts";
import { leadSchema, localDate, type Campaign, type Lead } from "./leadgen.ts";
import { mergeProjectLeads } from "./dedupe.ts";
import { projectFit } from "./project-fit.ts";
import { isSuppressed, type SuppressionIndex } from "./suppression.ts";
import { overtureLead, socialFields, type Area, type Counts, type Health, type OvertureRow, type SourceQuery } from "./project-sources.ts";
import { osmProjectLeads, wikidataProjectLeads, type OsmArea, type TagSet } from "./project-osm.ts";
import { targets, tierLabel } from "./allocation.ts";
import { batchSizes, type CustomProject, type ProjectReport, type Segment, type Tier } from "./project-schema.ts";
import type { ProjectGeo } from "./project-net.ts";
import type { EnrichResult } from "../sources/enrich.ts";

type Project = Campaign & { custom: CustomProject };
export type SegmentSources = { tags: TagSet[]; occupations: string[] };
export type Progress = { done: number; total: number; label: string };
export type RunDeps = {
  /** POST /api/project-discover */
  discover: (body: unknown) => Promise<unknown>;
  /** The local sources service; health() resolves to null when it is not running. */
  sources: { health: () => Promise<Health | null>; call: <T>(route: string, body: unknown) => Promise<T> };
  sourcesFor: (segment: Segment) => SegmentSources;
  suppressed?: SuppressionIndex;
  wait?: (ms: number) => Promise<void>;
  onProgress?: (p: Progress) => void;
  /** Called after each tier with everything found so far, so long runs save as they go. */
  checkpoint?: (incoming: Lead[], reports: ProjectReport[], pool: CustomProject["pool"]) => Promise<void>;
  today?: string;
};

// ---------- Tier areas ----------
export type Country = { code: string; name: string; areaId?: number; wikidata?: string };
export type TierPlan = {
  tier: Tier;
  label: string;
  country: Country;
  base?: { lat: number; lon: number };
  overture?: { area: Area; excludeAreas: Area[] };
  osm?: { area?: OsmArea; excludeAreas: OsmArea[]; chunkOf?: { areaId: number; level: 4 | 5 } };
  wikidata?: { scope: "city" | "state" | "country" | "global" };
  skipped: string[];
};
const around = (p: { lat?: number; lon?: number } | undefined, km: number): OsmArea | undefined =>
  p?.lat != null && p?.lon != null ? { kind: "around", lat: p.lat, lon: p.lon, m: km * 1000 } : undefined;
const radius = (p: { lat?: number; lon?: number } | undefined, km: number): Area | undefined =>
  p?.lat != null && p?.lon != null ? { kind: "radius", lat: p.lat, lon: p.lon, km } : undefined;

/** Where each selected tier searches, and what it excludes so tiers never overlap. */
export function tierPlans(p: CustomProject, geo: ProjectGeo, countries: Country[], serviceUp: boolean): TierPlan[] {
  const home: Country = { code: geo.country?.code || "IN", name: geo.country?.name || "India", areaId: geo.country?.areaId, wikidata: geo.country?.wikidata };
  const base = geo.locality?.lat != null ? { lat: geo.locality.lat, lon: geo.locality.lon! } : geo.city?.lat != null ? { lat: geo.city.lat, lon: geo.city.lon! } : undefined;
  const loc = radius(geo.locality, p.localityKm);
  const city = radius(geo.city, p.cityKm);
  const stateArea: Area | undefined = geo.stateCode
    ? { kind: "region", region: geo.stateCode, names: geo.state?.name ? [geo.state.name] : [], bbox: geo.stateBbox }
    : undefined;
  const plans: TierPlan[] = [];
  for (const tier of p.tiers) {
    const skipped: string[] = [];
    const label = tierLabel(tier, home.name);
    if (tier === "locality") {
      if (!loc) {
        plans.push({ tier, label, country: home, base, skipped: ["The location names no locality, so the Locality tier was skipped."] });
        continue;
      }
      plans.push({ tier, label, country: home, base, overture: { area: loc, excludeAreas: [] }, osm: { area: around(geo.locality, p.localityKm), excludeAreas: [] }, skipped });
    } else if (tier === "city") {
      const ex = p.tiers.includes("locality") && loc ? [loc] : [];
      const osmEx = p.tiers.includes("locality") ? [around(geo.locality, p.localityKm)].filter((x): x is OsmArea => !!x) : [];
      if (!city) skipped.push("The city could not be located.");
      plans.push({ tier, label, country: home, base, overture: city ? { area: city, excludeAreas: ex } : undefined, osm: city ? { area: around(geo.city, p.cityKm), excludeAreas: osmEx } : undefined, wikidata: { scope: "city" }, skipped });
    } else if (tier === "state") {
      if (!stateArea) skipped.push("The state's region code is unknown, so Overture was not searched for the State tier.");
      if (!geo.state?.areaId) skipped.push("The state could not be resolved on OpenStreetMap.");
      plans.push({
        tier,
        label,
        country: home,
        base,
        overture: stateArea && city ? { area: stateArea, excludeAreas: [city] } : undefined,
        osm: geo.state?.areaId ? { excludeAreas: [around(geo.city, p.cityKm)].filter((x): x is OsmArea => !!x), chunkOf: { areaId: geo.state.areaId, level: 5 } } : undefined,
        wikidata: { scope: "state" },
        skipped,
      });
    } else if (tier === "country") {
      const osm = !serviceUp && home.areaId ? { excludeAreas: [], chunkOf: { areaId: home.areaId, level: 4 as const } } : undefined;
      if (serviceUp) skipped.push(`OpenStreetMap is not searched for the ${home.name} tier while Overture is available (a state-by-state crawl takes about an hour).`);
      plans.push({ tier, label, country: home, base, overture: { area: { kind: "region" }, excludeAreas: stateArea ? [stateArea] : [] }, osm, wikidata: { scope: "country" }, skipped });
    } else {
      // Global: one search per chosen country; the home country has its own tier.
      for (const c of countries.filter((c) => c.code !== home.code))
        plans.push({
          tier,
          label: `${label} · ${c.name}`,
          country: c,
          base,
          overture: { area: { kind: "region" }, excludeAreas: [] },
          osm: !serviceUp && c.areaId ? { excludeAreas: [], chunkOf: { areaId: c.areaId, level: 4 } } : undefined,
          wikidata: c.wikidata ? { scope: "global" } : undefined,
          skipped: serviceUp ? [`OpenStreetMap is not searched for ${c.name} while Overture is available.`] : [],
        });
    }
  }
  return plans;
}

/** Pool size to aim for per tier and segment: twice what the largest-batch share needs. */
export function needs(p: CustomProject, size: number) {
  const shares = p.mode === "nearest"
    ? Object.fromEntries(p.tiers.map((t) => [t, size]))
    : targets(size, p.tiers.map((tier, i) => ({ tier, pct: p.split[i] ?? 0 })));
  const out: Record<string, number> = {};
  for (const t of p.tiers) for (const s of p.segments) out[`${t}|${s.id}`] = Math.ceil((2 * (shares[t] ?? 0)) / p.segments.length);
  return out;
}

const report = (r: Partial<ProjectReport> & Pick<ProjectReport, "source" | "scope" | "status">): ProjectReport => ({
  area: "", segment: "", found: 0, added: 0, refreshed: 0, excluded: 0, closed: 0, suppressed: 0, message: "", ...r,
});
const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");

/** The project's saved location while it still matches, otherwise a fresh lookup. */
export async function locate(project: Project, deps: Pick<RunDeps, "discover">): Promise<{ geo: ProjectGeo; report: ProjectReport[] }> {
  const saved = project.custom.geo;
  if (saved && saved.input === project.location) return { geo: saved as ProjectGeo, report: [] };
  return (await deps.discover({ action: "plan", location: project.location })) as { geo: ProjectGeo; report: ProjectReport[] };
}

// ---------- Availability preview ----------
export type Availability = {
  tier: Tier;
  label: string;
  segmentId: string;
  overture?: Counts;
  osm?: number;
  notes: string[];
};
/** Cheap count queries per tier and segment. Estimates: delivery applies dedupe and the channel rule. */
export async function availability(
  project: Project,
  deps: RunDeps,
  // OpenStreetMap counts are slow on the public servers; by default they run only when Overture is unavailable.
  options: { osm?: boolean } = {},
): Promise<{ rows: Availability[]; reports: ProjectReport[]; geo: ProjectGeo }> {
  const p = project.custom;
  deps.onProgress?.({ done: 0, total: 0, label: "Finding the location" });
  const { geo, report: geoReport } = await locate(project, deps);
  const health = await deps.sources.health();
  const countOsm = options.osm ?? !health;
  const countries = await globalCountries(p, deps);
  const plans = tierPlans(p, geo, countries, !!health);
  const rows: Availability[] = [];
  const total = plans.length * p.segments.length;
  let done = 0;
  for (const plan of plans)
    for (const seg of p.segments) {
      deps.onProgress?.({ done: done++, total, label: `Counting ${seg.label} · ${plan.label}` });
      const src = deps.sourcesFor(seg);
      const row: Availability = { tier: plan.tier, label: plan.label, segmentId: seg.id, notes: [...plan.skipped] };
      if (health && plan.overture && seg.categories.length) {
        if (!health.extracts.some((e) => e.country === plan.country.code)) row.notes.push(`No Overture extract for ${plan.country.code}; run npm run overture:extract -- ${plan.country.code}.`);
        else
          try {
            row.overture = await deps.sources.call<Counts>("/count", overtureQuery(plan, seg));
          } catch (e) {
            row.notes.push(`Overture count failed: ${msg(e)}`);
          }
      } else if (!health) row.notes.push("Sources service offline: Overture counts unavailable.");
      // Overpass counts only where one query covers the tier.
      if (countOsm && plan.osm?.area && src.tags.length && (plan.tier === "locality" || plan.tier === "city"))
        try {
          row.osm = ((await deps.discover({ action: "osm", count: true, query: { tags: src.tags, exclude: seg.exclude, area: plan.osm.area, excludeAreas: plan.osm.excludeAreas } })) as { count: number }).count;
        } catch (e) {
          row.notes.push(`OpenStreetMap count failed: ${msg(e)}`);
        }
      rows.push(row);
    }
  return { rows, reports: geoReport.map((r) => report({ ...r, scope: r.scope })), geo };
}
async function globalCountries(p: CustomProject, deps: RunDeps): Promise<Country[]> {
  if (!p.tiers.includes("global")) return [];
  const out: Country[] = [];
  for (const code of p.countries)
    try {
      out.push((await deps.discover({ action: "country", code })) as Country);
    } catch {
      out.push({ code, name: code });
    }
  return out;
}
/** Every project aims for at least this many available leads, widening to related categories when needed. */
export const MIN_POOL = 1000;
const overtureQuery = (plan: TierPlan, seg: Segment, categories = expandCategories(seg.categories)): SourceQuery => ({
  country: plan.country.code,
  categories,
  include: seg.include,
  keywords: "widen",
  exclude: seg.exclude,
  area: plan.overture!.area,
  excludeAreas: plan.overture!.excludeAreas,
});

// ---------- Top-up ----------
export type TopUpOptions = { size?: number; fetchAll?: boolean };
export async function topUp(project: Project, leads: Lead[], deps: RunDeps, options: TopUpOptions = {}) {
  const p = project.custom;
  const today = deps.today ?? localDate();
  const wait = deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const suppressed = deps.suppressed ?? new Set<string>();
  const size = options.size ?? batchSizes[batchSizes.length - 1];
  const reports: ProjectReport[] = [];
  const pool: CustomProject["pool"] = { ...p.pool };
  let running = leads.filter((l) => l.campaignId === project.id);
  const incoming: Lead[] = [];
  let geo: ProjectGeo;
  try {
    deps.onProgress?.({ done: 0, total: 0, label: "Finding the location" });
    const planned = await locate(project, deps);
    geo = planned.geo;
    reports.push(...planned.report.map((r) => report(r)));
  } catch (e) {
    reports.push(report({ source: "Location", scope: "all", area: project.location, status: "failed", message: msg(e) }));
    return { incoming, reports, pool, geo: undefined };
  }
  const health = await deps.sources.health();
  if (!health)
    reports.push(report({ source: "Overture Maps", scope: "all", status: "not-configured", message: "Sources service offline (start it with npm run sources), so only OpenStreetMap and Wikidata were searched." }));
  const plans = tierPlans(p, geo, await globalCountries(p, deps), !!health);
  const want = needs(p, Math.max(size, MIN_POOL));
  const available = (tier: Tier, seg: string) =>
    running.filter((l) => l.project?.tier === tier && l.project.segmentId === seg && l.project.delivery.status === "available").length;
  const segments = new Map(p.segments.map((s) => [s.id, s]));

  /** Channel rule, suppression, fit score and merge for one result set. */
  const record = (raw: Lead[], r: ProjectReport) => {
    // A record that cannot be stored (for example an over-long field) is left out and counted, never saved half-valid.
    const found = raw.filter((l) => leadSchema.safeParse(l).success);
    if (found.length < raw.length) r.message += `${raw.length - found.length} records had fields that could not be stored and were left out. `;
    const reachable = found.filter(hasChannel);
    r.excluded += raw.length - reachable.length;
    const allowed = reachable.filter((l) => !isSuppressed(l, suppressed));
    r.suppressed += reachable.length - allowed.length;
    const scored = allowed.map((l) => ({ ...l, ...projectFit(l, segments.get(l.project!.segmentId), p, today) }));
    const merged = mergeProjectLeads(running, scored);
    running = merged.leads;
    incoming.push(...scored);
    r.found += found.length;
    r.added += merged.added.length;
    r.refreshed += merged.refreshed;
  };
  let lastOsm = 0;
  const paceOsm = async () => {
    const gap = Date.now() - lastOsm;
    if (lastOsm && gap < 4000) await wait(4000 - gap);
    lastOsm = Date.now();
  };
  const total = plans.length * p.segments.length;
  let step = 0;
  for (const plan of plans) {
    for (const r of plan.skipped) reports.push(report({ source: "Plan", scope: plan.tier, area: plan.label, status: "skipped", message: r }));
    for (const seg of p.segments) {
      deps.onProgress?.({ done: step++, total, label: `${seg.label} · ${plan.label}` });
      const need = () => (options.fetchAll ? Infinity : (want[`${plan.tier}|${seg.id}`] ?? 0) - available(plan.tier, seg.id));
      if (need() <= 0) continue;
      const src = deps.sourcesFor(seg);
      // 1. Overture, paged by a stable cursor.
      if (health && plan.overture && seg.categories.length) {
        const key = `${plan.tier}|${seg.id}|ov|${plan.country.code}`;
        const state = pool[key] ? { ...pool[key] } : { cursor: "", exhausted: false, fetched: 0 };
        const r = report({ source: "Overture Maps", scope: plan.tier, area: plan.label, segment: seg.label, status: "ok" });
        if (!health.extracts.some((e) => e.country === plan.country.code)) {
          r.status = "not-configured";
          r.message = `No Overture extract for ${plan.country.code}. Run: npm run overture:extract -- ${plan.country.code}`;
        } else if (state.exhausted) {
          r.status = "empty";
          r.message = "Every matching place was already fetched in an earlier run.";
        } else
          try {
            while (need() > 0 && !state.exhausted) {
              const page = await deps.sources.call<{ rows: OvertureRow[]; nextCursor: string; release: string }>("/search", {
                ...overtureQuery(plan, seg),
                cursor: state.cursor,
                limit: Math.min(1000, Math.max(100, need() === Infinity ? 1000 : need())),
              });
              record(page.rows.map((row) => overtureLead(project, row, { tier: plan.tier, segmentId: seg.id, base: plan.base }, page.release)), r);
              state.fetched += page.rows.length;
              state.cursor = page.nextCursor || state.cursor;
              state.exhausted = !page.nextCursor;
              pool[key] = state;
            }
            const c = await deps.sources.call<Counts>("/count", overtureQuery(plan, seg)).catch(() => undefined);
            if (c) {
              r.closed = c.closed;
              r.excluded += c.noChannel;
            }
            r.status = r.found ? (state.exhausted ? "ok" : "partial") : "empty";
            r.message = `${r.found} places with a reach-out channel${c ? `; ${c.noChannel} listings without any channel and ${c.closed} closed places were left out` : ""}.` + (state.exhausted ? "" : " More remain; the next top-up continues from here.") + (r.message ? " " + r.message.trim() : "");
          } catch (e) {
            r.status = r.found ? "partial" : "failed";
            r.message = msg(e);
          }
        reports.push(r);
      }
      // 2. OpenStreetMap: one query per area or chunk (districts / states).
      if (plan.osm && src.tags.length && need() > 0) {
        const chunks: { id: string; name: string; area: OsmArea }[] = [];
        const r = report({ source: "OpenStreetMap", scope: plan.tier, area: plan.label, segment: seg.label, status: "ok" });
        try {
          if (plan.osm.area) chunks.push({ id: "all", name: plan.label, area: plan.osm.area });
          else if (plan.osm.chunkOf) {
            await paceOsm();
            const { areas } = (await deps.discover({ action: "subareas", ...plan.osm.chunkOf })) as { areas: { name: string; areaId: number }[] };
            // The home state has its own tier.
            for (const a of areas) if (!(plan.tier === "country" && a.areaId === geo.state?.areaId)) chunks.push({ id: String(a.areaId), name: a.name, area: { kind: "area", areaId: a.areaId } });
          }
        } catch (e) {
          r.status = "failed";
          r.message = `Area list unavailable: ${msg(e)}`;
        }
        let failed = 0, searched = 0;
        for (const chunk of chunks) {
          if (need() <= 0) break;
          const key = `${plan.tier}|${seg.id}|osm|${plan.country.code}|${chunk.id}`;
          if (pool[key]?.exhausted && !options.fetchAll) continue;
          await paceOsm();
          try {
            const { elements } = (await deps.discover({ action: "osm", query: { tags: src.tags, exclude: seg.exclude, area: chunk.area, excludeAreas: plan.osm.excludeAreas } })) as { elements: never[] };
            const mapped = osmProjectLeads(project, elements, { tier: plan.tier, segmentId: seg.id, tags: src.tags, base: plan.base, country: plan.country.code });
            r.closed += mapped.closed;
            r.excluded += mapped.noChannel;
            record(mapped.leads, r);
            pool[key] = { cursor: "", exhausted: true, fetched: mapped.leads.length };
            searched++;
          } catch (e) {
            failed++;
            r.message += `${chunk.name}: ${msg(e)}. `;
          }
        }
        if (chunks.length) {
          r.status = failed ? (r.found ? "partial" : "failed") : r.found ? "ok" : "empty";
          r.message = `${r.found} listings with a reach-out channel from ${searched} of ${chunks.length} area${chunks.length === 1 ? "" : "s"}` +
            (r.excluded ? `; ${r.excluded} without any channel` : "") + (r.closed ? `; ${r.closed} closed or disused` : "") + ". " + r.message;
        }
        if (chunks.length || r.status === "failed") reports.push(r);
      }
      // 3. Wikidata, for occupation segments.
      if (plan.wikidata && src.occupations.length && need() > 0) {
        const countryQid = plan.wikidata.scope === "global" ? plan.country.wikidata : geo.country?.wikidata;
        const r = report({ source: "Wikidata", scope: plan.tier, area: plan.label, segment: seg.label, status: "ok" });
        const key = `${plan.tier}|${seg.id}|wd|${plan.country.code}`;
        const state = pool[key] ? { ...pool[key] } : { cursor: "", exhausted: false, fetched: 0 };
        if (!countryQid) {
          r.status = "skipped";
          r.message = "No Wikidata identifier is known for this country.";
        } else
          try {
            while (need() > 0 && !state.exhausted) {
              const page = (await deps.discover({ action: "wikidata", occupations: src.occupations, countryQid, scope: plan.wikidata.scope, geo, after: Number(state.cursor || 0) })) as { rows: never[]; cursor?: number };
              const mapped = wikidataProjectLeads(project, page.rows, { tier: plan.tier, segmentId: seg.id, category: seg.categories[0] ?? seg.label, country: plan.country.code });
              r.excluded += mapped.invalid;
              record(mapped.leads, r);
              state.cursor = page.cursor ? String(page.cursor) : state.cursor;
              state.exhausted = page.cursor === undefined;
              pool[key] = state;
            }
            r.status = r.found ? "ok" : "empty";
            r.message = "Notable people and organisations with a published profile or website; location from residence or birthplace." + (r.message ? " " + r.message.trim() : "");
          } catch (e) {
            r.status = r.found ? "partial" : "failed";
            r.message = msg(e);
          }
        reports.push(r);
      }
    }
    await deps.checkpoint?.(incoming.slice(), reports.slice(), { ...pool });
  }
  // 3b. Below the floor: search neighbouring categories (salons and spas around a makeup artist)
  // in the same areas, nearest tier first, until the project holds MIN_POOL available leads.
  const totalAvailable = () => running.filter((l) => l.project?.delivery.status === "available").length;
  if (health && totalAvailable() < MIN_POOL)
    for (const plan of plans) {
      if (!plan.overture || !health.extracts.some((e) => e.country === plan.country.code)) continue;
      for (const seg of p.segments) {
        const related = relatedCategories(seg.categories);
        const key = `${plan.tier}|${seg.id}|ov+|${plan.country.code}`;
        const state = pool[key] ? { ...pool[key] } : { cursor: "", exhausted: false, fetched: 0 };
        if (!related.length || state.exhausted || totalAvailable() >= MIN_POOL) continue;
        deps.onProgress?.({ done: step, total, label: `Related categories · ${seg.label} · ${plan.label}` });
        const r = report({ source: "Overture Maps (related categories)", scope: plan.tier, area: plan.label, segment: seg.label, status: "ok" });
        try {
          while (totalAvailable() < MIN_POOL && !state.exhausted) {
            const page = await deps.sources.call<{ rows: OvertureRow[]; nextCursor: string; release: string }>("/search", {
              ...overtureQuery(plan, seg, related),
              cursor: state.cursor,
              limit: Math.min(1000, Math.max(100, MIN_POOL - totalAvailable())),
            });
            record(page.rows.map((row) => overtureLead(project, row, { tier: plan.tier, segmentId: seg.id, base: plan.base }, page.release)), r);
            state.fetched += page.rows.length;
            state.cursor = page.nextCursor || state.cursor;
            state.exhausted = !page.nextCursor;
            pool[key] = state;
          }
          r.status = r.found ? (state.exhausted ? "ok" : "partial") : "empty";
          r.message = `${r.found} places from neighbouring categories, added because the pool was below ${MIN_POOL}.`;
        } catch (e) {
          r.status = r.found ? "partial" : "failed";
          r.message = msg(e);
        }
        reports.push(r);
      }
    }
  const short = MIN_POOL - totalAvailable();
  if (health && short > 0)
    reports.push(report({ source: "Plan", scope: "all", status: "partial", message: `Only ${totalAvailable()} leads exist for these segments and areas, ${short} short of ${MIN_POOL}. Add the State or Country tier, or more categories, to reach ${MIN_POOL}.` }));
  // 4. Website enrichment for leads with a website but no email or Instagram.
  if (p.enrich && health) {
    const r = report({ source: "Website enrichment", scope: "all", status: "ok" });
    const candidates = running.filter((l) => l.website && !l.email && !l.creator?.instagram && !l.project?.provenance.enrichedAt);
    try {
      for (let i = 0; i < candidates.length; i += 50) {
        deps.onProgress?.({ done: 0, total: 0, label: `Reading contact pages: ${i} of ${candidates.length} websites` });
        const batch = candidates.slice(i, i + 50);
        const { results } = await deps.sources.call<{ results: EnrichResult[] }>("/enrich", { items: batch.map((l) => ({ id: l.id, url: l.website })) });
        const enriched = applyEnrichment(batch, results, today);
        r.found += batch.length;
        r.added += enriched.filter((l, k) => l !== batch[k] && (l.email !== batch[k].email || l.creator?.instagram !== batch[k].creator?.instagram)).length;
        r.excluded += results.filter((x) => x.status === "blocked").length;
        const byId = new Map(enriched.map((l) => [l.id, l]));
        running = running.map((l) => byId.get(l.id) ?? l);
        incoming.push(...enriched);
      }
      r.message = `${r.found} websites read (homepage plus one contact page each); ${r.added} gained an email or Instagram; ${r.excluded} skipped because robots.txt disallows it.`;
    } catch (e) {
      r.status = r.found ? "partial" : "failed";
      r.message = msg(e);
    }
    if (candidates.length) reports.push(r);
  }
  return { incoming, reports, pool, geo };
}

/** Fills empty email, phone and social fields from enrichment, recording the page each came from. */
export function applyEnrichment(leads: Lead[], results: EnrichResult[], today = localDate()): Lead[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return leads.map((l) => {
    const r = byId.get(l.id);
    if (!r || !l.project) return l;
    const provenance: Record<string, string> = { ...l.project.provenance, enrichedAt: today };
    let email = l.email, phone = l.phone, creator = l.creator;
    if (!email && r.emails[0]) [email, provenance.email] = [r.emails[0].value, r.emails[0].page];
    if (!phone && r.phones[0]) [phone, provenance.phone] = [r.phones[0].value, r.phones[0].page];
    const social = socialFields(r.socials.map((s) => s.value));
    if (social) {
      const merged = { ...(creator ?? { ...social, instagram: "", instagramUrl: "", facebookUrl: "", linkedinUrl: "", youtubeUrl: "", tiktokUrl: "" }) };
      const hosts = { instagram: /instagram\.com/, instagramUrl: /instagram\.com/, facebookUrl: /facebook\.com|fb\.com/, linkedinUrl: /linkedin\.com/, youtubeUrl: /youtube\.com/, tiktokUrl: /tiktok\.com/ };
      for (const k of Object.keys(hosts) as (keyof typeof hosts)[])
        if (!merged[k] && social[k]) {
          merged[k] = social[k];
          const src = r.socials.find((s) => hosts[k].test(s.value))?.page;
          if (src) provenance[k === "instagramUrl" ? "instagram" : k] = src;
        }
      creator = merged;
    }
    return { ...l, email, phone, creator, project: { ...l.project, provenance } };
  });
}
