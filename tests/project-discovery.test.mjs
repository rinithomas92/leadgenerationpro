// Custom-project discovery: Overpass query building, result mapping, website
// enrichment and the pool top-up. All network calls are faked.
import test from "node:test";
import assert from "node:assert/strict";
import { osmQuery, osmProjectLeads, countFrom, wikidataProjectQuery } from "../lib/project-osm.ts";
import { topUp, tierPlans, needs, applyEnrichment } from "../lib/project-run.ts";
import { newCustomCampaign, projectLead } from "../lib/project.ts";
import { robotsAllows, extractContacts, createEnricher, privateAddress } from "../sources/enrich.ts";
import { suppressionIndex } from "../lib/suppression.ts";

const arch = [{ key: "office", values: ["architect"], category: "architect" }];
const campaign = (tiers = ["locality", "city", "state"], extra = {}) =>
  newCustomCampaign({
    name: "Interior studio",
    description: "Interior design studio in Baner, Pune.",
    location: "Baner, Pune",
    project: { segments: [{ id: "arch", label: "Architects", categories: ["architect"] }], tiers, ...extra },
  });
const geo = {
  input: "Baner, Pune",
  locality: { name: "Baner", lat: 18.559, lon: 73.786 },
  city: { name: "Pune", lat: 18.52, lon: 73.855, areaId: 3601986140, wikidata: "Q1538" },
  state: { name: "Maharashtra", areaId: 3601950884, wikidata: "Q1191" },
  country: { name: "India", areaId: 3600304716, wikidata: "Q668", code: "IN" },
  stateCode: "MH",
  stateBbox: { w: 72.6, s: 15.6, e: 80.9, n: 22.1 },
};

test("Overpass queries take any tag set, keyword filters and nearer-tier exclusion", () => {
  const q = osmQuery({ tags: arch, include: ["design"], exclude: ["supply"], area: { kind: "around", lat: 18.52, lon: 73.855, m: 20000 }, excludeAreas: [{ kind: "around", lat: 18.559, lon: 73.786, m: 3000 }] });
  assert.match(q, /nwr\["office"~"\^\(architect\)\$"\]\["name"\]\["name"~"design",i\]\["name"!~"supply",i\]\(around:20000,18\.52,73\.855\);\)->\.r;/);
  assert.match(q, /\(around:3000,18\.559,73\.786\);\)->\.x0;\(\.r; - \.x0;\)->\.r;\.r out tags center;$/);
  assert.match(osmQuery({ tags: arch, area: { kind: "area", areaId: 3601950884 } }, true), /^\[out:json\]\[timeout:90\];area\(3601950884\)->\.a0;.*\(area\.a0\);\)->\.r;\.r out count;$/);
  // Tag text that could alter the query is dropped.
  assert.throws(() => osmQuery({ tags: [{ key: 'office"];out;', values: ["x"], category: "x" }], area: { kind: "area", areaId: 1 } }), /No OpenStreetMap tags/);
  assert.equal(countFrom([{ type: "count", tags: { total: "84" } }]), 84);
  assert.match(wikidataProjectQuery(["Q42973"], "Q668", 77), /wdt:P106 \?occ ; wdt:P27 wd:Q668[\s\S]*FILTER\(\?num > 77\)/);
});

test("OSM elements map to leads with sources; closed and channel-less places are counted", () => {
  const c = campaign();
  const els = [
    { type: "node", id: 1, lat: 18.56, lon: 73.79, tags: { name: "Verb Interior", office: "architect", phone: "+91 81818 35353", "contact:instagram": "verbinterior", check_date: "2025-05-01", "addr:suburb": "Baner" } },
    { type: "way", id: 2, center: { lat: 18.5, lon: 73.8 }, tags: { name: "Old Studio", office: "architect", disused: "yes", phone: "+91 90000 00000" } },
    { type: "node", id: 3, lat: 18.5, lon: 73.8, tags: { name: "Silent Studio", office: "architect" } },
  ];
  const r = osmProjectLeads(c, els, { tier: "locality", segmentId: "arch", tags: arch, base: { lat: 18.559, lon: 73.786 }, country: "IN" });
  assert.deepEqual([r.leads.length, r.closed, r.noChannel], [1, 1, 1]);
  const l = r.leads[0];
  assert.deepEqual(
    [l.source, l.project.sourceIds, l.creator.instagram, l.project.phoneType, l.project.locality, l.sourceVerifiedAt, l.industry],
    ["https://www.openstreetmap.org/node/1", ["osm:node/1"], "verbinterior", "mobile", "Baner", "2025-05-01", "Architect"],
  );
});

test("tier plans: wider tiers exclude nearer ones; Global searches each chosen country except home", () => {
  const p = campaign(["locality", "city", "state", "country", "global"], { countries: ["AE", "IN"] }).custom;
  const plans = tierPlans(p, geo, [{ code: "AE", name: "United Arab Emirates", wikidata: "Q878" }, { code: "IN", name: "India" }], true);
  assert.deepEqual(plans.map((x) => x.label), ["Locality", "City", "State", "India", "Global · United Arab Emirates"]);
  assert.deepEqual(plans[1].overture.excludeAreas, [{ kind: "radius", lat: 18.559, lon: 73.786, km: 3 }]);
  assert.deepEqual(plans[2].overture.area, { kind: "region", region: "MH", names: ["Maharashtra"], bbox: geo.stateBbox });
  assert.deepEqual(plans[3].overture.excludeAreas, [{ kind: "region", region: "MH", names: ["Maharashtra"], bbox: geo.stateBbox }]);
  assert.equal(plans[3].osm, undefined, "no hour-long OSM crawl while Overture is up");
  assert.ok(tierPlans(p, geo, [], false)[3].osm.chunkOf, "OSM covers the country tier when the service is offline");
  const noLocality = tierPlans(p, { ...geo, locality: undefined }, [], true);
  assert.match(noLocality[0].skipped[0], /names no locality/);
  assert.deepEqual(needs(campaign().custom, 250), { "locality|arch": 250, "city|arch": 150, "state|arch": 100 });
});

const row = (id, i) => ({
  id, name: `Studio ${id}`, basic_category: "professional_service", category: "architect", alternates: null, address: "", locality: "Pune", postcode: null, region: "MH", country: "IN",
  lat: 18.55 + i * 0.001, lon: 73.78, phones: [`+91 98${String(20000000 + i)}`], emails: null, websites: i % 2 ? [`https://studio${i}.in`] : null, socials: null, brand: null,
  confidence: 0.7, operating_status: null, sources: [{ dataset: "meta", record_id: "x", update_time: "2026-10-12T00:00:00Z", license: "CDLA-Permissive-2.0" }],
});
function fakeDeps({ service = true, rows = 300, suppressed } = {}) {
  const calls = [];
  const all = Array.from({ length: rows }, (_, i) => row(`ov-${String(i).padStart(4, "0")}`, i));
  return {
    calls,
    deps: {
      discover: async (b) => {
        calls.push(b.action);
        if (b.action === "plan") return { geo, report: [] };
        if (b.action === "osm") return { elements: [{ type: "node", id: 9, lat: 18.56, lon: 73.79, tags: { name: "Studio ov-0000", office: "architect", phone: "+91 9820000000" } }] };
        if (b.action === "subareas") return { areas: [{ name: "Nashik", areaId: 3601 }] };
        throw new Error("unexpected " + b.action);
      },
      sources: {
        health: async () => (service ? { ok: true, extracts: [{ country: "IN", release: "2026-10-21.0", rows: 9, extractedAt: "" }] } : null),
        call: async (route, body) => {
          calls.push(route);
          if (route === "/count") return { total: 10, closed: 2, noChannel: 3, reachable: 5, release: "2026-10-21.0" };
          if (route === "/enrich") return { results: body.items.map((x) => ({ id: x.id, status: "ok", emails: [{ value: "hi@studio.in", page: x.url + "/contact" }], phones: [], socials: [], note: "" })) };
          const start = body.cursor ? all.findIndex((r) => r.id === body.cursor) + 1 : 0;
          const page = all.slice(start, start + body.limit);
          return { rows: page, nextCursor: start + body.limit < all.length ? page.at(-1).id : "", release: "2026-10-21.0" };
        },
      },
      sourcesFor: () => ({ tags: arch, occupations: [] }),
      suppressed,
      wait: async () => {},
      today: "2026-10-23",
    },
  };
}

test("top-up aims for the 1000-lead floor even for a small batch, then never refetches", async () => {
  const c = campaign(["locality"]);
  c.custom.enrich = false;
  const { deps } = fakeDeps({ rows: 300 });
  const first = await topUp(c, [], deps, { size: 50 });
  const key = Object.keys(first.pool).find((k) => k.startsWith("locality|arch|ov|IN|"));
  assert.ok(key, "the saved progress carries the segment signature");
  // 1000 is wanted, only 300 exist: everything is fetched and the search is exhausted.
  assert.equal(first.pool[key].fetched, 300);
  assert.equal(first.pool[key].exhausted, true);
  const r = first.reports.find((x) => x.source === "Overture Maps");
  assert.deepEqual([r.status, r.found, r.added, r.closed], ["ok", 300, 300, 2]);
  assert.ok(first.reports.some((x) => x.source === "Plan" && /short of 1000/.test(x.message)), "the shortfall is reported");
  assert.ok(first.incoming.every((l) => l.score > 0 && /Rule-based fit/.test(l.reason)));
  const second = await topUp({ ...c, custom: { ...c.custom, pool: first.pool } }, first.incoming, deps, { size: 50 });
  assert.equal(second.incoming.length, 0);
});

test("service offline: OpenStreetMap only, reported; State is searched district by district", async () => {
  const c = campaign(["state"]);
  c.custom.enrich = false;
  const { deps, calls } = fakeDeps({ service: false });
  const r = await topUp(c, [], deps, { size: 50 });
  assert.ok(r.reports.some((x) => x.status === "not-configured" && /Sources service offline/.test(x.message)));
  assert.deepEqual(calls.filter((x) => x === "subareas" || x === "osm"), ["subareas", "osm"]);
  assert.match(r.reports.find((x) => x.source === "OpenStreetMap").message, /from 1 of 1 area/);
});

test("suppressed places are never added and are counted; re-discovery keeps Given", async () => {
  const c = campaign(["locality"]);
  c.custom.enrich = false;
  const { deps } = fakeDeps({ rows: 3, suppressed: suppressionIndex([{ kind: "phone", value: "+919820000001" }]) });
  const r = await topUp(c, [], deps, { size: 50 });
  const ov = r.reports.find((x) => x.source === "Overture Maps");
  assert.deepEqual([ov.found, ov.added, ov.suppressed], [3, 2, 1]);
});

test("enrichment fills empty fields only and records the page each came from", async () => {
  const c = campaign(["locality"]);
  const l = projectLead(c, { name: "A", segmentId: "arch", tier: "locality", source: { name: "Overture Maps", id: "ov:1", url: "" }, website: "https://a.in" });
  const [e] = applyEnrichment([l], [{ id: l.id, status: "ok", emails: [{ value: "hi@a.in", page: "https://a.in/contact" }], phones: [{ value: "+919820000000", page: "https://a.in/" }], socials: [{ value: "https://www.instagram.com/a.studio", page: "https://a.in/" }], note: "" }], "2026-10-23");
  assert.deepEqual([e.email, e.phone, e.creator.instagram, e.project.provenance.email, e.project.provenance.instagram, e.project.provenance.enrichedAt], ["hi@a.in", "+919820000000", "a.studio", "https://a.in/contact", "https://a.in/", "2026-10-23"]);
  const kept = applyEnrichment([{ ...l, email: "own@a.in" }], [{ id: l.id, status: "ok", emails: [{ value: "hi@a.in", page: "x" }], phones: [], socials: [], note: "" }]);
  assert.equal(kept[0].email, "own@a.in");
});

test("robots.txt rules are respected", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/contact\n\nUser-agent: BadBot\nDisallow: /\n";
  assert.ok(robotsAllows(robots, "/contact"));
  assert.ok(!robotsAllows(robots, "/private/team"));
  assert.ok(robotsAllows(robots, "/private/contact"));
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/"));
  assert.ok(robotsAllows("User-agent: *\nDisallow:", "/"));
  assert.ok(!robotsAllows("User-agent: LeadGenPro\nDisallow: /\n\nUser-agent: *\nAllow: /", "/contact"));
});

test("only mailto, tel and social profile links are extracted", () => {
  const html = `<a href="mailto:Hello@Studio.in?subject=x">Mail</a><a href="tel:+91 98232-16629">Call</a>
    <a href="https://www.instagram.com/studio.in/">IG</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
    <a href="/contact-us">Contact</a><a href="https://other.example/contact">Elsewhere</a>`;
  const r = extractContacts(html, "https://studio.in/");
  assert.deepEqual(r, { emails: ["hello@studio.in"], phones: ["+919823216629"], socials: ["https://www.instagram.com/studio.in"], contact: "https://studio.in/contact-us" });
  assert.ok(privateAddress("192.168.1.10") && privateAddress("127.0.0.1") && privateAddress("::1") && !privateAddress("8.8.8.8"));
});

test("enrichment: robots.txt, 1 request per second per domain, no private hosts", async () => {
  const hits = [];
  const waits = [];
  const pages = {
    "https://a.in/robots.txt": [200, "User-agent: *\nDisallow: /secret"],
    "https://a.in/": [200, `<a href="/contact">Contact</a>`],
    "https://a.in/contact": [200, `<a href="mailto:hi@a.in">x</a>`],
    "https://b.in/robots.txt": [200, "User-agent: *\nDisallow: /"],
  };
  const f = async (url) => {
    hits.push(url);
    const [status, body] = pages[url] ?? [404, ""];
    return new Response(body, { status, headers: { "content-type": url.endsWith(".txt") ? "text/plain" : "text/html" } });
  };
  const enrich = createEnricher({ fetch: f, wait: async (ms) => void waits.push(ms), resolve: async (h) => (h === "intranet.in" ? ["10.0.0.5"] : ["93.184.216.34"]) });
  const { results } = await enrich({ items: [{ id: "a", url: "https://a.in/" }, { id: "b", url: "https://b.in/" }, { id: "c", url: "https://intranet.in/" }], concurrency: 1 });
  assert.deepEqual(results.map((r) => r.status), ["ok", "blocked", "failed"]);
  assert.deepEqual(results[0].emails, [{ value: "hi@a.in", page: "https://a.in/contact" }]);
  assert.match(results[2].note, /private/);
  assert.ok(!hits.some((u) => u.includes("intranet")), "private hosts are never fetched");
  // robots.txt, homepage and contact page of a.in: each waits for the next 1-second slot
  // (the fake clock does not advance, so the reservations stack up: 1 s, then 2 s).
  assert.ok(waits[0] > 0 && waits[0] <= 1000, `first wait ${waits[0]}`);
  assert.ok(Math.abs(waits[1] - waits[0] - 1000) < 200, `slots 1 s apart: ${waits}`);
});

test("progress saved by an older search definition never blocks a new search", async () => {
  const c = campaign(["locality"]);
  c.custom.enrich = false;
  // The old key format (no signature) is marked exhausted with nothing fetched, as the narrow search left it.
  c.custom.pool = { "locality|arch|ov|IN": { cursor: "", exhausted: true, fetched: 0 } };
  const { deps } = fakeDeps({ rows: 5 });
  const r = await topUp(c, [], deps, { size: 50 });
  const ov = r.reports.find((x) => x.source === "Overture Maps");
  assert.deepEqual([ov.status, ov.found], ["ok", 5]);
});
