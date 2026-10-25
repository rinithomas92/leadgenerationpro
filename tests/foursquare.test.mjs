// Foursquare Open Source Places: label mapping, reshaping into the Overture layout,
// and the sources service searching it. A tiny fixture with Foursquare's published
// column names is written by DuckDB in a temporary folder; no network is used.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { mapLabel, reshapeSql } from "../scripts/fsq-extract.mjs";
import { sourcesServer } from "../sources/server.ts";
import { overtureLead } from "../lib/project-sources.ts";
import { newCustomCampaign } from "../lib/project.ts";

const q = (s) => (s == null ? "NULL::VARCHAR" : `'${String(s).replace(/'/g, "''")}'`);
const rowSql = (p) => `SELECT ${q(p.id)} AS fsq_place_id, ${q(p.name)} AS name, ${p.lat}::DOUBLE AS latitude, ${p.lon}::DOUBLE AS longitude,
  ${q(p.address)} AS address, ${q(p.locality ?? "Mumbai")} AS locality, ${q(p.region ?? "Maharashtra")} AS region, ${q(p.postcode)} AS postcode,
  NULL::VARCHAR AS admin_region, 'IN' AS country, ${q(p.closed)}::DATE AS date_closed, '2026-01-01'::DATE AS date_created, '2026-01-05'::DATE AS date_refreshed,
  ${q(p.tel)} AS tel, ${q(p.website)} AS website, ${q(p.email)} AS email, ${q(p.fb)} AS facebook_id, ${q(p.ig)} AS instagram,
  ${p.labels ? `[${p.labels.map(q).join(", ")}]::VARCHAR[]` : "NULL::VARCHAR[]"} AS fsq_category_labels`;
const places = [
  { id: "f1", name: "Glow Makeup Studio", lat: 19.07, lon: 72.87, tel: "+912212345678", ig: "glowmakeup", labels: ["Business and Professional Services > Beauty Salon", "Retail > Cosmetics Store"] },
  { id: "f2", name: "Priya Bridal Makeup", lat: 19.08, lon: 72.88, website: "https://priyabridal.in", labels: ["Business and Professional Services > Makeup Artist"] },
  { id: "f3", name: "Closed Salon", lat: 19.06, lon: 72.86, tel: "+912200000000", closed: "2026-02-01", labels: ["Business and Professional Services > Beauty Salon"] },
  { id: "f4", name: "No Contact Salon", lat: 19.05, lon: 72.85, labels: ["Business and Professional Services > Beauty Salon"] },
  { id: "f5", name: "Odd Category", lat: 19.1, lon: 72.9, tel: "+912211111111", labels: ["Something > Unheard Of Place"] },
];

test("labels map to Overture category ids by their last segment", () => {
  assert.equal(mapLabel("Business and Professional Services > Beauty Salon"), "beauty_salon");
  assert.equal(mapLabel("Dining and Drinking > Cafe"), "cafe");
  assert.equal(mapLabel("Something > Unheard Of Place"), "unheard_of_place");
});

let dir, server, base;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "leadgen-fsq-"));
  mkdirSync(path.join(dir, "fsq", "2026-01-12"), { recursive: true });
  mkdirSync(path.join(dir, "ov"), { recursive: true });
  const file = path.join(dir, "fsq", "2026-01-12", "IN.parquet").replace(/\\/g, "/");
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  const map = `MAP {'Business and Professional Services > Beauty Salon': 'beauty_salon', 'Business and Professional Services > Makeup Artist': 'makeup_artist', 'Retail > Cosmetics Store': 'cosmetics_store', 'Something > Unheard Of Place': 'unheard_of_place'}`;
  await c.run(`COPY (${reshapeSql(places.map(rowSql).join("\nUNION ALL\n"), map)}) TO '${file}' (FORMAT parquet)`);
  writeFileSync(path.join(dir, "fsq", "manifest.json"), JSON.stringify({ releases: { "2026-01-12": { IN: { file: "2026-01-12/IN.parquet", rows: places.length, extractedAt: "2026-01-13T00:00:00Z" } } } }));
  server = sourcesServer({ dataDir: path.join(dir, "ov"), fsqDir: path.join(dir, "fsq") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});
const post = async (route, body) => (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const mumbai = { kind: "radius", lat: 19.07, lon: 72.87, km: 20 };

test("health lists Foursquare extracts with their source", async () => {
  const h = await (await fetch(base + "/health")).json();
  assert.deepEqual(h.extracts.map((e) => [e.source, e.country, e.release, e.rows]), [["foursquare", "IN", "2026-01-12", 5]]);
});

test("search returns open places with a channel, in the Overture row shape", async () => {
  const r = await post("/search", { source: "foursquare", country: "IN", categories: ["beauty_salon", "makeup_artist"], area: mumbai });
  // Closed (f3) and no-contact (f4) are left out; the odd category is not asked for.
  assert.deepEqual(r.rows.map((x) => x.id).sort(), ["f1", "f2"]);
  const glow = r.rows.find((x) => x.id === "f1");
  assert.deepEqual([glow.name, glow.category, glow.alternates, glow.region, glow.locality, glow.phones, glow.sources[0].dataset, glow.sources[0].license], ["Glow Makeup Studio", "beauty_salon", ["cosmetics_store"], "Maharashtra", "Mumbai", ["+912212345678"], "foursquare", "Apache-2.0"]);
  assert.deepEqual(glow.socials, ["https://www.instagram.com/glowmakeup/"]);
  const count = await post("/count", { source: "foursquare", country: "IN", categories: ["beauty_salon"], area: mumbai });
  assert.deepEqual([count.total, count.closed, count.noChannel, count.reachable], [3, 1, 1, 1]);
});

test("keywords find places whose category is unmapped, and source selects the extract", async () => {
  const r = await post("/search", { source: "foursquare", country: "IN", categories: ["makeup_artist"], include: ["odd"], area: mumbai });
  assert.deepEqual(r.rows.map((x) => x.id).sort(), ["f2", "f5"]);
  // The Overture extract folder is empty, so the default source reports it.
  const ov = await fetch(base + "/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: "IN", categories: ["beauty_salon"], area: mumbai }) });
  assert.equal(ov.status, 404);
});

test("a Foursquare place becomes a lead credited to Foursquare under its own record id", async () => {
  const r = await post("/search", { source: "foursquare", country: "IN", categories: ["beauty_salon"], area: mumbai });
  const campaign = newCustomCampaign({ name: "T", description: "test project", location: "Mumbai", project: { segments: [{ id: "s1", label: "Salons", categories: ["beauty_salon"], include: [], exclude: [] }], tiers: ["city"] } });
  const lead = overtureLead(campaign, r.rows[0], { tier: "city", segmentId: "s1" }, r.release, { name: "Foursquare Open Source Places", prefix: "fsq", licence: "Apache-2.0" });
  assert.equal(lead.project.sourceIds[0], "fsq:f1");
  assert.match(lead.sourceLabel, /Foursquare Open Source Places .*Apache-2\.0/);
});
