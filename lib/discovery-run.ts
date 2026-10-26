// Client-side orchestration: runs each planned source/tier step in priority
// order, follows paged results to the end, merges as it goes and records a
// report for every step. Nothing is capped.
import type { Campaign, DiscoveryReport, Lead, Workspace } from "./leadgen.ts";
import { areaName, mergeDiscovered, sourceNames, type Geo, type Step } from "./discovery-engine.ts";

export type Call = (body: unknown) => Promise<unknown>;
export type Plan = { geo: Geo; steps: Step[]; skipped: DiscoveryReport[]; report: DiscoveryReport[] };
export type Progress = { done: number; total: number; label: string };
/** Called with everything found so far, so long runs can save as they go. */
export type Checkpoint = (incoming: Lead[], reports: DiscoveryReport[]) => Promise<void>;
type Result = { leads: Lead[]; report: DiscoveryReport; cursor?: number };

const OSM_GAP_MS = 4000;
const tierOf = (scope: string) => ({ locality: 0, city: 1, state: 2, country: 3, global: 4 })[scope] ?? 5;

export async function runDiscovery(
  campaign: Campaign,
  state: Workspace,
  call: Call,
  onProgress: (p: Progress) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  checkpoint: Checkpoint = async () => {},
) {
  const plan = (await call({ action: "plan", campaign })) as Plan;
  const reports: DiscoveryReport[] = [...plan.report];
  let running = state.leads;
  const incoming: Lead[] = [];
  // Sources whose nearer-tier search failed even after a retry. Their wider
  // searches are postponed so farther results never displace nearer ones.
  const blocked = new Map<string, string>();
  const postponed: Record<string, number> = {};
  const failure = (step: Step, e: unknown): Result => ({
    leads: [],
    report: { source: sourceNames[step.source], scope: step.scope, area: step.region?.name ?? areaName(plan.geo, step.scope), status: "failed", found: 0, added: 0, refreshed: 0, message: e instanceof Error ? e.message : "Request failed." },
  });
  // Runs a step and follows its pages to the end, combining them.
  const attempt = async (step: Step): Promise<Result> => {
    const pages: Result[] = [];
    let cursor = step.cursor;
    do {
      let page: Result;
      try {
        page = (await call({ action: "step", campaign, geo: plan.geo, step: { ...step, cursor } })) as Result;
      } catch (e) {
        page = failure(step, e);
      }
      pages.push(page);
      cursor = page.report.status === "failed" ? undefined : page.cursor;
      if (cursor !== undefined)
        onProgress({ done: 0, total: 0, label: `Fetching more ${sourceNames[step.source]} results (${pages.reduce((n, p) => n + p.leads.length, 0)} so far)` });
    } while (cursor !== undefined);
    const failed = pages.find((p) => p.report.status === "failed");
    const leads = pages.flatMap((p) => p.leads);
    const last = pages[pages.length - 1].report;
    return {
      leads,
      report: {
        ...last,
        status: failed ? (leads.length ? "partial" : "failed") : leads.length ? "ok" : "empty",
        found: leads.length,
        message:
          failed && leads.length
            ? `${failed.report.message} (${leads.length} results were received before the failure)`
            : last.message.replace(" More results follow in the next page.", ""),
      },
    };
  };
  const record = (result: Result) => {
    const merged = mergeDiscovered(running, result.leads);
    running = merged.leads;
    incoming.push(...result.leads);
    const duplicates = result.leads.length - merged.refreshed - merged.added.length;
    reports.push({
      ...result.report,
      added: merged.added.length,
      refreshed: merged.refreshed,
      message: result.report.message + (duplicates > 0 ? ` ${duplicates} were already listed under another source or tier.` : ""),
    });
  };
  let failed: Step[] = [];
  const retryFailed = async () => {
    if (!failed.length) return;
    const retry = failed;
    failed = [];
    // Give a rate-limited or busy service a moment before the single retry.
    await wait(15000);
    for (const step of retry) {
      onProgress({ done: 0, total: 0, label: `Retrying ${sourceNames[step.source]} · ${step.region?.name ?? step.scope}` });
      const result = await attempt(step);
      if (result.report.status === "failed") {
        result.report.message += " (failed again after a retry)";
        if (!blocked.has(step.source)) blocked.set(step.source, result.report.area || step.scope);
      } else result.report.message += " (succeeded on retry)";
      record(result);
    }
  };
  // Public OpenStreetMap servers limit each client; space queries out.
  let lastOsm = 0;
  const pace = async () => {
    const gap = Date.now() - lastOsm;
    if (lastOsm && gap < OSM_GAP_MS) await wait(OSM_GAP_MS - gap);
  };
  const steps = plan.steps.slice();
  let sinceCheckpoint = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const previous = steps[i - 1];
    if (previous && tierOf(previous.scope) !== tierOf(step.scope)) {
      await retryFailed();
      // Save what each tier found before moving on to a wider one.
      await checkpoint(incoming.slice(), reports.slice());
      sinceCheckpoint = 0;
    } else if (sinceCheckpoint >= 5) {
      await checkpoint(incoming.slice(), reports.slice());
      sinceCheckpoint = 0;
    }
    sinceCheckpoint++;
    onProgress({ done: i, total: steps.length, label: `${sourceNames[step.source]} · ${step.region?.name ?? step.scope}` });
    if (blocked.has(step.source)) {
      postponed[step.source] = (postponed[step.source] || 0) + 1;
      continue;
    }
    if (step.source === "osm" && step.scope === "country" && !step.region) {
      // The country's regions are loaded only when this tier is reached, then
      // searched one at a time, nearest first.
      await pace();
      const loadRegions = async () => ((await call({ action: "regions", geo: plan.geo })) as { regions: Step["region"][] }).regions;
      try {
        let regions: Step["region"][];
        try {
          regions = await loadRegions();
        } catch {
          await wait(15000);
          regions = await loadRegions();
        }
        steps.splice(i + 1, 0, ...regions.map((region) => ({ ...step, region })));
      } catch (e) {
        reports.push({ source: sourceNames.osm, scope: "country", area: plan.geo.country?.name ?? "", status: "failed", found: 0, added: 0, refreshed: 0, message: `Region list unavailable, so the country tier was not searched on OpenStreetMap (${e instanceof Error ? e.message : "error"}).` });
      }
      lastOsm = Date.now();
      continue;
    }
    if (step.source === "osm") await pace();
    const result = await attempt(step);
    if (step.source === "osm") lastOsm = Date.now();
    if (result.report.status === "failed") {
      // Recorded after the tier's retry so the report shows the final outcome.
      failed.push(step);
      continue;
    }
    record(result);
  }
  await retryFailed();
  for (const [id, area] of blocked) {
    const n = postponed[id];
    if (n)
      reports.push({ source: sourceNames[id as Step["source"]], scope: "all", area: "", status: "skipped", found: 0, added: 0, refreshed: 0, message: `${n} wider searches were postponed because the ${area} search failed, so farther results would not replace nearer ones. Run discovery again to retry.` });
  }
  onProgress({ done: steps.length, total: steps.length, label: "Saving" });
  return { incoming, reports: [...reports, ...plan.skipped], geo: plan.geo };
}
