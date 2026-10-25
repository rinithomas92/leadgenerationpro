// One workbook per campaign: every lead with all its details, the latest
// discovery report and a short campaign summary.
import { localDate, type Campaign, type Lead } from "./leadgen.ts";
import { creatorRows, exportWidths, followerRangeLabel, glossConfig, isGloss } from "./gloss.ts";
import { hasChannel, scopeRank } from "./discovery-engine.ts";
import { xlsxBook } from "./xlsx.ts";

export function campaignWorkbook(campaign: Campaign, leads: Lead[], today = localDate()) {
  // Nearest tiers first, then the order in which leads were found.
  const ordered = leads
    .map((l, i) => ({ l, i }))
    .sort((a, b) => scopeRank(a.l.scope) - scopeRank(b.l.scope) || a.i - b.i)
    .map(({ l }) => l);
  const d = campaign.discovery;
  const g = isGloss(campaign) ? glossConfig(campaign) : undefined;
  const summary: (string | number)[][] = [
    ["Field", "Value"],
    ["Campaign", campaign.name],
    ["Audience", campaign.audience],
    ["Location", campaign.location],
    ["Status", campaign.status],
    ...(g
      ? [
          ["Professions", g.professions.join(", ")],
          ["Platforms", g.platforms.join(", ")],
          ["Follower range", followerRangeLabel(g)],
          ["Keywords", g.keywords],
        ]
      : [["Markets", campaign.markets.map((m) => m.name).join(", ")]]),
    ["Total leads", ordered.length],
    ["Leads with a reach-out channel", ordered.filter(hasChannel).length],
    ["Leads with a phone number", ordered.filter((l) => l.phone).length],
    ["Leads with an email", ordered.filter((l) => l.email).length],
    ["Leads with a website", ordered.filter((l) => l.website).length],
    ["Leads with Instagram", ordered.filter((l) => l.creator?.instagram || l.creator?.instagramUrl).length],
    ["Last discovery run", d?.lastRunAt?.slice(0, 10) || "Not run"],
    ["Exported", today],
    ["Sources", "OpenStreetMap contributors (ODbL); Wikidata (CC0); your imports and manual entries. Verify details before outreach."],
  ];
  const report: (string | number)[][] = [
    ["Source", "Area", "Status", "Found", "Added", "Re-confirmed", "Notes"],
    ...(d?.lastReport ?? []).map((r) => [r.source, r.area || r.scope, r.status, r.found, r.added, r.refreshed, r.message]),
  ];
  const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campaign";
  return {
    filename: `${slug}-leads-${today}.xlsx`,
    body: xlsxBook([
      { name: "Leads", rows: creatorRows(ordered), widths: exportWidths },
      { name: "Discovery report", rows: report, widths: [26, 24, 14, 10, 10, 14, 90] },
      { name: "Campaign", rows: summary, widths: [32, 90] },
    ]),
  };
}
