// Live check of the discovery engine against the real public sources (no API
// keys). Writes the same per-campaign workbook the app produces.
// Usage: node --experimental-strip-types scripts/discovery-probe.mjs "Baner, Pune" [--audience "Creator Partners"] [--xlsx out.xlsx]
import { writeFileSync } from "node:fs";
import { emptyWorkspace, newCampaign } from "../lib/leadgen.ts";
import { glossMarkets } from "../lib/gloss.ts";
import { mergeDiscovered, plan } from "../lib/discovery-engine.ts";
import { loadRegions, resolveGeo, runStep } from "../lib/discovery-net.ts";
import { runDiscovery } from "../lib/discovery-run.ts";
import { campaignWorkbook } from "../lib/campaign-export.ts";

const args = process.argv.slice(2);
const location = args[0] || "Pune";
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const audience = opt("--audience") || "Professional Prospects";
const campaign = newCampaign(0, "", audience);
campaign.location = location;
campaign.name = `${audience} · ${location}`;
campaign.markets = glossMarkets(campaign);
const call = async (body) => {
  if (body.action === "plan") {
    const r = await resolveGeo(body.campaign.location);
    return { ...plan(body.campaign, r.geo), geo: r.geo, report: r.report };
  }
  if (body.action === "regions") return { regions: await loadRegions(body.geo) };
  return runStep(body.campaign, body.geo, body.step);
};
const t0 = Date.now();
const { incoming, reports, geo } = await runDiscovery(campaign, { ...emptyWorkspace(), campaigns: [campaign] }, call, (p) =>
  process.stderr.write(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${p.total ? `step ${p.done}/${p.total} ` : ""}${p.label}\n`),
);
const { leads } = mergeDiscovered([], incoming);
campaign.discovery = { autoRefreshDays: 7, lastRunAt: new Date().toISOString(), lastReport: reports };
console.log(`\n== ${location} · ${audience} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("geo:", JSON.stringify({ locality: geo.locality?.name, city: geo.city?.name, cityArea: geo.city?.areaId, state: geo.state?.name, country: geo.country?.name }));
for (const r of reports)
  console.log(`${r.status.padEnd(9)} ${r.source.padEnd(16)} ${(r.area || r.scope).padEnd(26)} found ${String(r.found).padStart(5)} added ${String(r.added).padStart(5)}  ${r.message.slice(0, 140)}`);
const by = (f) => JSON.stringify(Object.entries(leads.reduce((a, l) => ((a[f(l)] = (a[f(l)] || 0) + 1), a), {})));
console.log("total leads:", leads.length, "by tier:", by((l) => l.scope), "by kind:", by((l) => l.kind));
const count = (f) => leads.filter(f).length;
console.log(`channels: phone ${count((l) => l.phone)}, email ${count((l) => l.email)}, website ${count((l) => l.website)}, instagram ${count((l) => l.creator?.instagram || l.creator?.instagramUrl)}, facebook ${count((l) => l.creator?.facebookUrl)}`);
if (opt("--xlsx")) writeFileSync(opt("--xlsx"), campaignWorkbook(campaign, leads).body);
