// Data quality for custom lead projects, run through the local sources
// service: email domain checks, website status, and re-confirming leads whose
// last source check is older than 90 days. Nothing is deleted or hidden: a
// record the source no longer lists is noted on the lead and reported.
import { localDate, now, type Campaign, type Lead } from "./leadgen.ts";
import { refreshLead } from "./dedupe.ts";
import { overtureLead, type OvertureRow } from "./project-sources.ts";
import { osmProjectLeads } from "./project-osm.ts";
import type { CustomProject, ProjectReport } from "./project-schema.ts";

type Project = Campaign & { custom: CustomProject };
type Call = <T>(route: string, body: unknown) => Promise<T>;
export const STALE_DAYS = 90;
const daysSince = (d: string, today: string) => (Date.parse(today) - Date.parse(d.slice(0, 10))) / 86400000;

/** Email check (MX lookup) and website status for leads that have not been checked. */
export async function contactChecks(leads: Lead[], call: Call, recheck = false) {
  const out = new Map<string, Lead>();
  const set = (l: Lead, patch: Partial<NonNullable<Lead["project"]>>) => {
    const cur = out.get(l.id) ?? l;
    out.set(l.id, { ...cur, project: { ...cur.project!, ...patch } });
  };
  let unknown = 0;
  const needEmail = leads.filter((l) => l.project && l.email && (recheck || !l.project.emailCheck));
  for (let i = 0; i < needEmail.length; i += 500) {
    const batch = needEmail.slice(i, i + 500);
    const { results } = await call<{ results: { email: string; result: "valid domain" | "no mail server" | "invalid" | "unknown" }[] }>("/check-email", { emails: batch.map((l) => l.email) });
    // "unknown" (the DNS lookup failed) is not stored, so the lead is checked again later.
    batch.forEach((l, k) => {
      const result = results[k].result;
      if (result === "unknown") unknown++;
      else set(l, { emailCheck: result });
    });
  }
  const needSite = leads.filter((l) => l.project && l.website && (recheck || !l.project.websiteStatus));
  for (let i = 0; i < needSite.length; i += 300) {
    const batch = needSite.slice(i, i + 300);
    const { results } = await call<{ results: { url: string; result: "live" | "redirects" | "dead" | "timeout" }[] }>("/check-website", { urls: batch.map((l) => l.website) });
    batch.forEach((l, k) => set(l, { websiteStatus: results[k].result }));
  }
  const changed = [...out.values()];
  const count = (k: "emailCheck" | "websiteStatus", v: string) => changed.filter((l) => l.project![k] === v).length;
  return {
    leads: changed,
    summary: {
      emails: needEmail.length,
      validDomain: count("emailCheck", "valid domain"),
      noMailServer: count("emailCheck", "no mail server"),
      invalid: count("emailCheck", "invalid"),
      unknown,
      websites: needSite.length,
      live: count("websiteStatus", "live"),
      redirects: count("websiteStatus", "redirects"),
      dead: count("websiteStatus", "dead"),
      timeout: count("websiteStatus", "timeout"),
    },
  };
}

export const staleLeads = (leads: Lead[], today = localDate(), days = STALE_DAYS) =>
  leads.filter((l) => l.project && (!l.checkedAt || daysSince(l.checkedAt, today) > days));

const note = (l: Lead, event: string): Lead => ({ ...l, history: [...l.history, { at: now(), event }].slice(-500) });

/**
 * Re-confirms stale leads against their sources: Overture records by GERS id
 * in the newest extract, OpenStreetMap elements by id. Found records refresh
 * the lead (check date, empty fields); records no longer listed or marked
 * closed are noted on the lead and counted, never removed silently.
 */
export async function recheckStale(
  project: Project,
  leads: Lead[],
  deps: { call: Call; discover: (body: unknown) => Promise<unknown> },
  today = localDate(),
) {
  const stale = staleLeads(leads.filter((l) => l.campaignId === project.id), today);
  const home = project.custom.base.country?.code || "IN";
  const out = new Map<string, Lead>();
  const reports: ProjectReport[] = [];
  const report = (source: string): ProjectReport => ({ source, scope: "all", area: "Re-check", segment: "", status: "ok", found: 0, added: 0, refreshed: 0, excluded: 0, closed: 0, suppressed: 0, message: "" });
  // Overture, by country extract.
  const ov = report("Overture Maps (re-check)");
  const byCountry = new Map<string, Lead[]>();
  for (const l of stale)
    if (l.project!.sourceIds.some((s) => s.startsWith("ov:"))) {
      const cc = l.project!.country || home;
      byCountry.set(cc, [...(byCountry.get(cc) ?? []), l]);
    }
  let missing = 0;
  try {
    for (const [country, list] of byCountry)
      for (let i = 0; i < list.length; i += 2000) {
        const batch = list.slice(i, i + 2000);
        const idOf = (l: Lead) => l.project!.sourceIds.find((s) => s.startsWith("ov:"))!.slice(3);
        const r = await deps.call<{ rows: OvertureRow[]; missing: string[]; release: string }>("/lookup", { country, ids: batch.map(idOf) });
        const rows = new Map(r.rows.map((x) => [x.id, x]));
        for (const l of batch) {
          const row = rows.get(idOf(l));
          if (!row) {
            missing++;
            out.set(l.id, note(l, `Not listed in Overture release ${r.release}; it may have closed or moved. Check before contacting.`));
          } else if (row.operating_status === "permanently_closed") {
            ov.closed++;
            out.set(l.id, note({ ...l, checkedAt: today }, `Overture release ${r.release} marks this place as permanently closed. Check before contacting.`));
          } else {
            const fresh = overtureLead(project, row, { tier: l.project!.tier, segmentId: l.project!.segmentId }, r.release);
            out.set(l.id, refreshLead(l, { ...fresh, checkedAt: today }));
            ov.refreshed++;
          }
        }
        ov.found += batch.length;
      }
    ov.message = `${ov.refreshed} re-confirmed, ${ov.closed} marked closed by the source, ${missing} no longer listed (noted on each lead).`;
    ov.status = ov.found ? "ok" : "empty";
  } catch (e) {
    ov.status = ov.refreshed ? "partial" : "failed";
    ov.message = e instanceof Error ? e.message : "Re-check failed.";
  }
  if (ov.found || ov.status === "failed") reports.push(ov);
  // OpenStreetMap, by element id.
  const osm = report("OpenStreetMap (re-check)");
  const osmStale = stale.filter((l) => l.project!.sourceIds.some((s) => s.startsWith("osm:")));
  try {
    for (let i = 0; i < osmStale.length; i += 300) {
      const batch = osmStale.slice(i, i + 300);
      const idOf = (l: Lead) => l.project!.sourceIds.find((s) => s.startsWith("osm:"))!.slice(4);
      const { elements } = (await deps.discover({ action: "osm-ids", ids: batch.map(idOf) })) as { elements: never[] };
      const mapped = osmProjectLeads(project, elements, { tier: "city", segmentId: "", tags: [] });
      const byId = new Map(mapped.leads.map((m) => [m.project!.sourceIds[0].slice(4), m]));
      for (const l of batch) {
        const found = byId.get(idOf(l));
        const base = out.get(l.id) ?? l;
        if (found) {
          out.set(l.id, refreshLead(base, { ...found, project: { ...found.project!, tier: l.project!.tier, segmentId: l.project!.segmentId }, checkedAt: today }));
          osm.refreshed++;
        } else out.set(l.id, note(base, "No longer found on OpenStreetMap with a reach-out channel, or now marked closed. Check before contacting."));
      }
      osm.found += batch.length;
    }
    osm.message = `${osm.refreshed} re-confirmed; ${osm.found - osm.refreshed} not found (noted on each lead).`;
  } catch (e) {
    osm.status = osm.refreshed ? "partial" : "failed";
    osm.message = e instanceof Error ? e.message : "Re-check failed.";
  }
  if (osm.found || osm.status === "failed") reports.push(osm);
  const wd = stale.filter((l) => l.project!.sourceIds.every((s) => s.startsWith("wd:"))).length;
  if (wd) reports.push({ ...report("Wikidata (re-check)"), status: "skipped", message: `${wd} Wikidata-only leads are not re-checked automatically; run discovery to refresh them.` });
  return { leads: [...out.values()], reports, stale: stale.length };
}
