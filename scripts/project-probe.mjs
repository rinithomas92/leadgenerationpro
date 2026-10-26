// Runs a custom-project discovery against the live public sources from the
// command line and prints counts and sample leads with their sources.
//
//   node --experimental-strip-types scripts/project-probe.mjs "Baner, Pune" --segment "Architects"
//   node --experimental-strip-types scripts/project-probe.mjs "Baner, Pune" --category cafe --tags amenity=cafe
//   options: --tiers locality,city,state  --size 50  --include word  --exclude word  --occupation Q42973
//
// Overture is used when the sources service is running (npm run sources).
import { newCustomCampaign } from "../lib/project.ts";
import { availability, topUp } from "../lib/project-run.ts";
import { osmSearch, projectPlan, resolveCountry, subAreas, wikidataPage } from "../lib/project-net.ts";
import { sourcesCall, sourcesHealth } from "../lib/project-sources.ts";
import { segmentSources, suggestCategories } from "../lib/categories.ts";

const args = process.argv.slice(2);
const opt = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const location = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) || "Baner, Pune";
// --segment "Architects" resolves categories through the synonym file and taxonomy.
const segmentLabel = opt("segment");
const category = opt("category") || (segmentLabel ? suggestCategories(segmentLabel, 1)[0]?.id : "") || "architect";
const tags = opt("tags")
  .split(",")
  .filter(Boolean)
  .map((t) => {
    const [key, values] = t.split("=");
    return { key, values: values.split("|"), category };
  });
const campaign = newCustomCampaign({
  name: "Probe",
  description: "Command-line discovery probe.",
  location,
  project: {
    segments: [{ id: "s1", label: segmentLabel || category, categories: segmentLabel ? suggestCategories(segmentLabel, 3).filter((x) => x.via === "synonym").map((x) => x.id).concat(category).filter((x, i, a) => a.indexOf(x) === i) : [category], include: opt("include") ? [opt("include")] : [], exclude: opt("exclude") ? [opt("exclude")] : [] }],
    tiers: opt("tiers", "locality,city").split(","),
    enrich: args.includes("--enrich"),
  },
});
const deps = {
  discover: async (b) => {
    if (b.action === "plan") return projectPlan(b.location);
    if (b.action === "country") return resolveCountry(b.code);
    if (b.action === "subareas") return { areas: await subAreas(b.areaId, b.level) };
    if (b.action === "osm") return osmSearch(b.query, !!b.count);
    if (b.action === "wikidata") return wikidataPage(b.occupations, b.countryQid, b.scope, b.geo, b.after);
    throw new Error(b.action);
  },
  sources: { health: () => sourcesHealth(), call: (route, body) => sourcesCall(route, body) },
  // Tags from --tags, otherwise from the category crosswalk.
  sourcesFor: (seg) => (tags.length ? { tags, occupations: opt("occupation") ? [opt("occupation")] : [] } : segmentSources(seg)),
  onProgress: (p) => process.stderr.write(`  ${p.label}\n`),
};
console.log(`Location: ${location} · category ${category} · tags ${JSON.stringify(tags.map((t) => `${t.key}=${t.values.join("|")}`))}`);
console.log(`Sources service: ${(await deps.sources.health()) ? "running" : "offline (OpenStreetMap and Wikidata only)"}`);
const avail = await availability(campaign, deps);
console.log("\nAvailability (estimates):");
for (const r of avail.rows)
  console.log(`  ${r.label.padEnd(10)} Overture ${r.overture ? `${r.overture.reachable} reachable of ${r.overture.total}` : "-"} · OSM ${r.osm ?? "-"}${r.notes.length ? ` · ${r.notes.join(" ")}` : ""}`);
const result = await topUp(campaign, [], deps, { size: Number(opt("size", "50")) });
console.log("\nSource report:");
for (const r of result.reports) console.log(`  [${r.status}] ${r.source} · ${r.area || r.scope}${r.segment ? ` · ${r.segment}` : ""}: found ${r.found}, added ${r.added}. ${r.message}`);
const leads = [...new Map(result.incoming.map((l) => [l.project.dedupeKey, l])).values()];
console.log(`\n${leads.length} leads. Samples:`);
for (const l of leads.slice(0, 10))
  console.log(`  ${l.name} · ${l.project.tier} · ${l.project.distanceKm ?? "?"} km · ${[l.phone, l.email, l.website].filter(Boolean).join(" · ")} · fit ${l.score}\n    source: ${l.source || l.sourceLabel}`);
