// The local sources service against a tiny Overture-shaped Parquet fixture
// written by DuckDB in a temporary folder. No network is used.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { sourcesServer } from "../sources/server.ts";

const q = (s) => (s == null ? "NULL::VARCHAR" : `'${String(s).replace(/'/g, "''")}'`);
const list = (a) => (a ? `[${a.map(q).join(", ")}]::VARCHAR[]` : "NULL::VARCHAR[]");
const place = (p) => `SELECT ${q(p.id)} AS id, {'primary': ${q(p.name)}} AS names, ${q(p.basic ?? null)} AS basic_category,
  {'primary': ${q(p.cat)}, 'hierarchy': ${list([p.cat])}, 'alternates': ${list(p.alt ?? null)}} AS taxonomy,
  ${p.confidence ?? 0.8}::DOUBLE AS confidence, ${q(p.status ?? null)} AS operating_status,
  [{'freeform': ${q(p.address ?? null)}, 'locality': ${q(p.locality ?? "Pune")}, 'postcode': ${q(p.postcode ?? null)}, 'region': ${q(p.region === undefined ? "MH" : p.region)}, 'country': ${q(p.country ?? "IN")}}] AS addresses,
  ${list(p.phones ?? null)} AS phones, ${list(p.emails ?? null)} AS emails, ${list(p.websites ?? null)} AS websites, ${list(p.socials ?? null)} AS socials,
  {'names': {'primary': NULL::VARCHAR}} AS brand,
  [{'dataset': 'meta', 'record_id': ${q(p.id + "-rec")}, 'update_time': '2026-10-12T00:00:00Z', 'license': 'CDLA-Permissive-2.0'}] AS sources,
  {'xmin': ${p.lon}::DOUBLE, 'xmax': ${p.lon}::DOUBLE, 'ymin': ${p.lat}::DOUBLE, 'ymax': ${p.lat}::DOUBLE} AS bbox`;
const places = [
  { id: "ov-a", name: "Verb Interior", cat: "architect", lat: 18.560, lon: 73.787, phones: ["+918181835353"] },
  { id: "ov-b", name: "Studio Arc", cat: "architect", lat: 18.52, lon: 73.85, websites: ["https://studioarc.in"] },
  { id: "ov-c", name: "Nashik Architects", cat: "architect", lat: 19.99, lon: 73.79, emails: ["hi@nashikarch.in"], locality: "Nashik" },
  { id: "ov-d", name: "Bengaluru Arch", cat: "architect", lat: 12.97, lon: 77.59, region: "KA", socials: ["https://www.instagram.com/blrarch/"], locality: "Bengaluru" },
  { id: "ov-i", name: "Goa Arch", cat: "architect", lat: 15.49, lon: 73.82, region: null, phones: ["+919000000003"], locality: "Panaji" },
  { id: "ov-j", name: "Kolhapur Arch", cat: "architect", lat: 16.70, lon: 74.24, region: null, phones: ["+919000000004"], locality: "Kolhapur" },
  // No region, but a Telangana PIN: inside Maharashtra's bbox, yet not in Maharashtra.
  { id: "ov-l", name: "Hyderabad Arch", cat: "architect", lat: 17.38, lon: 78.48, region: null, postcode: "500001", phones: ["+919000000005"], locality: "Hyderabad" },
  { id: "ov-m", name: "Satara Arch", cat: "architect", lat: 17.68, lon: 74.0, region: null, postcode: "415001", phones: ["+919000000006"], locality: "Satara" },
  // Neither region nor PIN, but the address names Telangana's capital.
  { id: "ov-n", name: "Banjara Studio", cat: "architect", lat: 17.41, lon: 78.44, region: null, address: "Road 12, Banjara Hills", locality: "Hyderabad", phones: ["+919000000007"] },
  { id: "ov-k", name: "Nagpur Arch", cat: "architect", lat: 21.15, lon: 79.09, region: "Maharashtra", websites: ["https://nagpurarch.in"], locality: "Nagpur" },
  { id: "ov-e", name: "Closed Arch", cat: "architect", lat: 18.561, lon: 73.788, status: "permanently_closed", phones: ["+919000000001"] },
  { id: "ov-f", name: "Silent Arch", cat: "architect", lat: 18.558, lon: 73.785 },
  { id: "ov-g", name: "Cafe X", cat: "cafe", lat: 18.559, lon: 73.786, phones: ["+919000000002"] },
  { id: "ov-h", name: "Arch Supplies Wholesale", cat: "building_supply_store", alt: ["architect"], lat: 18.559, lon: 73.787, websites: ["https://archsupplies.in"] },
];
let dir, server, base;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "leadgen-sources-"));
  mkdirSync(path.join(dir, "2026-10-21.0"));
  const file = path.join(dir, "2026-10-21.0", "IN.parquet").replace(/\\/g, "/");
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  await c.run(`COPY (${places.map(place).join("\nUNION ALL\n")}) TO '${file}' (FORMAT parquet)`);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ releases: { "2026-10-21.0": { IN: { file: "2026-10-21.0/IN.parquet", rows: places.length, extractedAt: "2026-10-23T00:00:00Z" } } } }));
  server = sourcesServer({ dataDir: dir });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});
const post = (route, body, headers = {}) =>
  fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const baner = { kind: "radius", lat: 18.559, lon: 73.786, km: 3 };
const pune = { kind: "radius", lat: 18.52, lon: 73.855, km: 20 };
const arch = { country: "IN", categories: ["architect"] };

test("health lists the extracts", async () => {
  const h = await (await fetch(base + "/health")).json();
  assert.deepEqual([h.ok, h.extracts.map((e) => [e.country, e.release, e.rows])], [true, [["IN", "2026-10-21.0", places.length]]]);
});

test("counts split total, closed, no-channel and reachable places", async () => {
  const r = await (await post("/count", { ...arch, area: baner })).json();
  // a, e (closed), f (no channel) and h (alternate category).
  assert.deepEqual(r, { total: 4, closed: 1, noChannel: 1, reachable: 2, release: "2026-10-21.0" });
  const ex = await (await post("/count", { ...arch, area: baner, exclude: ["wholesale"] })).json();
  assert.equal(ex.reachable, 1);
  const inc = await (await post("/count", { ...arch, area: baner, include: ["verb"] })).json();
  assert.equal(inc.total, 1);
});

test("wider tiers exclude nearer ones, so each place is in exactly one tier", async () => {
  const ids = async (area, excludeAreas = []) =>
    (await (await post("/search", { ...arch, area, excludeAreas })).json()).rows.map((r) => r.id).sort();
  // Places without a region use the state bbox (Kolhapur is inside it, Goa is not).
  const state = { kind: "region", region: "MH", names: ["Maharashtra"], bbox: { w: 72.6, s: 15.6, e: 80.9, n: 22.1 } };
  const tiers = {
    locality: await ids(baner),
    city: await ids(pune, [baner]),
    state: await ids(state, [pune]),
    country: await ids({ kind: "region" }, [state]),
  };
  assert.deepEqual(tiers, { locality: ["ov-a", "ov-h"], city: ["ov-b"], state: ["ov-c", "ov-j", "ov-k", "ov-m"], country: ["ov-d", "ov-i", "ov-l", "ov-n"] });
});

test("search returns full rows and pages with a stable cursor", async () => {
  const first = await (await post("/search", { ...arch, area: baner, limit: 1 })).json();
  assert.equal(first.rows.length, 1);
  assert.equal(first.nextCursor, "ov-a");
  const row = first.rows[0];
  assert.deepEqual(
    [row.name, row.category, row.region, row.country, row.lat, row.lon, row.phones, row.sources[0].dataset, row.sources[0].license],
    ["Verb Interior", "architect", "MH", "IN", 18.56, 73.787, ["+918181835353"], "meta", "CDLA-Permissive-2.0"],
  );
  const second = await (await post("/search", { ...arch, area: baner, limit: 1, cursor: first.nextCursor })).json();
  assert.deepEqual(second.rows.map((r) => r.id), ["ov-h"]);
  const third = await (await post("/search", { ...arch, area: baner, limit: 1, cursor: "ov-h" })).json();
  assert.deepEqual([third.rows.length, third.nextCursor], [0, ""]);
});

test("rejects other web origins, bad input and missing extracts", async () => {
  assert.equal((await post("/count", { ...arch, area: baner }, { Origin: "https://evil.example" })).status, 403);
  const ok = await post("/count", { ...arch, area: baner }, { Origin: "http://127.0.0.1:5187" });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://127.0.0.1:5187");
  const pre = await fetch(base + "/search", { method: "OPTIONS", headers: { Origin: "http://localhost:5187" } });
  assert.deepEqual([pre.status, pre.headers.get("access-control-allow-private-network")], [204, "true"]);
  assert.equal((await post("/count", { ...arch, categories: ["Robert'); DROP"], area: baner })).status, 400);
  const missing = await post("/count", { ...arch, country: "AE", area: baner });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /npm run overture:extract -- AE/);
});

test("email check: syntax plus MX lookup; website status: live, redirects, dead, timeout", async () => {
  const { createChecks } = await import("../sources/checks.ts");
  const mxCalls = [];
  const checks = createChecks({
    mx: async (d) => {
      mxCalls.push(d);
      if (d === "studio.in") return [{ exchange: "mx.studio.in" }];
      if (d === "flaky.in") throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    },
    resolve: async (h) => (h === "intranet.in" ? ["192.168.1.4"] : ["93.184.216.34"]),
    fetch: async (url, init) => {
      if (url.includes("slow")) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      const code = url.includes("moved") ? 301 : url.includes("gone") ? 404 : url.includes("nohead") && init.method === "HEAD" ? 405 : 200;
      return new Response("", { status: code });
    },
  });
  const e = await checks.emails({ emails: ["hi@studio.in", "Sales@Studio.in", "x@nowhere-at-all.in", "not an email", "a@flaky.in"] });
  // A DNS failure is "unknown", never "no mail server".
  assert.deepEqual(e.results.map((r) => r.result), ["valid domain", "valid domain", "no mail server", "invalid", "unknown"]);
  assert.deepEqual(mxCalls, ["studio.in", "nowhere-at-all.in", "flaky.in"], "one lookup per domain; never a probe email");
  const w = await checks.websites({ urls: ["https://ok.in/", "https://moved.in/", "https://gone.in/x", "https://slow.in/", "https://nohead.in/", "http://intranet.in/", "ftp://x.in/"] });
  assert.deepEqual(w.results.map((r) => r.result), ["live", "redirects", "dead", "timeout", "live", "dead", "dead"]);
});

test("lookup by record id, and Overture update status through the service", async () => {
  const s = sourcesServer({ dataDir: dir, latest: async () => "2026-11-18.0" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${s.address().port}`;
  try {
    const r = await (await fetch(url + "/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: "IN", ids: ["ov-a", "ov-e", "gone"] }) })).json();
    assert.deepEqual([r.rows.map((x) => [x.id, x.operating_status]), r.missing], [[["ov-a", null], ["ov-e", "permanently_closed"]], ["gone"]]);
    assert.deepEqual(await (await fetch(url + "/update/latest")).json(), { latest: "2026-11-18.0" });
    const st = await (await fetch(url + "/update/status")).json();
    assert.equal(st.running, false);
    assert.equal((await fetch(url + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countries: ["india"] }) })).status, 400);
  } finally {
    s.close();
  }
});
