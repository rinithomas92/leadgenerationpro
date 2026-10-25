// Excel workbooks for custom lead projects: one per batch (Summary, one sheet
// per tier that has leads, All leads) and a project master workbook. Uses the
// dependency-free writer and the same formula protection as Gloss exports.
import { localDate, type Campaign, type Lead } from "./leadgen.ts";
import { safeSpreadsheetText } from "./gloss.ts";
import { xlsxBook, type CellValue, type Sheet } from "./xlsx.ts";
import { tierLabel } from "./allocation.ts";
import { batchFilename, homeLabel, slug } from "./ledger.ts";
import { canWhatsApp, waLink } from "./phone.ts";
import { funnel, lastEvent } from "./outcomes.ts";
import { outreachLabels } from "./lead-filters.ts";
import { tiers, type ContactEvent, type CustomProject, type Delivery, type Tier } from "./project-schema.ts";
import { readableCategory } from "./categories.ts";

type Project = Campaign & { custom: CustomProject };
const t = safeSpreadsheetText;

export const leadColumns = [
  "Name", "Segment", "Categories", "Tier",
  "Address", "City", "State", "Country", "Distance km",
  "Phone", "WhatsApp Link", "Email", "Email Check", "Website", "Website Status",
  "Instagram", "Facebook", "LinkedIn", "YouTube", "TikTok",
  "Fit Score", "Fit Reasons",
  "Source Name", "Source URL",
  "Outreach Status", "Notes",
  "Batch #", "Given At", "Last Source Check",
] as const;
const widths = [30, 22, 30, 12, 40, 16, 16, 10, 11, 18, 34, 28, 14, 34, 14, 34, 34, 34, 34, 34, 9, 60, 26, 50, 18, 30, 8, 12, 14];
export const draftColumns = ["Draft (WhatsApp)", "WhatsApp Link With Draft", "Draft (Email Subject)", "Draft (Email Body)", "Draft (Instagram)"] as const;

/** Every source of a lead: URLs where they exist, otherwise the record id (e.g. an Overture GERS id). */
const sourceUrls = (l: Lead) =>
  [...new Set((l.project?.sources ?? []).map((s) => s.url || `${s.name} record ${s.id.replace(/^\w+:/, "")}`))].join(" ; ") || l.source;
const sourceNames = (l: Lead) => [...new Set((l.project?.sources ?? []).map((s) => s.name))].join(" ; ") || l.sourceLabel;

export function leadRow(l: Lead, p: CustomProject, withDrafts = false): CellValue[] {
  const x = l.project!;
  const c = l.creator;
  const seg = p.segments.find((s) => s.id === x.segmentId)?.label ?? "";
  const row: CellValue[] = [
    t(l.name), t(seg), t(x.categories.map(readableCategory).join(", ")), tierLabel(x.tier, homeLabel(p)),
    t(x.address), t(x.city || x.locality), t(x.region), t(x.country), x.distanceKm,
    t(l.phone), x.phoneE164 && canWhatsApp(x.phoneType) ? waLink(x.phoneE164) : "", t(l.email), x.emailCheck, t(l.website), x.websiteStatus,
    t(c?.instagramUrl || ""), t(c?.facebookUrl || ""), t(c?.linkedinUrl || ""), t(c?.youtubeUrl || ""), t(c?.tiktokUrl || ""),
    l.score, t(l.reason),
    t(sourceNames(l)), t(sourceUrls(l)),
    outreachLabels[x.outreach.status] ?? x.outreach.status, t(l.notes),
    x.delivery.batch || null, x.delivery.givenAt.slice(0, 10), l.checkedAt,
  ];
  if (withDrafts) {
    const d = x.drafts;
    row.push(
      t(d["WhatsApp"]?.body ?? ""),
      d["WhatsApp"]?.body && x.phoneE164 && canWhatsApp(x.phoneType) ? waLink(x.phoneE164, d["WhatsApp"].body) : "",
      t(d["Email"]?.subject ?? ""),
      t(d["Email"]?.body ?? ""),
      t(d["Instagram DM"]?.body ?? ""),
    );
  }
  return row;
}
const nearestFirst = (a: Lead, b: Lead) => tiers.indexOf(a.project!.tier) - tiers.indexOf(b.project!.tier) || (a.project!.distanceKm ?? 1e9) - (b.project!.distanceKm ?? 1e9) || b.score - a.score;

function leadSheet(name: string, leads: Lead[], p: CustomProject, withDrafts: boolean, extra?: { head: string[]; cells: (l: Lead) => CellValue[] }): Sheet {
  return {
    name,
    rows: [
      [...leadColumns, ...(withDrafts ? draftColumns : []), ...(extra?.head ?? [])],
      ...leads.map((l) => [...leadRow(l, p, withDrafts), ...(extra?.cells(l) ?? [])]),
    ],
    widths: [...widths, ...(withDrafts ? [60, 50, 40, 70, 60] : []), ...(extra?.head.map(() => 16) ?? [])],
  };
}
function briefRows(c: Project): CellValue[][] {
  const p = c.custom;
  return [
    ["Field", "Value"],
    ["Project", t(c.name)],
    ["Business", t(c.description)],
    ["Website", t(c.website)],
    ["Base location", t(c.location)],
    ...p.segments.map((s, i): CellValue[] => [
      `Segment ${i + 1}`,
      t(`${s.label}: ${s.categories.map(readableCategory).join(", ")}` + (s.include.length ? ` · only names with ${s.include.join(", ")}` : "") + (s.exclude.length ? ` · not ${s.exclude.join(", ")}` : "")),
    ]),
    ["Tiers", p.tiers.map((x) => tierLabel(x, homeLabel(p)) + (x === "global" ? ` (${p.countries.join(", ")})` : "")).join(" → ")],
    ["Mode", p.mode === "nearest" ? "Nearest first" : `Split ${p.split.join(" / ")}`],
  ];
}
function reportRows(c: Project): CellValue[][] {
  return [
    ["Source report", "", "", "", "", "", ""],
    ["Source", "Area", "Segment", "Status", "Found", "Added", "Notes"],
    ...c.custom.lastReport.map((r) => [t(r.source), t(r.area || r.scope), t(r.segment), r.status, r.found, r.added, t(r.message)]),
  ];
}
const licence =
  "Sources: Overture Maps Foundation Places (CDLA-Permissive-2.0 / Apache-2.0 per source); OpenStreetMap contributors (ODbL); Wikidata (CC0); website contact pages where noted. Verify details before outreach.";

/** The workbook for one batch: Summary, one sheet per tier that has leads, and All leads. */
export function batchWorkbook(c: Project, delivery: Delivery, allLeads: Lead[], today = localDate()) {
  const p = c.custom;
  const home = homeLabel(p);
  const leads = allLeads.filter((l) => l.campaignId === c.id && l.project?.delivery.id === delivery.id).sort(nearestFirst);
  const withDrafts = leads.some((l) => Object.keys(l.project!.drafts).length > 0);
  const summary: CellValue[][] = [
    ...briefRows(c),
    ["Batch", delivery.seq],
    ["Created", delivery.createdAt.slice(0, 10)],
    ["Requested", delivery.requested],
    ["Delivered", delivery.delivered],
    ["Left out (do-not-contact list)", delivery.suppressed],
    ["Exported", today],
    ["Licences", licence],
    [],
    ["Tier", "Planned", "Actual"],
    ...p.tiers.map((x) => [tierLabel(x, home), delivery.planned[x] ?? 0, delivery.actual.tiers[x] ?? 0]),
    [],
    ["Segment", "Delivered"],
    ...p.segments.map((s) => [t(s.label), delivery.actual.segments[s.id] ?? 0]),
    [],
    ["Notes"],
    ...(delivery.notes.length ? delivery.notes.map((n) => [t(n)]) : [["None: every tier filled its share."]]),
    [],
    ...reportRows(c),
  ];
  const sheets: Sheet[] = [{ name: "Summary", rows: summary, widths: [32, 60, 14, 14, 10, 10, 80] }];
  for (const tier of tiers as readonly Tier[]) {
    let inTier = leads.filter((l) => l.project!.tier === tier);
    if (!inTier.length) continue;
    // The Global sheet is ordered by country.
    if (tier === "global") inTier = inTier.slice().sort((a, b) => a.project!.country.localeCompare(b.project!.country) || nearestFirst(a, b));
    sheets.push(leadSheet(tierLabel(tier, home), inTier, p, withDrafts));
  }
  sheets.push(leadSheet("All leads", leads, p, withDrafts));
  return { filename: delivery.filename || batchFilename(c, delivery.seq, today), body: xlsxBook(sheets) };
}

/** Every lead in the project with delivery and outcome columns, plus an Outcomes sheet. */
export function masterWorkbook(c: Project, allLeads: Lead[], deliveries: Delivery[], events: ContactEvent[], today = localDate(), outcomes?: CellValue[][]) {
  const p = c.custom;
  const leads = allLeads.filter((l) => l.campaignId === c.id && l.project).sort(nearestFirst);
  const withDrafts = leads.some((l) => Object.keys(l.project!.drafts).length > 0);
  const extra = {
    head: ["Delivery Status", "Last Contacted", "Channel", "Template", "Replied At", "Outcome"],
    cells: (l: Lead): CellValue[] => {
      const x = l.project!;
      const out = lastEvent(events, l.id, "outbound");
      return [
        x.delivery.status === "given" ? "Given" : "Available",
        x.outreach.lastContactedAt.slice(0, 10),
        t(out?.channel ?? x.outreach.channel),
        t(out?.templateId ? `${p.templates.find((tp) => tp.id === out.templateId)?.name ?? out.templateId} v${out.templateVersion}` : ""),
        x.outreach.repliedAt.slice(0, 10),
        outreachLabels[x.outreach.status] ?? x.outreach.status,
      ];
    },
  };
  const f = funnel(leads);
  const outcomeRows: CellValue[][] = outcomes ?? [["Step", "Leads"], ...f.map((s) => [s.label, s.count])];
  const batches: CellValue[][] = [
    ["Batch", "Created", "Requested", "Delivered", "Notes"],
    ...deliveries.filter((d) => d.campaignId === c.id).sort((a, b) => a.seq - b.seq).map((d) => [d.seq, d.createdAt.slice(0, 10), d.requested, d.delivered, t(d.notes.join(" "))]),
  ];
  return {
    filename: `${slug(c.name)}-master-${today}.xlsx`,
    body: xlsxBook([
      leadSheet("Leads", leads, p, withDrafts, extra),
      { name: "Outcomes", rows: outcomeRows, widths: [30, 12, 12, 12, 12, 12, 12, 12] },
      { name: "Batches", rows: batches, widths: [8, 12, 10, 10, 90] },
      { name: "Project", rows: [...briefRows(c), ["Exported", today], ["Licences", licence], [], ...reportRows(c)], widths: [32, 60, 14, 14, 10, 10, 80] },
    ]),
  };
}
