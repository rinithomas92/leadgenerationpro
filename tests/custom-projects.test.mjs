import test from "node:test";
import assert from "node:assert/strict";
import { campaignSchema, leadSchema, stateSchema, emptyWorkspace } from "../lib/leadgen.ts";
import { allocate, targets } from "../lib/allocation.ts";
import { applyDelivery, availableState, isBatchSize, planDelivery, undoError } from "../lib/ledger.ts";
import { mergeProjectLeads, registrableDomain, geohash, geohashArea } from "../lib/dedupe.ts";
import { normalizePhone, parsePhones, waLink, canWhatsApp } from "../lib/phone.ts";
import {
  doNotContactEntries,
  isSuppressed,
  parseSuppressionCSV,
  suppressionIndex,
  detectKind,
} from "../lib/suppression.ts";
import { newCustomCampaign, projectLead } from "../lib/project.ts";
import { batchSizes } from "../lib/project-schema.ts";

const segments = [
  { id: "dev", label: "Real-estate developers", categories: ["real_estate_developer"] },
  { id: "arch", label: "Architects", categories: ["architect"] },
  { id: "furn", label: "Furniture showrooms", categories: ["furniture_store"] },
];
const project = () =>
  newCustomCampaign({
    name: "Interior studio",
    description: "Interior design studio in Baner, Pune, creating homes and offices.",
    location: "Baner, Pune",
    project: { segments, tiers: ["locality", "city", "state"] },
  });
let n = 0;
const cand = (tier, segmentId, fit = 50, distanceKm = 1) => ({ id: `c${n++}`, tier, segmentId, fit, distanceKm, name: `N${n}` });
const pool = (spec) => Object.entries(spec).flatMap(([key, count]) => {
  const [tier, seg] = key.split(":");
  return Array.from({ length: count }, (_, i) => cand(tier, seg, 90 - i, i));
});
const lead = (c, i, tier = "city", segmentId = "arch", extra = {}) =>
  projectLead(c, {
    name: extra.name ?? `Studio ${i}`,
    segmentId,
    tier,
    source: { name: "Overture Maps", id: `ov:${tier}-${segmentId}-${i}`, url: "" },
    phone: extra.phone,
    website: extra.website,
    project: { lat: 18.56 + i * 0.01, lon: 73.78, ...extra.project },
  });

test("custom schemas are optional, so Gloss and legacy data parse unchanged", () => {
  const empty = emptyWorkspace();
  assert.deepEqual(stateSchema.parse(empty), empty);
  const c = project();
  assert.equal(campaignSchema.parse(c).custom.tiers.length, 3);
  assert.deepEqual(campaignSchema.parse(c).custom.split, [50, 30, 20]);
  const l = lead(c, 1);
  assert.equal(leadSchema.parse(l).project.delivery.status, "available");
  const { project: _p, ...plain } = l;
  assert.equal("project" in leadSchema.parse(plain), false);
});

test("largest-remainder targets always sum to the batch size", () => {
  assert.deepEqual(targets(250, [{ tier: "locality", pct: 50 }, { tier: "city", pct: 30 }, { tier: "state", pct: 20 }]), { locality: 125, city: 75, state: 50 });
  const t = targets(50, [{ tier: "locality", pct: 35 }, { tier: "city", pct: 25 }, { tier: "state", pct: 20 }, { tier: "country", pct: 12 }, { tier: "global", pct: 8 }]);
  assert.equal(Object.values(t).reduce((a, b) => a + b, 0), 50);
  // 17.5, 12.5, 10, 6, 4 → one seat is left over; the .5 tie goes to the nearer tier.
  assert.deepEqual(t, { locality: 18, city: 12, state: 10, country: 6, global: 4 });
  assert.deepEqual(targets(100, [{ tier: "city", pct: 70 }, { tier: "state", pct: 30 }]), { city: 70, state: 30 });
});

test("50/30/20 fills exactly when every tier has enough", () => {
  const available = pool({ "locality:dev": 100, "locality:arch": 100, "city:dev": 100, "state:furn": 100 });
  const r = allocate({ size: 250, tiers: [{ tier: "locality", pct: 50 }, { tier: "city", pct: 30 }, { tier: "state", pct: 20 }], segments: ["dev", "arch", "furn"], available, mode: "split" });
  assert.equal(r.ids.length, 250);
  assert.deepEqual(r.actual.tiers, { locality: 125, city: 75, state: 50 });
  assert.deepEqual(r.notes, []);
  assert.equal(new Set(r.ids).size, 250);
});

test("a short tier spills outward first, then inward", () => {
  const tiers = [{ tier: "locality", pct: 50 }, { tier: "city", pct: 30 }, { tier: "state", pct: 20 }];
  // Locality has 40 of 50 → 10 move outward to City.
  let r = allocate({ size: 100, tiers, segments: ["dev"], available: pool({ "locality:dev": 40, "city:dev": 100, "state:dev": 100 }), mode: "split", segmentLabels: { dev: "Cafés" } });
  assert.deepEqual(r.actual.tiers, { locality: 40, city: 40, state: 20 });
  assert.match(r.notes[0], /^Locality exhausted for Cafés; 10 moved to City\.$/);
  // State (the outermost) is short → spills inward to City.
  r = allocate({ size: 100, tiers, segments: ["dev"], available: pool({ "locality:dev": 50, "city:dev": 100, "state:dev": 5 }), mode: "split" });
  assert.deepEqual(r.actual.tiers, { locality: 50, city: 45, state: 5 });
  assert.match(r.notes[0], /State exhausted.*15 moved to City/);
  // Not enough anywhere: delivers what exists and says so.
  r = allocate({ size: 100, tiers, segments: ["dev"], available: pool({ "locality:dev": 10, "city:dev": 10 }), mode: "split" });
  assert.equal(r.ids.length, 20);
  assert.match(r.notes.at(-1), /Only 20 of 100/);
});

test("round-robin across segments, best fit first within a segment", () => {
  const available = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, tier: "city", segmentId: "dev", fit: 90 - i, distanceKm: 1, name: "D" })),
    { id: "a0", tier: "city", segmentId: "arch", fit: 40, distanceKm: 2, name: "A" },
    { id: "a1", tier: "city", segmentId: "arch", fit: 60, distanceKm: 9, name: "A" },
    { id: "f0", tier: "city", segmentId: "furn", fit: 10, distanceKm: 1, name: "F" },
  ];
  const r = allocate({ size: 6, tiers: [{ tier: "city", pct: 100 }], segments: ["dev", "arch", "furn"], available, mode: "split" });
  assert.deepEqual(r.ids, ["d0", "a1", "f0", "d1", "a0", "d2"]);
  assert.deepEqual(r.actual.segments, { dev: 3, arch: 2, furn: 1 });
});

test("nearest-first fills tiers in order", () => {
  const r = allocate({ size: 30, tiers: [{ tier: "state", pct: 0 }, { tier: "locality", pct: 0 }, { tier: "city", pct: 0 }], segments: ["dev"], available: pool({ "locality:dev": 12, "city:dev": 10, "state:dev": 50 }), mode: "nearest" });
  assert.deepEqual(r.actual.tiers, { locality: 12, city: 10, state: 8 });
});

test("Given ledger: no lead is delivered twice across 3 batches; undo only the latest", () => {
  const c = project();
  let leads = [
    ...Array.from({ length: 80 }, (_, i) => lead(c, i, "locality", segments[i % 3].id)),
    ...Array.from({ length: 80 }, (_, i) => lead(c, i, "city", segments[i % 3].id)),
    ...Array.from({ length: 80 }, (_, i) => lead(c, i, "state", segments[i % 3].id)),
  ];
  const deliveries = [];
  const seen = new Set();
  for (let seq = 1; seq <= 3; seq++) {
    const plan = planDelivery(c, leads, 50, seq, new Set(), `d${seq}`, `2026-10-2${seq}T10:00:00Z`);
    assert.equal(plan.ids.length, 50);
    for (const id of plan.ids) {
      assert.ok(!seen.has(id), "a Given lead is never delivered again");
      seen.add(id);
    }
    assert.deepEqual(plan.delivery.actual.tiers, { locality: 25, city: 15, state: 10 });
    assert.equal(plan.delivery.filename, `interior-studio-batch-${seq}-2026-10-2${seq}.xlsx`);
    leads = applyDelivery(leads, plan.ids, plan.state);
    deliveries.push(plan.delivery);
  }
  assert.equal(leads.filter((l) => l.project.delivery.status === "given").length, 150);
  assert.equal(undoError(deliveries, deliveries[0], leads), "Only the latest batch can be undone.");
  assert.equal(undoError(deliveries, deliveries[2], leads), "");
  const batch3 = leads.filter((l) => l.project.delivery.id === "d3").map((l) => l.id);
  leads = applyDelivery(leads, batch3, availableState());
  assert.equal(leads.filter((l) => l.project.delivery.status === "given").length, 100);
  // A contacted lead blocks undo.
  const contacted = leads.map((l) => (l.project.delivery.id === "d2" ? { ...l, project: { ...l.project, outreach: { ...l.project.outreach, status: "contacted" } } } : l));
  assert.match(undoError(deliveries.slice(0, 2), deliveries[1], contacted), /already have outreach/);
});

test("batch sizes are limited to the 7 allowed values", () => {
  assert.deepEqual([...batchSizes], [50, 100, 250, 500, 1000, 2500, 5000]);
  assert.ok(isBatchSize(2500) && !isBatchSize(300) && !isBatchSize(10000));
  const c = project();
  assert.throws(() => planDelivery(c, [], 300, 1, new Set(), "x", "2026-10-23"), /Batch size must be one of/);
});

test("re-discovery never resets Given and refreshes only empty fields", () => {
  const c = project();
  const given = { ...lead(c, 1, "city", "arch", { phone: "", website: "" }), notes: "met at expo", stage: "Contacted", checkedAt: "2026-01-01" };
  given.project = { ...given.project, delivery: { status: "given", id: "d1", givenAt: "2026-02-01", batch: 1 } };
  const again = lead(c, 1, "city", "arch", { phone: "+91 98232 16629", website: "https://studio1.in" });
  again.checkedAt = "2026-10-23";
  const r = mergeProjectLeads([given], [again]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.refreshed, 1);
  const l = r.leads[0];
  assert.deepEqual(l.project.delivery, { status: "given", id: "d1", givenAt: "2026-02-01", batch: 1 });
  assert.deepEqual([l.notes, l.stage, l.checkedAt, l.website, l.project.phoneE164], ["met at expo", "Contacted", "2026-10-23", "https://studio1.in/", "+919823216629"]);
});

test("the same place from Overture, OpenStreetMap and Wikidata becomes one lead", () => {
  const c = project();
  const at = { lat: 18.5596, lon: 73.7799 };
  const ov = projectLead(c, { name: "Verb Interior Pvt. Ltd.", segmentId: "arch", tier: "locality", source: { name: "Overture Maps", id: "ov:08f1", url: "" }, phone: "+91 81818 35353", project: at });
  const osm = projectLead(c, { name: "Verb Interior", segmentId: "arch", tier: "locality", source: { name: "OpenStreetMap", id: "osm:node/42", url: "https://www.openstreetmap.org/node/42" }, website: "https://www.verbinterior.com/", project: { lat: 18.5597, lon: 73.78 } });
  const wd = projectLead(c, { name: "Verb Interior Design", segmentId: "arch", tier: "locality", source: { name: "Wikidata", id: "wd:Q123", url: "https://www.wikidata.org/wiki/Q123" }, website: "https://verbinterior.com" });
  const r = mergeProjectLeads([], [ov, osm, wd]);
  assert.equal(r.leads.length, 1);
  assert.deepEqual(r.leads[0].project.sourceIds, ["ov:08f1", "osm:node/42", "wd:Q123"]);
  assert.deepEqual(r.leads[0].project.sources.map((s) => s.name), ["Overture Maps", "OpenStreetMap", "Wikidata"]);
  assert.equal(r.leads[0].project.dedupeKey, "ov:08f1");
});

test("chain branches sharing a phone and website stay separate", () => {
  const c = project();
  const a = projectLead(c, { name: "HomeTown", segmentId: "furn", tier: "city", source: { name: "OpenStreetMap", id: "osm:node/1", url: "" }, phone: "1800 210 0004", website: "https://www.hometown.in/", project: { lat: 18.56, lon: 73.78 } });
  const b = projectLead(c, { name: "HomeTown", segmentId: "furn", tier: "city", source: { name: "OpenStreetMap", id: "osm:node/2", url: "" }, phone: "1800 210 0004", website: "https://www.hometown.in/", project: { lat: 18.50, lon: 73.90 } });
  assert.equal(mergeProjectLeads([], [a, b]).leads.length, 2);
});

test("registrable domains ignore generic hosts", () => {
  assert.equal(registrableDomain("https://www.studio.co.in/contact"), "studio.co.in");
  assert.equal(registrableDomain("shop.example.com"), "example.com");
  for (const g of ["https://linktr.ee/x", "https://wa.me/91999", "https://www.facebook.com/x", "https://x.business.site", "https://www.justdial.com/Pune/x"])
    assert.equal(registrableDomain(g), "", g);
  assert.equal(geohash(18.5596, 73.7799, 7).length, 7);
  assert.equal(geohashArea(18.5596, 73.7799).length, 9);
});

test("phones normalise to E.164 and are classed as mobile or landline", () => {
  assert.deepEqual(normalizePhone("98232 16629"), { e164: "+919823216629", display: "+91 98232 16629", type: "mobile" });
  assert.equal(normalizePhone("020 25925173").type, "landline");
  // A mobile is preferred when a source lists several numbers.
  assert.equal(normalizePhone("020 25925173; +91 9823216629").e164, "+919823216629");
  assert.equal(parsePhones("not a number").length, 0);
  assert.ok(canWhatsApp("mobile") && !canWhatsApp("landline"));
  assert.equal(waLink("+919823216629", "नमस्कार 🙏 & hi"), "https://wa.me/919823216629?text=%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%95%E0%A4%BE%E0%A4%B0%20%F0%9F%99%8F%20%26%20hi");
});

test("suppression list: CSV import, matching and Do not contact", () => {
  const { entries, invalid } = parseSuppressionCSV("value,kind,reason\n+91 98232 16629,,client\nhello@rival.in,email,competitor\nhttps://www.rival.in,,\n@rival.studio,,\nnot-an-email@,email,\n");
  assert.deepEqual(entries.map((e) => `${e.kind}:${e.value}`), ["phone:+919823216629", "email:hello@rival.in", "domain:rival.in", "handle:rival.studio"]);
  assert.deepEqual(invalid, ["not-an-email@"]);
  assert.equal(detectKind("Some Cafe"), "name");
  const c = project();
  const index = suppressionIndex(entries);
  assert.ok(isSuppressed(lead(c, 1, "city", "arch", { phone: "9823216629" }), index));
  assert.ok(isSuppressed(lead(c, 2, "city", "arch", { website: "https://rival.in/about" }), index));
  assert.ok(!isSuppressed(lead(c, 3), index));
  // Suppressed pool leads are never delivered, and the batch says how many.
  const leads = [lead(c, 1, "city", "arch", { phone: "9823216629" }), lead(c, 2), lead(c, 3)];
  const plan = planDelivery({ ...c, custom: { ...c.custom, tiers: ["city"], split: [100] } }, leads, 50, 1, index, "d1", "2026-10-23");
  assert.equal(plan.ids.length, 2);
  assert.equal(plan.delivery.suppressed, 1);
  const dnc = doNotContactEntries(lead(c, 4, "city", "arch", { phone: "+91 90000 00001", website: "https://four.in" }));
  assert.deepEqual(dnc.map((e) => e.kind), ["phone", "domain"]);
  assert.ok(dnc.every((e) => e.origin === "do-not-contact"));
});

test("Overture rows map to leads that keep their source record and channels", async () => {
  const { overtureLead, socialFields } = await import("../lib/project-sources.ts");
  const c = project();
  const row = {
    id: "9e077e65-93c2-4946-9632-6854d962ea0e", name: "Hema's Makeup Studio", basic_category: "personal_or_beauty_service", category: "makeup_artist", alternates: null,
    address: "Shop 3, Adhisthan Rd", locality: "Pune", postcode: "411027", region: "MH", country: "IN", lat: 18.62, lon: 73.80,
    phones: ["+918087350035"], emails: ["hema@example.in"], websites: null,
    socials: ["https://www.facebook.com/103643478982863", "https://www.instagram.com/hema.mua/"], brand: null, confidence: 0.56, operating_status: null,
    sources: [{ dataset: "meta", record_id: "1036", update_time: "2026-10-12T00:00:00.000Z", license: "CDLA-Permissive-2.0" }],
  };
  const l = overtureLead(c, row, { tier: "city", segmentId: "arch", base: { lat: 18.559, lon: 73.786 } }, "2026-10-21.0");
  assert.deepEqual(
    [l.project.dedupeKey, l.project.sourceIds, l.project.phoneType, l.phone, l.creator.instagram, l.creator.facebookUrl, l.industry, l.sourceVerifiedAt],
    ["ov:9e077e65-93c2-4946-9632-6854d962ea0e", ["ov:9e077e65-93c2-4946-9632-6854d962ea0e"], "mobile", "+91 80873 50035", "hema.mua", "https://www.facebook.com/103643478982863", "Makeup artist", "2026-10-12"],
  );
  assert.match(l.sourceLabel, /Overture Maps Places 2026-10-21\.0 \(meta; CDLA-Permissive-2\.0\) · record 9e077e65/);
  assert.ok(l.project.distanceKm > 6 && l.project.distanceKm < 8);
  // Links to other hosts are never treated as social profiles.
  assert.equal(socialFields(["https://evil.example/instagram.com/x"]), undefined);
});

test("wizard validation: brief, multiple segments, split and tiers", async () => {
  const { briefErrors, segmentErrors, splitErrors, tierErrors, globalCountries } = await import("../lib/project.ts");
  assert.deepEqual(Object.keys(briefErrors({ name: "", description: "short", website: "not a url" })), ["name", "description", "website"]);
  assert.deepEqual(briefErrors({ name: "Studio", description: "Interior design studio in Baner, Pune.", website: "https://studio.in" }), {});
  assert.equal(Object.keys(briefErrors({ name: "x", description: "a".repeat(401), website: "" }))[0], "description");
  const segs = [{ id: "1", label: "Architects", include: [], exclude: [], categories: ["architect"] }, { id: "2", label: "Furniture showrooms", include: [], exclude: [], categories: ["furniture_store"] }];
  assert.deepEqual(segmentErrors(segs), []);
  assert.match(segmentErrors([...segs, { ...segs[0], id: "3" }])[0], /listed twice/);
  assert.match(segmentErrors([{ ...segs[0], categories: [] }])[0], /Confirm at least one category/);
  assert.equal(splitErrors([50, 30, 20], 3), "");
  assert.match(splitErrors([50, 30, 15], 3), /total 100%/);
  assert.match(splitErrors([52, 28, 20], 3), /steps of 5%/);
  // Global requires a country, and India (the home country) never counts for Global.
  assert.match(tierErrors({ tiers: ["city", "global"], countries: [] }, true)[0], /Global needs at least one country/);
  assert.match(tierErrors({ tiers: ["global"], countries: ["IN"] }, true)[0], /Global needs/);
  assert.deepEqual(tierErrors({ tiers: ["global"], countries: ["AE"] }, true), []);
  assert.match(tierErrors({ tiers: ["locality"], countries: [] }, false)[0], /Locality needs/);
  assert.deepEqual(globalCountries(["AE", "IN", "AE", "xx", "GB"]), ["AE", "GB"]);
});

test("categories: synonym file, typo-tolerant search and the OSM crosswalk", async () => {
  const { suggestCategories, segmentSources, categoryExists, crosswalkFor } = await import("../lib/categories.ts");
  const { default: syn } = await import("../lib/category-synonyms.json", { with: { type: "json" } });
  const { default: cw } = await import("../lib/category-crosswalk.json", { with: { type: "json" } });
  assert.ok(Object.keys(syn.terms).length >= 150, "at least 150 synonyms");
  for (const ids of Object.values(syn.terms)) for (const id of ids) assert.ok(categoryExists(id), `synonym id ${id}`);
  for (const id of Object.keys(cw.map)) assert.ok(categoryExists(id), `crosswalk id ${id}`);
  const top = (q, n = 3) => suggestCategories(q, n).map((s) => s.id);
  assert.deepEqual(top("CA", 1), ["accountant"]);
  assert.deepEqual(top("chartered accountant", 1), ["accountant"]);
  assert.ok(top("kirana").includes("convenience_store"));
  assert.ok(top("PG").includes("hostel"));
  assert.ok(top("gym").includes("gym"));
  assert.ok(top("clinic").includes("doctors_office"));
  assert.ok(top("coaching").includes("tutoring_service"));
  assert.ok(top("builder").includes("home_developer"));
  assert.ok(top("Architects").includes("architectural_designer"), "plural and multi-category synonyms");
  assert.equal(top("archtects", 1)[0], "architect", "typos");
  assert.equal(top("furnture showroom", 1)[0], "furniture_store");
  // Categories inherit OSM tags from their parent; occupations come only from the category itself.
  assert.equal(crosswalkFor("south_indian_restaurant")?.from ?? crosswalkFor("indian_restaurant").from, "indian_restaurant");
  const src = segmentSources({ id: "s", label: "Architects", include: [], exclude: [], categories: ["architect", "architectural_designer"] });
  assert.deepEqual([src.tags, src.occupations], [[{ key: "office", values: ["architect"], category: "architect" }], ["Q42973"]]);
});

test("private-individual terms warn and suggest business stand-ins", async () => {
  const { privateIndividualWarning, descriptionKeywords } = await import("../lib/project.ts");
  const w = privateIndividualWarning("College students");
  assert.match(w.message, /cannot be found directly/);
  assert.ok(w.standIns.includes("coaching institutes") && w.standIns.includes("hostels"));
  for (const label of ["parents", "Homeowners", "customers", "people in Pune"]) assert.ok(privateIndividualWarning(label), label);
  assert.equal(privateIndividualWarning("Architects"), undefined);
  assert.equal(privateIndividualWarning("Women's clothing stores"), undefined, "business words win");
  assert.deepEqual(descriptionKeywords("We are an interior design studio in Baner, Pune. We design homes and offices, and our interior work is for homes.", 4), ["interior", "design", "homes", "studio"]);
});

/** Reads a stored (uncompressed) .xlsx: sheet names and each sheet's rows as text cells. */
function readXlsx(bytes) {
  const files = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 30 < bytes.length && view.getUint32(i, true) === 0x04034b50; ) {
    const size = view.getUint32(i + 18, true), nameLen = view.getUint16(i + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    files[name] = new TextDecoder().decode(bytes.subarray(i + 30 + nameLen, i + 30 + nameLen + size));
    i += 30 + nameLen + size;
  }
  const names = [...files["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const sheets = Object.fromEntries(
    names.map((n, i) => [
      n,
      [...files[`xl/worksheets/sheet${i + 1}.xml`].matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((r) =>
        [...r[1].matchAll(/<c [^>]*?(?:\/>|>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>)/g)].map((c) => c[1] ?? c[2] ?? ""),
      ),
    ]),
  );
  return { names, sheets };
}

test("per-batch workbook: Summary, sheets only for tiers with leads, counts match", async () => {
  const { batchWorkbook, masterWorkbook, leadColumns } = await import("../lib/project-export.ts");
  const c = newCustomCampaign({
    name: "Interior studio",
    description: "Interior design studio in Baner, Pune.",
    location: "Baner, Pune",
    project: { segments, tiers: ["locality", "city", "state", "global"], countries: ["AE", "GB"], split: [40, 30, 20, 10] },
  });
  let leads = [
    ...Array.from({ length: 30 }, (_, i) => lead(c, i, "locality", segments[i % 3].id, { phone: "+91 98" + String(20000000 + i) })),
    ...Array.from({ length: 30 }, (_, i) => lead(c, i, "city", segments[i % 3].id)),
    ...Array.from({ length: 6 }, (_, i) => lead(c, i, "global", "furn", { project: { country: i % 2 ? "AE" : "GB" } })),
  ];
  leads.push({ ...lead(c, 99, "city"), name: "=HYPERLINK(\"http://evil\")" });
  const plan = planDelivery(c, leads, 50, 1, new Set(), "d1", "2026-10-24T09:00:00Z");
  leads = applyDelivery(leads, plan.ids, plan.state);
  const book = batchWorkbook(c, plan.delivery, leads, "2026-10-24");
  assert.equal(book.filename, "interior-studio-batch-1-2026-10-24.xlsx");
  const { names, sheets } = readXlsx(book.body);
  // No State sheet: the state tier had no leads.
  assert.deepEqual(names, ["Summary", "Locality", "City", "Global", "All leads"]);
  const given = leads.filter((l) => l.project.delivery.id === "d1");
  assert.equal(sheets["All leads"].length - 1, given.length);
  for (const [tier, sheet] of [["locality", "Locality"], ["city", "City"], ["global", "Global"]])
    assert.equal(sheets[sheet].length - 1, given.filter((l) => l.project.tier === tier).length, sheet);
  assert.deepEqual(sheets["All leads"][0], [...leadColumns]);
  // Global sorted by country; formulas neutralised; WhatsApp link for mobiles.
  const countryCol = leadColumns.indexOf("Country");
  const countries = sheets.Global.slice(1).map((r) => r[countryCol]);
  assert.deepEqual(countries, [...countries].sort());
  const all = sheets["All leads"].slice(1);
  assert.ok(all.every((r) => !String(r[0]).startsWith("=")));
  assert.ok(all.some((r) => /^https:\/\/wa\.me\/91\d{10}$/.test(r[leadColumns.indexOf("WhatsApp Link")])));
  const summary = sheets.Summary.map((r) => r.join(" | "));
  assert.ok(summary.includes("Requested | 50") && summary.includes(`Delivered | ${given.length}`));
  assert.ok(summary.some((r) => r.startsWith("Locality | 20 |")), "planned split per tier");
  const master = readXlsx(masterWorkbook(c, leads, [plan.delivery], [], "2026-10-24").body);
  assert.deepEqual(master.names, ["Leads", "Outcomes", "Batches", "Project"]);
  assert.equal(master.sheets.Leads.length - 1, leads.length);
  assert.deepEqual(master.sheets.Leads[0].slice(-6), ["Delivery Status", "Last Contacted", "Channel", "Template", "Replied At", "Outcome"]);
  assert.equal(master.sheets.Outcomes[1].join(), `Given,${given.length}`);
});

test("templates: placeholders, fallbacks, escaped braces, missing and unknown values", async () => {
  const { render, canSend, lintTemplate, contextFor } = await import("../lib/templates.ts");
  const ctx = { business_name: "Verb Interior", area: "", my_name: "Rini" };
  assert.deepEqual(render("Hi {business_name}, near {area|your area}. {{literal}} }}", ctx), { text: "Hi Verb Interior, near your area. {literal} }", missing: [], unknown: [], errors: [] });
  const missing = render("Hello {my_business}", ctx);
  assert.deepEqual([missing.text, missing.missing, canSend(missing)], ["Hello [my_business]", ["my_business"], false]);
  const typo = render("Hi {busines_name}", ctx);
  assert.deepEqual([typo.unknown, canSend(typo)], [["busines_name"], false]);
  assert.match(lintTemplate("Hi {area").errors[0], /Unclosed/);
  assert.match(lintTemplate("50% off }").errors[0], /lone/);
  // A line holding only an empty optional placeholder disappears.
  assert.equal(render("Hi\n{offer|}\nBye", ctx).text, "Hi\nBye");
  const c = project();
  c.custom.sender = { ...c.custom.sender, name: "Rini", business: "Rini Studio" };
  c.custom.base = { state: { name: "Maharashtra", code: "MH" } };
  const l = lead(c, 3, "city", "arch", { project: { region: "MH", country: "IN", distanceKm: 6.6, locality: "Aundh" } });
  const x = contextFor(l, c.custom);
  assert.deepEqual([x.segment, x.area, x.state, x.country, x.distance_km, x.my_business], ["Architects", "Aundh", "Maharashtra", "India", "7", "Rini Studio"]);
});

test("templates: segment → project → workspace → starter lookup and versions", async () => {
  const { pickTemplate, reviseTemplate, starterTemplates } = await import("../lib/templates.ts");
  const c = project();
  const tpl = (id, channel, segmentId = "") => ({ id, name: id, channel, segmentId, subject: "", body: id, version: 1, updatedAt: "" });
  assert.equal(pickTemplate("WhatsApp", "arch", c.custom).id, "starter-WhatsApp");
  assert.equal(pickTemplate("WhatsApp", "arch", c.custom, [tpl("ws", "WhatsApp")]).id, "ws");
  c.custom.templates = [tpl("proj", "WhatsApp"), tpl("seg", "WhatsApp", "arch")];
  assert.equal(pickTemplate("WhatsApp", "arch", c.custom, [tpl("ws", "WhatsApp")]).id, "seg");
  assert.equal(pickTemplate("WhatsApp", "dev", c.custom, [tpl("ws", "WhatsApp")]).id, "proj");
  const v2 = reviseTemplate(c.custom.templates[0], { ...c.custom.templates[0], body: "changed" });
  assert.equal(v2.version, 2);
  assert.equal(reviseTemplate(v2, { ...v2, name: "renamed" }).version, 2, "renaming keeps the version");
  // Starters never promise results or prices, and email and follow-ups carry an opt-out.
  for (const [ch, s] of Object.entries(starterTemplates)) {
    assert.doesNotMatch(s.body, /guarantee|₹|\$|income|bookings? (?:will|guaranteed)|results? guaranteed|price/i, ch);
    if (ch === "Email" || ch.startsWith("Follow-up")) assert.match(s.body, /won't message again/, ch);
  }
  assert.ok(Object.values(starterTemplates).every((s) => !/offer/i.test(s.body.replace(/\{offer\|?\}/g, ""))), "the offer appears only through {offer}");
});

test("WhatsApp and mailto links encode Marathi, Hindi and emoji; long mail links fall back to Copy", async () => {
  const { whatsappLink, mailtoLink, batchDrafts, canSend, render } = await import("../lib/templates.ts");
  const c = project();
  const mobile = lead(c, 1, "city", "arch", { phone: "+91 98232 16629" });
  const landline = lead(c, 2, "city", "arch", { phone: "020 25925173" });
  const text = "नमस्कार 🙏 आपल्या स्टुडिओसाठी & हिंदी: धन्यवाद?";
  const link = whatsappLink(mobile, text);
  assert.ok(link.startsWith("https://wa.me/919823216629?text="));
  assert.equal(decodeURIComponent(new URL(link).searchParams.get("text")), text);
  assert.equal(whatsappLink(landline, text), "", "landlines get no WhatsApp action");
  const m = mailtoLink("hi@studio.in", "नमस्ते & hello", "Line 1\nLine 2 🙂");
  assert.equal(m.href, "mailto:hi@studio.in?subject=" + encodeURIComponent("नमस्ते & hello") + "&body=" + encodeURIComponent("Line 1\nLine 2 🙂"));
  assert.equal(m.tooLong, false);
  assert.equal(mailtoLink("a@b.in", "s", "x".repeat(1900)).tooLong, true);
  // Batch drafts fill every lead and channel as text.
  c.custom.sender = { ...c.custom.sender, name: "Rini", business: "Rini Studio", pitch: "We design calm homes." };
  const { leads, blocked } = batchDrafts([mobile, landline], ["WhatsApp", "Email"], c.custom);
  assert.equal(blocked, 0);
  assert.match(leads[0].project.drafts.WhatsApp.body, /^Hi Studio 1, I'm Rini from Rini Studio\. We design calm homes\./);
  assert.match(leads[1].project.drafts.Email.subject, /Rini Studio · a quick introduction for Studio 2/);
  assert.ok(canSend(render("{my_name}", { my_name: "Rini" })));
});

test("outcomes: Mark as sent records an event and schedules Follow-up 1, then 2, then none", async () => {
  const { markSent, logReply } = await import("../lib/outcomes.ts");
  const c = project();
  const l0 = lead(c, 1);
  const first = markSent(l0, { channel: "WhatsApp", templateId: "t1", templateVersion: 3 }, 3, "2026-10-24T10:00:00Z", "e1");
  assert.deepEqual(
    [first.lead.project.outreach.status, first.lead.stage, first.lead.followUp, first.lead.project.outreach.followUpStep, first.lead.contactedAt],
    ["contacted", "Contacted", "2026-10-27", 1, "2026-10-24T10:00:00Z"],
  );
  assert.deepEqual(first.event, { id: "e1", campaignId: c.id, leadId: l0.id, channel: "WhatsApp", templateId: "t1", templateVersion: 3, direction: "outbound", note: "", createdAt: "2026-10-24T10:00:00Z" });
  const second = markSent(first.lead, { channel: "Follow-up 1" }, 3, "2026-10-27T10:00:00Z");
  assert.deepEqual([second.lead.followUp, second.lead.project.outreach.followUpStep], ["2026-10-30", 2]);
  const third = markSent(second.lead, { channel: "Follow-up 2" }, 3, "2026-10-30T10:00:00Z");
  assert.deepEqual([third.lead.followUp, third.lead.project.outreach.followUpStep], ["", 0]);
  // Log reply: Replied, reply date, reminders end.
  const replied = logReply(second.lead, "WhatsApp", "Call me Monday", "2026-10-28T09:00:00Z", "r1");
  assert.deepEqual([replied.lead.project.outreach.status, replied.lead.stage, replied.lead.project.outreach.repliedAt, replied.lead.followUp], ["replied", "Replied", "2026-10-28T09:00:00Z", ""]);
  assert.deepEqual([replied.event.direction, replied.event.note], ["reply", "Call me Monday"]);
  // A reply never moves a lead backwards.
  const { setStatus } = await import("../lib/outcomes.ts");
  const won = setStatus(replied.lead, "won", "2026-11-01");
  assert.equal(logReply(won, "Email", "", "2026-11-02").lead.project.outreach.status, "won");
  assert.equal(won.stage, "Converted");
  assert.ok(won.history.some((h) => /Stage changed from Replied to Converted/.test(h.event)));
});

test("outcomes: the No-response rule suggests, after the waiting period, only contacted leads without replies", async () => {
  const { markSent, logReply, noResponseSuggestions } = await import("../lib/outcomes.ts");
  const c = project();
  const sent = (i, at, channel = "Follow-up 2") => markSent(lead(c, i), { channel }, 3, at);
  const a = sent(1, "2026-10-01T10:00:00Z"); // last follow-up long ago
  const b = sent(2, "2026-10-20T10:00:00Z"); // last follow-up 4 days ago
  const r = logReply(sent(3, "2026-10-01T10:00:00Z").lead, "Email", "", "2026-10-02"); // replied
  const pending = sent(4, "2026-10-01T10:00:00Z", "WhatsApp"); // Follow-up 1 reminder overdue since 10-04
  const fresh = sent(5, "2026-10-22T10:00:00Z", "WhatsApp"); // reminder 10-25, not yet overdue by 7 days
  const events = [a.event, b.event, r.event, pending.event, fresh.event];
  const ids = noResponseSuggestions([a.lead, b.lead, r.lead, pending.lead, fresh.lead, lead(c, 6)], events, () => 7, "2026-10-24").map((l) => l.name);
  assert.deepEqual(ids, ["Studio 1", "Studio 4"]);
});

test("outcomes: Do not contact adds phone, email, domain and handle to the suppression list", async () => {
  const { doNotContactEntries, suppressionIndex, isSuppressed } = await import("../lib/suppression.ts");
  const c = project();
  const l = projectLead(c, {
    name: "Rival Studio", segmentId: "arch", tier: "city", source: { name: "Overture Maps", id: "ov:r", url: "" },
    phone: "+91 98111 22233", email: "Hello@Rival.in", website: "https://www.rival.in/contact",
    creator: { ...(await import("../lib/gloss.ts")).emptyCreator(), instagram: "rival.studio", instagramUrl: "https://www.instagram.com/rival.studio/" },
  });
  const entries = doNotContactEntries(l, "2026-10-24");
  assert.deepEqual(entries.map((e) => `${e.kind}:${e.value}`), ["phone:+919811122233", "email:hello@rival.in", "domain:rival.in", "handle:rival.studio"]);
  // The same business found again later is suppressed by any of them.
  const again = projectLead(c, { name: "Rival Studio Baner", segmentId: "arch", tier: "locality", source: { name: "OpenStreetMap", id: "osm:node/9", url: "" }, website: "http://rival.in" });
  assert.ok(isSuppressed(again, suppressionIndex(entries)));
});

test("outcomes: funnel and breakdown maths on a known fixture", async () => {
  const { insights, markSent, logReply, setStatus, hints, outcomesSheet } = await import("../lib/outcomes.ts");
  const c = project();
  const given = (l, batch = 1) => ({ ...l, project: { ...l.project, delivery: { status: "given", id: `d${batch}`, givenAt: "2026-10-01", batch } } });
  const leads = [];
  const events = [];
  // 10 given City leads: 8 contacted on WhatsApp, 4 replied (1 after 2 h, 3 after 26 h), 2 interested, 1 won, 1 bad contact.
  for (let i = 0; i < 10; i++) {
    let l = given(lead(c, i, "city", i < 5 ? "arch" : "dev"));
    if (i < 8) {
      const s = markSent(l, { channel: "WhatsApp", templateId: "t1", templateVersion: 1 }, 3, "2026-10-02T08:00:00Z", `o${i}`);
      l = s.lead;
      events.push(s.event);
    }
    if (i < 4) {
      const r = logReply(l, "WhatsApp", "", i === 0 ? "2026-10-02T10:00:00Z" : "2026-10-03T10:00:00Z", `r${i}`);
      l = r.lead;
      events.push(r.event);
    }
    if (i < 2) l = setStatus(l, "interested", "2026-10-04");
    if (i === 0) l = setStatus(l, "won", "2026-10-05");
    if (i === 7) l = setStatus(l, "bad_contact", "2026-10-03");
    leads.push(l);
  }
  leads.push(lead(c, 99, "state")); // in the pool, never given: not counted
  const data = insights(leads, events, { tier: (t) => t, segment: (s) => s, template: (id, v) => `${id} v${v}` });
  assert.deepEqual(data.funnel.map((s) => s.count), [10, 8, 4, 2, 1, 1]);
  assert.deepEqual(
    [data.totals.contactRate, data.totals.replyRate, data.totals.interestedRate, data.totals.winRate, data.totals.medianHoursToReply],
    [80, 50, 25, 12.5, 26],
  );
  assert.deepEqual(data.bySegment.map((g) => [g.key, g.given, g.contacted, g.replied]), [["arch", 5, 5, 4], ["dev", 5, 3, 0]]);
  assert.deepEqual(data.byTemplate.map((g) => [g.label, g.contacted]), [["t1 v1", 8], ["No template", 0]]);
  assert.deepEqual(data.bySource.map((g) => [g.key, g.bad]), [["Overture Maps", 1]]);
  assert.deepEqual(data.byBatch.map((g) => g.label), ["Batch 1"]);
  // Hints need at least 30 contacted leads in every compared group.
  assert.deepEqual(hints(data.byTier, "tier"), []);
  const big = [
    { key: "city", label: "City", given: 40, contacted: 40, replied: 8, interested: 0, won: 0, bad: 0 },
    { key: "locality", label: "Locality", given: 40, contacted: 34, replied: 3, interested: 0, won: 0, bad: 0 },
  ];
  assert.deepEqual(hints(big, "tier"), ["City tier reply rate 20% vs Locality 8.8%. Consider shifting the split towards City."]);
  assert.deepEqual(hints([big[0], { ...big[1], contacted: 29 }], "tier"), []);
  const sheet = outcomesSheet(data);
  assert.deepEqual(sheet[1], ["Given", 10]);
  assert.ok(sheet.some((r) => r[0] === "By template (version)"));
});

test("map: markers coloured by tier, outlined by status; leads without coordinates are listed", async () => {
  const { buildMarkers, markerStatus, tierColors, statusStyles, TILE_URL } = await import("../lib/map-markers.ts");
  const { anyProjectFilter } = await import("../lib/lead-filters.ts");
  const { setStatus } = await import("../lib/outcomes.ts");
  const c = project();
  const given = (l) => ({ ...l, project: { ...l.project, delivery: { status: "given", id: "d1", givenAt: "2026-10-24", batch: 1 } } });
  const a = lead(c, 1, "locality", "arch", { phone: "+91 98232 16629" });
  const b = given(lead(c, 2, "city", "dev"));
  const won = setStatus(given(lead(c, 3, "state", "furn")), "won", "2026-10-24");
  const bad = setStatus(given(lead(c, 4, "city", "arch")), "bad_contact", "2026-10-24");
  const nowhere = { ...lead(c, 5, "global", "furn"), project: { ...lead(c, 5, "global", "furn").project, lat: null, lon: null, country: "AE" } };
  const r = buildMarkers([a, b, won, bad, nowhere], anyProjectFilter());
  assert.deepEqual(r.markers.map((m) => [m.tier, m.color, m.status]), [
    ["locality", tierColors.locality, "available"],
    ["city", tierColors.city, "given"],
    ["state", tierColors.state, "won"],
    ["city", tierColors.city, "bad_contact"],
  ]);
  assert.equal(r.markers[0].dashed, true, "available leads have a dashed outline");
  assert.equal(r.markers[3].ring, statusStyles.bad_contact.ring);
  assert.deepEqual(r.missing.map((l) => l.name), ["Studio 5"]);
  assert.deepEqual(r.countries, ["AE"]);
  assert.ok(r.bounds.s <= r.bounds.n && r.bounds.w <= r.bounds.e);
  // Same filters as the Leads page.
  assert.deepEqual(buildMarkers([a, b, won, bad], { ...anyProjectFilter(), delivery: "given", hasPhone: false }).markers.length, 3);
  assert.deepEqual(buildMarkers([a, b], { ...anyProjectFilter(), hasPhone: true }).markers.map((m) => m.id), [a.id]);
  assert.deepEqual(buildMarkers([a, b, won], { ...anyProjectFilter(), tier: "city" }).markers.map((m) => m.id), [b.id]);
  assert.equal(markerStatus(setStatus(b, "meeting", "x")), "replied");
  assert.match(TILE_URL, /^https:\/\/tile\.openstreetmap\.org\//);
});

test("re-check stale leads: refreshes found records, notes missing or closed ones, never removes", async () => {
  const { recheckStale, staleLeads, contactChecks } = await import("../lib/project-checks.ts");
  const c = project();
  const old = (l, id) => ({ ...l, checkedAt: "2026-05-01", project: { ...l.project, sourceIds: [id], dedupeKey: id, country: "IN" } });
  const a = old(lead(c, 1, "city", "arch"), "ov:ov-a");
  const gone = old(lead(c, 2, "city", "arch"), "ov:gone");
  const closed = old(lead(c, 3, "city", "arch"), "ov:ov-e");
  const osm = old(lead(c, 4, "city", "arch"), "osm:node/42");
  const recent = { ...lead(c, 5), checkedAt: "2026-10-01" };
  assert.deepEqual(staleLeads([a, gone, closed, osm, recent], "2026-10-24").length, 4);
  const row = { id: "ov-a", name: "Studio 1", basic_category: null, category: "architect", alternates: null, address: "", locality: "Pune", postcode: null, region: "MH", country: "IN", lat: 18.5, lon: 73.8, phones: ["+919820000001"], emails: ["new@studio1.in"], websites: null, socials: null, brand: null, confidence: 0.9, operating_status: null, sources: [] };
  const r = await recheckStale(c, [a, gone, closed, osm, recent], {
    call: async (route, body) => {
      assert.equal(route, "/lookup");
      assert.deepEqual(body.ids, ["ov-a", "gone", "ov-e"]);
      return { rows: [row, { ...row, id: "ov-e", operating_status: "permanently_closed" }], missing: ["gone"], release: "2026-10-21.0" };
    },
    discover: async (b) => {
      assert.deepEqual(b, { action: "osm-ids", ids: ["node/42"] });
      return { elements: [{ type: "node", id: 42, lat: 18.5, lon: 73.8, tags: { name: "Studio 4", office: "architect", phone: "+91 9820000004" } }] };
    },
  }, "2026-10-24");
  const by = new Map(r.leads.map((l) => [l.name, l]));
  assert.equal(r.stale, 4);
  assert.deepEqual([by.get("Studio 1").checkedAt, by.get("Studio 1").email], ["2026-10-24", "new@studio1.in"]);
  assert.match(by.get("Studio 2").history.at(-1).event, /Not listed in Overture release 2026-10-21\.0/);
  assert.equal(by.get("Studio 2").checkedAt, "2026-05-01", "a missing record is not marked as re-confirmed");
  assert.match(by.get("Studio 3").history.at(-1).event, /permanently closed/);
  assert.equal(by.get("Studio 4").checkedAt, "2026-10-24");
  assert.ok(r.leads.every((l) => l.project.delivery.status === "available"), "delivery state untouched");
  assert.match(r.reports[0].message, /1 re-confirmed, 1 marked closed by the source, 1 no longer listed/);
  // Contact checks store their results on the lead.
  const checked = await contactChecks([{ ...a, email: "hi@studio1.in", website: "https://studio1.in" }], async (route, body) =>
    route === "/check-email" ? { results: body.emails.map((email) => ({ email, result: "valid domain" })) } : { results: body.urls.map((url) => ({ url, result: "dead" })) },
  );
  assert.deepEqual([checked.leads[0].project.emailCheck, checked.leads[0].project.websiteStatus, checked.summary.dead], ["valid domain", "dead", 1]);
});
