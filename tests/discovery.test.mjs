import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, newCampaign } from "../lib/leadgen.ts";
import { glossMarkets, creatorRows, exportColumns } from "../lib/gloss.ts";
import {
  geoFromAreas,
  locationParts,
  mergeDiscovered,
  osmLeads,
  overpassQuery,
  pickPlaces,
  plan,
  resolvePlacesQuery,
  wikidataCandidatesQuery,
  wikidataPlacesQuery,
  classifyCandidates,
  wikidataLeads,
  hasChannel,
  WIKIDATA_PAGE,
} from "../lib/discovery-engine.ts";
import { loadRegions, overpass, resolveGeo, runStep } from "../lib/discovery-net.ts";
import { deduplicate } from "../lib/leadgen.ts";
import { campaignWorkbook } from "../lib/campaign-export.ts";
import { runDiscovery } from "../lib/discovery-run.ts";

// Shapes recorded from the live Overpass and Wikidata responses.
const placeNodes = [
  { type: "node", id: 16174445, lat: 18.521, lon: 73.855, tags: { place: "city", name: "Pune", population: "3115431", wikidata: "Q1538" } },
  { type: "node", id: 245684728, lat: 19.532, lon: 82.809, tags: { place: "village", name: "Baner" } },
  { type: "node", id: 6616602606, lat: 18.559, lon: 73.785, tags: { place: "suburb", name: "Baner", wikidata: "Q4801087" } },
  { type: "node", id: 10110454308, lat: 16.754, lon: 74.651, tags: { place: "village", name: "pune" } },
];
const areas = [
  { type: "area", id: 3600304716, tags: { admin_level: "2", name: "India", "name:en": "India", wikidata: "Q668", "ISO3166-1": "IN" } },
  { type: "area", id: 3601950884, tags: { admin_level: "4", name: "Maharashtra", wikidata: "Q1191" } },
  { type: "area", id: 3601986140, tags: { admin_level: "5", name: "Pune District", wikidata: "Q1797336" } },
  { type: "area", id: 3610351626, tags: { admin_level: "6", name: "Pune City Subdistrict", wikidata: "Q7260101" } },
];
const campaign = (audience = "Professional Prospects", location = "Baner, Pune") => {
  const c = newCampaign(0, "", audience);
  c.location = location;
  c.markets = glossMarkets(c);
  return c;
};
const geo = () => {
  const { city, locality } = pickPlaces(locationParts("Baner, Pune"), placeNodes);
  return geoFromAreas("Baner, Pune", city, areas, { name: locality.tags.name, lat: locality.lat, lon: locality.lon });
};

test("locations resolve to the Pune city node, the nearby Baner suburb and enclosing areas", () => {
  assert.deepEqual(locationParts("Pune · Baner"), ["Pune", "Baner"]);
  assert.deepEqual(locationParts("Baner, Pune"), ["Baner", "Pune"]);
  assert.match(resolvePlacesQuery(["baner", "Pune"]), /\["name"="Baner"\]/);
  const { city, locality } = pickPlaces(["Baner", "Pune"], placeNodes);
  assert.equal(city.id, 16174445);
  assert.equal(locality.id, 6616602606, "the far-away village named Baner is ignored");
  const g = geo();
  assert.equal(g.city.areaId, 3601986140, "district-level area covers the metropolitan region");
  assert.equal(g.city.wikidata, "Q1538");
  assert.deepEqual([g.state.name, g.state.wikidata, g.country.code], ["Maharashtra", "Q1191", "IN"]);
});

test("Gloss plans search the locality, then Pune, then the rest of Maharashtra, and report unavailable sources", () => {
  const g = geo();
  const pro = plan(campaign(), g);
  assert.deepEqual(
    pro.steps.map((s) => `${s.source}:${s.scope}`),
    ["osm:locality", "osm:city", "wikidata:city", "osm:state", "wikidata:state"],
    "no country or worldwide searches",
  );
  assert.ok(!pro.skipped.some((r) => r.status === "not-configured"), "no source needs an API key");
  assert.ok(pro.skipped.some((r) => /Instagram/.test(r.source) && /no public search without an account or API key/.test(r.message)));
  const creators = plan(campaign("Creator Partners"), g);
  assert.ok(creators.steps.every((s) => s.source === "wikidata"), "creator partners are people, not map listings");
  const general = newCampaign(3);
  general.markets = [{ name: "Accounting firms", reason: "", needs: "", positioning: "", search: "", score: 50 }];
  assert.deepEqual(plan(general, g).steps.map((s) => `${s.source}:${s.scope}`), ["osm:locality", "research:city", "osm:city"]);
});

test("Overpass queries cover Gloss professions per tier with no result cap", () => {
  const g = geo();
  const c = campaign();
  const locality = overpassQuery(c, g, "locality");
  assert.match(locality, /around:3000,18\.559,73\.785/);
  assert.match(locality, /"shop"="hairdresser"/);
  assert.match(locality, /"shop"~"\^\(beauty\|cosmetics\)\$"/);
  assert.match(locality, /\.r out tags center;/);
  assert.doesNotMatch(locality, /out tags center \d/, "no output limit");
  const state = overpassQuery(c, g, "state");
  assert.match(state, /area\(3601950884\)->\.o;/);
  assert.match(state, /\(\.a; - \.b;\)/, "state tier excludes records already in the city tier");
  assert.doesNotMatch(state, /"name"~/, "costly name matching is limited to locality and city");
});

test("OpenStreetMap elements become leads with contacts, socials, inferred locality and verification dates", () => {
  const g = geo();
  const elements = [
    { type: "node", id: 1, lat: 18.5605, lon: 73.786, tags: { shop: "beauty", name: "Glow Bridal Studio", "contact:phone": "+91 98000 00000;+91 98000 00001", "contact:instagram": "https://www.instagram.com/glow.bridal/", check_date: "2025-11-02" } },
    { type: "way", id: 2, center: { lat: 18.53, lon: 73.85 }, tags: { shop: "hairdresser", name: "Cut Above", website: "https://cut.example", "addr:suburb": "Shivajinagar", email: "hi@cut.example" } },
    { type: "node", id: 1, lat: 18.5605, lon: 73.786, tags: { shop: "beauty", name: "Glow Bridal Studio" } },
    { type: "node", id: 3, lat: 18.559, lon: 73.785, tags: { place: "suburb", name: "Baner" } },
  ];
  const leads = osmLeads(campaign(), g, "city", elements, "2026-10-09");
  assert.equal(leads.length, 2, "place nodes and repeated elements are not leads");
  const [glow, cut] = leads;
  assert.equal(glow.location, "Baner, Pune");
  assert.equal(glow.phone, "+91 98000 00000");
  assert.equal(glow.creator.instagram, "glow.bridal");
  assert.equal(glow.creator.profession, "Bridal Makeup Artist");
  assert.equal(glow.source, "https://www.openstreetmap.org/node/1");
  assert.deepEqual([glow.checkedAt, glow.sourceVerifiedAt, glow.scope, glow.kind], ["2026-10-09", "2025-11-02", "city", "business"]);
  assert.equal(cut.location, "Shivajinagar, Pune");
  assert.equal(cut.email, "hi@cut.example");
  assert.ok(cut.score > 0);
});

test("Wikidata rows are grouped per person and only valid public identifiers are kept", () => {
  const c = campaign("Creator Partners");
  const row = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
  const rows = [
    row({ p: "http://www.wikidata.org/entity/Q1", pLabel: "Asha Model", occ: "http://www.wikidata.org/entity/Q4610556", ig: "asha.models", placeLabel: "Pune", countryLabel: "India", img: "http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg" }),
    row({ p: "http://www.wikidata.org/entity/Q1", pLabel: "Asha Model", occ: "http://www.wikidata.org/entity/Q4610556", yt: "UC1234567890123456789012" }),
    row({ p: "http://www.wikidata.org/entity/Q2", pLabel: "Q2", occ: "http://www.wikidata.org/entity/Q4610556", ig: "nolabel" }),
    row({ p: "http://www.wikidata.org/entity/Q3", pLabel: "Bad Handle", occ: "http://www.wikidata.org/entity/Q4610556", ig: "not a handle!" }),
  ];
  c.gloss.professions = ["Model"];
  const { leads, invalid } = wikidataLeads(c, "city", rows, "2026-10-09");
  assert.equal(leads.length, 1);
  assert.equal(invalid, 2);
  const [asha] = leads;
  assert.equal(asha.creator.instagramUrl, "https://www.instagram.com/asha.models/");
  assert.equal(asha.creator.youtubeUrl, "https://www.youtube.com/channel/UC1234567890123456789012");
  assert.equal(asha.creator.photoUrl, "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=96");
  assert.equal(asha.source, "https://www.wikidata.org/wiki/Q1");
  assert.equal(asha.location, "Pune, India");
  assert.equal(asha.creator.partnership, "Creator Partner");
  const candidates = wikidataCandidatesQuery(c, geo(), "state");
  assert.match(candidates, /\?p wdt:P27 wd:Q668 \./);
  assert.doesNotMatch(candidates, /P131/, "costly place-hierarchy checks run in a separate query");
  assert.match(wikidataCandidatesQuery(c, geo(), "global"), /FILTER NOT EXISTS \{ \?p wdt:P27 wd:Q668 \}/);
  assert.match(wikidataCandidatesQuery(c, geo(), "global", 4242), /FILTER\(\?num > 4242\)[\s\S]*ORDER BY \?num LIMIT 1500/, "keyset paging, no fixed cap");
  assert.match(wikidataPlacesQuery(["Q5"], geo()), /EXISTS \{ \?place wdt:P131\* wd:Q1538 \}.*EXISTS \{ \?place wdt:P131\* wd:Q1191 \}/s);
});

test("Wikidata candidates are assigned to Pune, Maharashtra or the rest of India by their linked places", () => {
  const v = (x) => ({ value: x });
  const e = (q) => v(`http://www.wikidata.org/entity/${q}`);
  const rows = [
    { p: e("Q1"), name: v("In Pune"), place: e("Q100") },
    { p: e("Q1"), name: v("In Pune"), place: e("Q300") },
    { p: e("Q2"), name: v("In Nashik"), place: e("Q200") },
    { p: e("Q3"), name: v("No place") },
    { p: e("Q4"), name: v("In Delhi"), place: e("Q300") },
  ];
  const places = [
    { place: e("Q100"), placeName: v("Pune"), inCity: v("true"), inState: v("true") },
    { place: e("Q200"), placeName: v("Nashik"), inCity: v("false"), inState: v("true") },
    { place: e("Q300"), placeName: v("Delhi"), inCity: v("false"), inState: v("false") },
  ];
  const names = (scope) => [...new Set(classifyCandidates(rows, places, geo(), scope).map((r) => r.pLabel.value))];
  assert.deepEqual(names("city"), ["In Pune"]);
  assert.deepEqual(names("state"), ["In Nashik"]);
  assert.deepEqual(names("country"), ["No place", "In Delhi"]);
  const [pune] = classifyCandidates(rows, places, geo(), "city");
  assert.deepEqual([pune.placeLabel.value, pune.countryLabel.value], ["Pune", "India"]);
  const delhi = classifyCandidates(rows, places, geo(), "country").find((r) => r.pLabel.value === "In Delhi");
  assert.equal(delhi.placeLabel.value, "Delhi");
  assert.equal(delhi.countryLabel, undefined, "a citizen's linked place may be abroad, so no country is appended");
});

test("only outlets with at least one reach-out channel are kept, and every one of them is", async () => {
  const g = geo();
  const el = (id, tags) => ({ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `Outlet ${id}`, ...tags } });
  const elements = [
    el(1, { phone: "+91 98200 00001" }),
    el(2, { website: "https://two.example" }),
    el(3, { "contact:instagram": "outlet.three" }),
    el(4, { "contact:facebook": "outletfour" }),
    el(5, {}),
    el(6, { email: "six@example.com" }),
  ];
  const f = async () => new Response(JSON.stringify({ elements }), { status: 200 });
  const { leads, report } = await runStep(campaign(), g, { source: "osm", scope: "city" }, f);
  assert.deepEqual(leads.map((l) => l.name), ["Outlet 1", "Outlet 2", "Outlet 3", "Outlet 4", "Outlet 6"]);
  assert.ok(leads.every(hasChannel));
  assert.match(report.message, /1 listings publish no contact channel and were left out/);
});

test("branches sharing a brand name and website are all kept; the same map record is not added twice", () => {
  const g = geo();
  const branch = (id) => ({ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "hairdresser", name: "Lakmé Salon", website: "https://www.lakmesalon.in/", "addr:suburb": "Baner" } });
  const [a, b] = osmLeads(campaign(), g, "city", [branch(1), branch(2)]);
  assert.equal(deduplicate([a], [b]).length, 1, "a second branch with the same name, website and locality is kept");
  assert.equal(deduplicate([a], [{ ...a, id: "copy" }]).length, 0, "the same OpenStreetMap node is not added twice");
});

test("Wikidata results are paged to the end with no cap", async () => {
  const c = campaign("Creator Partners");
  const person = (n) => ({ p: { value: `http://www.wikidata.org/entity/Q${n}` }, num: { value: String(n) }, name: { value: `Person ${n}` }, occ: { value: "http://www.wikidata.org/entity/Q935666" }, ig: { value: `person.${n}` } });
  const total = WIKIDATA_PAGE + 25;
  const people = Array.from({ length: total }, (_, i) => person(i + 1));
  const queries = [];
  const f = async (_url, init) => {
    const query = new URLSearchParams(init.body).get("query");
    queries.push(query);
    const after = Number(/FILTER\(\?num > (\d+)\)/.exec(query)[1]);
    const page = people.filter((r) => Number(r.num.value) > after).slice(0, WIKIDATA_PAGE);
    return new Response(JSON.stringify({ results: { bindings: page } }), { status: 200 });
  };
  const all = await runStep(c, geo(), { source: "wikidata", scope: "global" }, f);
  assert.equal(all.leads.length, total);
  assert.equal(all.cursor, undefined);
  // With no time left after the first page, the caller is told where to continue.
  const first = await runStep(c, geo(), { source: "wikidata", scope: "global" }, f, 0);
  assert.equal(first.leads.length, WIKIDATA_PAGE);
  assert.equal(first.cursor, WIKIDATA_PAGE);
  const rest = await runStep(c, geo(), { source: "wikidata", scope: "global", cursor: first.cursor }, f, 0);
  assert.equal(rest.leads.length, 25);
  assert.equal(rest.cursor, undefined);
});

test("refresh re-confirms existing leads without overwriting user data", () => {
  const g = geo();
  const c = campaign();
  const el = (id, extra = {}) => ({ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `Studio ${id}`, ...extra } });
  const first = osmLeads(c, g, "city", [el(1), el(2, { phone: "111" })], "2026-10-01");
  const userEdited = { ...first[1], phone: "user-entered", stage: "Contacted" };
  const later = osmLeads(c, g, "city", [el(1, { phone: "999" }), el(2, { phone: "222" }), el(3), el(4)], "2026-10-09");
  const { leads, added, refreshed } = mergeDiscovered([first[0], userEdited], later, 1);
  assert.equal(refreshed, 2);
  assert.equal(added.length, 1, "capacity of one new lead");
  assert.equal(leads.length, 3);
  assert.equal(leads[0].phone, "999", "empty contact filled from the source");
  assert.equal(leads[1].phone, "user-entered");
  assert.equal(leads[1].stage, "Contacted");
  assert.deepEqual([leads[0].checkedAt, leads[1].checkedAt], ["2026-10-09", "2026-10-09"]);
  assert.match(leads[0].history.at(-1).event, /Re-confirmed by OpenStreetMap/);
});

test("discovery runs every tier in order, follows paged results, reports failures and keeps everything", async () => {
  const c = campaign();
  const g = geo();
  const calls = [];
  const call = async (body) => {
    if (body.action === "plan") return { geo: g, report: [], ...plan(c, g) };
    if (body.action === "regions") return { regions: [{ name: "Goa", areaId: 3600001 }] };
    calls.push(`${body.step.source}:${body.step.region?.name ?? body.step.scope}${body.step.cursor ? "@" + body.step.cursor : ""}`);
    // The Pune search fails once, then succeeds on the retry.
    if (body.step.scope === "city" && body.step.source === "osm" && calls.filter((x) => x === "osm:city").length === 1)
      throw new Error("Overpass timed out");
    const ids = { locality: [1, 2], city: [2, 3, 4], state: [5, 6] }[body.step.scope] || [];
    const leads = body.step.source === "osm" ? osmLeads(c, g, body.step.scope, ids.map((id) => ({ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `S${id}`, phone: `+91 98200 0000${id}` } }))) : [];
    // The Maharashtra Wikidata step returns two pages.
    const paged = body.step.source === "wikidata" && body.step.scope === "state" && !body.step.cursor;
    return { leads, cursor: paged ? 99 : undefined, report: { source: body.step.source, scope: body.step.scope, area: "", status: leads.length ? "ok" : "empty", found: leads.length, added: 0, refreshed: 0, message: "" } };
  };
  const { incoming, reports } = await runDiscovery(c, { ...emptyWorkspace(), campaigns: [c] }, call, () => {}, async () => {});
  assert.equal(calls[0], "osm:locality");
  assert.deepEqual(mergeDiscovered([], incoming).added.map((l) => l.name).sort(), ["S1", "S2", "S3", "S4", "S5", "S6"], "nothing is capped");
  assert.equal(calls.filter((x) => x === "osm:city").length, 2, "a failed step is retried once");
  assert.ok(calls.includes("wikidata:state@99"), "paged results are followed");
  assert.ok(reports.some((r) => /succeeded on retry/.test(r.message)), "the retry outcome is reported");
  assert.ok(!reports.some((r) => /lead limit/i.test(r.message)));
});

test("a nearer search that keeps failing postpones that source's wider searches instead of filling the limit from far away", async () => {
  const c = campaign();
  const g = geo();
  const calls = [];
  let cityAttempts = 0;
  const call = async (body) => {
    if (body.action === "plan") return { geo: g, report: [], ...plan(c, g) };
    const key = `${body.step.source}:${body.step.region?.name ?? body.step.scope}`;
    calls.push(key);
    if (key === "osm:city") {
      cityAttempts++;
      throw new Error("HTTP 429");
    }
    const id = { "osm:locality": 1, "osm:state": 5, "osm:Goa": 6, "osm:Assam": 7 }[key];
    const leads = id ? osmLeads(c, g, body.step.scope, [{ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `S${id}` } }]) : [];
    return { leads, report: { source: body.step.source, scope: body.step.scope, area: "", status: "ok", found: leads.length, added: 0, refreshed: 0, message: "" } };
  };
  const { incoming, reports } = await runDiscovery(c, { ...emptyWorkspace(), campaigns: [c] }, call, () => {}, async () => {});
  assert.equal(cityAttempts, 2);
  assert.ok(!calls.includes("osm:state"), "the wider Maharashtra OpenStreetMap search is postponed");
  assert.ok(calls.includes("wikidata:state"), "other sources continue");
  assert.deepEqual(incoming.map((l) => l.name), ["S1"]);
  assert.ok(reports.some((r) => /1 wider searches were postponed because the Pune search failed/.test(r.message)));
});

test("other regions of the country are searched nearest first", async () => {
  const { regionsByDistance } = await import("../lib/discovery-engine.ts");
  const g = geo();
  const rels = [
    { type: "relation", id: 1, center: { lat: 26.2, lon: 92.9 }, tags: { name: "Assam" } },
    { type: "relation", id: 1950884, center: { lat: 19.4, lon: 76.4 }, tags: { name: "Maharashtra" } },
    { type: "relation", id: 2, center: { lat: 15.3, lon: 74.1 }, tags: { name: "Goa" } },
    { type: "relation", id: 3, center: { lat: 14.5, lon: 75.7 }, tags: { "name:en": "Karnataka", name: "ಕರ್ನಾಟಕ" } },
  ];
  assert.deepEqual(regionsByDistance(rels, g).map((r) => r.name), ["Goa", "Karnataka", "Assam"]);
});

test("Overpass client waits out rate limits instead of failing", async () => {
  const waits = [];
  const responses = [
    new Response("", { status: 429, headers: { "Retry-After": "7" } }),
    new Response(JSON.stringify({ elements: [{ type: "node", id: 2 }] }), { status: 200 }),
  ];
  const hosts = [];
  const f = async (url) => (hosts.push(new URL(url).hostname), responses.shift());
  assert.deepEqual(await overpass("q", f, 60000, async (ms) => waits.push(ms)), [{ type: "node", id: 2 }]);
  assert.deepEqual(waits, [7000]);
  assert.deepEqual(hosts, ["overpass-api.de", "overpass-api.de"], "the main server is retried after the wait");
});

test("Overpass client retries busy servers, treats timeout remarks as failures and reports exhaustion", async () => {
  const responses = [
    new Response("", { status: 504 }),
    new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" }), { status: 200 }),
    new Response(JSON.stringify({ elements: [{ type: "node", id: 1 }] }), { status: 200 }),
  ];
  const seen = [];
  const f = async (url) => (seen.push(new URL(url).hostname), responses.shift());
  const noWait = async () => {};
  assert.deepEqual(await overpass("q", f, 60000, noWait), [{ type: "node", id: 1 }]);
  assert.equal(seen.length, 3);
  const failing = async () => new Response("", { status: 500 });
  await assert.rejects(overpass("q", failing, 60000, noWait), /did not complete \(overpass-api\.de: HTTP 500/);
});

test("the Excel export includes contact details, source, tier and verification dates for every lead", () => {
  const g = geo();
  const [lead] = osmLeads(campaign(), g, "locality", [{ type: "node", id: 7, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: "Glow", phone: "+91 1", email: "a@b.example", "contact:instagram": "glow.pune", check_date: "2025-01-05" } }], "2026-10-09");
  const [header, row] = creatorRows([lead]);
  const col = (n) => row[exportColumns.indexOf(n)];
  assert.equal(header.length, 29);
  assert.equal(col("Instagram Handle"), "@glow.pune");
  assert.equal(col("Phone"), "'+91 1", "too short to be a phone number, so neutralised");
  assert.equal(col("Email"), "a@b.example");
  assert.equal(col("Source URL"), "https://www.openstreetmap.org/node/7");
  assert.match(col("Source Name"), /OpenStreetMap/);
  assert.equal(col("Discovery Area"), "Locality");
  assert.equal(col("Last Verified"), "2025-01-05");
  assert.equal(col("Last Source Check"), "2026-10-09");
  assert.equal(col("Lead Type"), "Business");
});

test("each campaign gets a workbook with all leads, the discovery report and a summary", () => {
  const c = campaign();
  c.discovery = { autoRefreshDays: 7, lastRunAt: "2026-10-09T10:00:00Z", lastReport: [{ source: "OpenStreetMap", scope: "city", area: "Pune", status: "ok", found: 2, added: 2, refreshed: 0, message: "ok" }] };
  const leads = osmLeads(c, geo(), "state", [1, 2, 3].map((id) => ({ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `S${id}`, phone: `+91 98200 0000${id}` } })));
  leads[2].scope = "locality";
  const { body, filename } = campaignWorkbook(c, leads, "2026-10-09");
  assert.equal(filename, "gloss-professional-prospects-leads-2026-10-09.xlsx");
  const text = new TextDecoder().decode(body);
  for (const part of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes('name="Leads"') && text.includes('name="Discovery report"') && text.includes('name="Campaign"'));
  assert.ok(text.indexOf(">S3<") < text.indexOf(">S1<"), "nearest tier first");
});

test("location lookup falls back to Nominatim and Wikidata when either Overpass lookup fails", async () => {
  let overpassCalls = 0;
  const f = async (url, init = {}) => {
    const host = new URL(url).hostname;
    if (host.includes("nominatim")) {
      const q = new URL(url).searchParams;
      const type = q.get("featureType");
      return Response.json([
        type === "state"
          ? { lat: "19.4", lon: "76.4", osm_type: "relation", osm_id: 1950884 }
          : type === "country"
            ? { lat: "22", lon: "79", osm_type: "relation", osm_id: 304716 }
            : { lat: "18.52", lon: "73.85", name: "Pune", osm_type: "node", osm_id: 16174445, extratags: { wikidata: "Q1538" }, address: { state: "Maharashtra", country: "India", country_code: "in" } },
      ]);
    }
    if (host.includes("wikidata")) {
      const v = (x) => ({ value: x });
      return Response.json({ results: { bindings: [{ state: v("http://www.wikidata.org/entity/Q1191"), stateLabel: v("Maharashtra"), country: v("http://www.wikidata.org/entity/Q668"), countryLabel: v("India"), iso: v("IN") }] } });
    }
    // Overpass: the place lookup succeeds, the enclosing-areas lookup fails.
    overpassCalls++;
    const query = new URLSearchParams(init.body).get("data");
    return /is_in/.test(query) ? new Response("", { status: 504 }) : Response.json({ elements: placeNodes });
  };
  const { geo: g, report } = await resolveGeo("Pune", f);
  assert.ok(overpassCalls >= 2);
  assert.deepEqual(
    [g.city.name, g.city.wikidata, g.state.name, g.state.areaId, g.country.code, g.country.areaId],
    ["Pune", "Q1538", "Maharashtra", 3601950884, "IN", 3600304716],
  );
  assert.match(report[0].message, /resolved with Nominatim and Wikidata/);
});

test("the country's regions come from Wikidata when Overpass cannot list them", async () => {
  const v = (x) => ({ value: x });
  const region = (q, name, rel, coord) => ({ s: v(`http://www.wikidata.org/entity/${q}`), name: v(name), rel: v(String(rel)), coord: v(coord) });
  const f = async (url) =>
    new URL(url).hostname.includes("wikidata")
      ? Response.json({ results: { bindings: [region("Q22", "Assam", 2025886, "Point(93.0 26.0)"), region("Q1191", "Maharashtra", 1950884, "Point(75.7 19.7)"), region("Q1171", "Goa", 11251493, "Point(74.04 15.40)")] } })
      : new Response("", { status: 504 });
  const regions = await loadRegions(geo(), f);
  assert.deepEqual(regions, [
    { name: "Goa", areaId: 3611251493 },
    { name: "Assam", areaId: 3602025886 },
  ], "nearest first, home state excluded");
});

test("long runs save their progress at every tier so a reload keeps what was found", async () => {
  const c = campaign();
  const g = geo();
  const call = async (body) => {
    if (body.action === "plan") return { geo: g, report: [], ...plan(c, g) };
    const id = { locality: 1, city: 2, state: 3 }[body.step.scope];
    const leads = body.step.source === "osm" && id ? osmLeads(c, g, body.step.scope, [{ type: "node", id, lat: 18.56, lon: 73.78, tags: { shop: "beauty", name: `S${id}`, phone: `+91 98200 0${id}` } }]) : [];
    return { leads, report: { source: body.step.source, scope: body.step.scope, area: "", status: "ok", found: leads.length, added: 0, refreshed: 0, message: "" } };
  };
  const saved = [];
  await runDiscovery(c, { ...emptyWorkspace(), campaigns: [c] }, call, () => {}, async () => {}, async (found) => saved.push(found.length));
  assert.deepEqual(saved, [1, 2], "saved after the locality and Pune tiers; the final save follows the Maharashtra tier");
});
