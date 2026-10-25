// Downloads Foursquare Open Source Places for one or more countries into
// data/foursquare/<release>/<CC>.parquet (git-ignored) and records them in
// data/foursquare/manifest.json. The rows are reshaped into the same layout as
// the Overture extract, so the sources service searches both the same way.
//
// Foursquare gates this dataset on Hugging Face: sign in at
// https://huggingface.co/datasets/foursquare/fsq-os-places, accept the terms,
// create a read token, then:
//
//   set HF_TOKEN=hf_...            (PowerShell: $env:HF_TOKEN = "hf_...")
//   npm run fsq:extract            # India, latest release
//   npm run fsq:extract -- AE GB   # other countries
//   npm run fsq:extract -- --all   # every country in one pass (recommended for worldwide use)
//   npm run fsq:extract -- IN --release 2026-01-12
//
// Data: Foursquare Open Source Places, Apache-2.0.
import { mkdirSync, readFileSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import taxonomy from "../lib/overture-taxonomy.json" with { type: "json" };
import { suggestCategories } from "../lib/categories.ts";
import { extractAllCountries, recordCountry } from "./extract-common.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.env.FSQ_DATA || path.join(root, "data", "foursquare");
const repo = "foursquare/fsq-os-places";
const known = new Set(taxonomy.categories.map((r) => r[0]));

export const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
// Foursquare names that have no same-named Overture category.
const overrides = {
  fuel_station: "gas_station", mosque: "religious_organization", church: "religious_organization", synagogue: "religious_organization", gurdwara: "religious_organization",
  nutritionist: "nutrition_service", pet_supplies_store: "pet_store", computer_repair_service: "it_service_and_computer_repair", gun_store: "gun_and_ammo_store",
  new_car_dealership: "auto_dealer", used_car_dealership: "used_auto_dealer", car_dealership: "auto_dealer", newsstand: "newspaper_and_magazines_store",
  business_center: "coworking_space", food_stand: "food_truck_stand", street_food_gathering: "food_truck_stand", sporting_goods_retail: "sporting_goods_store",
  professional_cleaning_service: "cleaning_service", womens_health_clinic: "womens_health_clinic", pizzeria: "pizza_restaurant",
  shipping_freight_and_material_transportation_service: "freight_and_cargo_service", warehouse_or_wholesale_store: "wholesaler",
};
const topLevel = new Set(taxonomy.categories.map((r) => r[1][0]));
const clean = (s) => s.replace(/['’]/g, "");
const variants = (id) => [id, id.replace(/_(shop|store)$/, "_store"), id.replace(/_(shop|store)$/, "_shop"), id.replace(/ies$/, "y"), id.replace(/s$/, ""), id.replace(/^(.*)_and_.*$/, "$1")];
/**
 * A Foursquare label ("Dining and Drinking > Italian Restaurant") as an Overture category id:
 * the last segment, then its parent, by exact id, spelling variants, and the synonym/fuzzy
 * search the app uses. Labels with no match keep their own id so name keywords still find them.
 */
export function mapLabel(label) {
  const parts = label.split(">").map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 2); i--) {
    const text = clean(parts[i]);
    const hit = overrides[slug(text)] ?? variants(slug(text)).find((o) => known.has(o) && !topLevel.has(o)) ?? suggestCategories(text, 1, { strict: true }).find((x) => !topLevel.has(x.id))?.id;
    if (hit) return hit;
  }
  return slug(clean(parts.at(-1) ?? label));
}
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function latestRelease(token, f = fetch) {
  const r = await f(`https://huggingface.co/api/datasets/${repo}/tree/main/release`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Could not list Foursquare releases (HTTP ${r.status}). Check HF_TOKEN and that you accepted the dataset terms.`);
  const dates = (await r.json()).map((e) => /dt=(\d{4}-\d{2}-\d{2})/.exec(e.path || "")?.[1]).filter(Boolean).sort();
  if (!dates.length) throw new Error("No Foursquare releases found.");
  return dates.at(-1);
}
/** SELECT that turns raw Foursquare place columns into the Overture-shaped row. `labelMap` is a DuckDB MAP literal. */
export function reshapeSql(placesSql, labelMap, { order = true } = {}) {
  const cats = `list_distinct(list_filter(list_transform(coalesce(fsq_category_labels, []::VARCHAR[]), l -> ${labelMap}[trim(l)]), x -> x IS NOT NULL))`;
  return `SELECT
    fsq_place_id AS id,
    {'primary': name} AS names,
    NULL::VARCHAR AS basic_category,
    {'primary': ${cats}[1], 'hierarchy': ${cats}[1:1], 'alternates': ${cats}[2:]} AS taxonomy,
    NULL::DOUBLE AS confidence,
    CASE WHEN date_closed IS NOT NULL THEN 'permanently_closed' ELSE 'open' END AS operating_status,
    [{'freeform': nullif(trim(coalesce(address, '')), ''), 'locality': nullif(trim(coalesce(locality, '')), ''), 'postcode': nullif(trim(coalesce(postcode, '')), ''),
      'region': nullif(trim(coalesce(region, admin_region, '')), ''), 'country': upper(country)}] AS addresses,
    CASE WHEN nullif(trim(coalesce(tel, '')), '') IS NULL THEN NULL ELSE [trim(tel)] END AS phones,
    CASE WHEN nullif(trim(coalesce(email, '')), '') IS NULL THEN NULL ELSE [trim(email)] END AS emails,
    CASE WHEN nullif(trim(coalesce(website, '')), '') IS NULL THEN NULL ELSE [trim(website)] END AS websites,
    list_filter([
      CASE WHEN nullif(trim(coalesce(instagram, '')), '') IS NULL THEN NULL ELSE 'https://www.instagram.com/' || trim(instagram) || '/' END,
      CASE WHEN nullif(trim(coalesce(facebook_id::VARCHAR, '')), '') IS NULL THEN NULL ELSE 'https://www.facebook.com/' || trim(facebook_id::VARCHAR) END
    ], x -> x IS NOT NULL) AS socials,
    {'names': {'primary': NULL::VARCHAR}} AS brand,
    [{'dataset': 'foursquare', 'record_id': fsq_place_id, 'update_time': coalesce(date_refreshed, date_created)::VARCHAR, 'license': 'Apache-2.0'}] AS sources,
    {'xmin': longitude::DOUBLE, 'xmax': longitude::DOUBLE, 'ymin': latitude::DOUBLE, 'ymax': latitude::DOUBLE} AS bbox
  FROM (${placesSql})
  WHERE name IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
  ${order ? "ORDER BY round(latitude, 1), round(longitude, 1), fsq_place_id" : ""}`;
}

export async function extract(countries, release, token, log = console.log) {
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run("INSTALL httpfs; LOAD httpfs;");
  await c.run(`CREATE SECRET hf_secret (TYPE HUGGINGFACE, TOKEN ${sqlStr(token)})`);
  const base = `hf://datasets/${repo}/release/dt=${release}`;
  log(`Reading Foursquare category labels (${release})…`);
  const labels = (await c.runAndReadAll(`SELECT DISTINCT category_label AS l FROM read_parquet('${base}/categories/parquet/*.parquet')`)).getRowObjectsJson().map((r) => r.l);
  const uniq = [...new Set(labels.map((l) => l.trim()))];
  const labelMap = `MAP {${uniq.map((l) => `${sqlStr(l)}: ${sqlStr(mapLabel(l))}`).join(", ")}}`;
  log(`${uniq.length} category labels, ${uniq.filter((l) => known.has(mapLabel(l))).length} matched to Overture categories.`);
  if (countries === "all") {
    const raw = `SELECT * FROM read_parquet('${base}/places/parquet/*.parquet')`;
    const selectSql = `SELECT upper(country) AS cc, * FROM (${reshapeSql(raw, labelMap, { order: false })}) WHERE regexp_matches(upper(country), '^[A-Z]{2}$')`;
    return extractAllCountries(c, { dataDir, release, selectSql, log });
  }
  for (const cc of countries) {
    if (!/^[A-Z]{2}$/.test(cc)) throw new Error(`Not an ISO country code: ${cc}`);
    const started = Date.now();
    log(`${cc}: downloading places (this can take 5–20 minutes)…`);
    const dir = path.join(dataDir, release);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${cc}.parquet`);
    const tmp = file + ".tmp";
    rmSync(tmp, { force: true });
    const raw = `SELECT * FROM read_parquet('${base}/places/parquet/*.parquet') WHERE country = '${cc}'`;
    await c.run(`COPY (${reshapeSql(raw, labelMap)}) TO '${tmp.replace(/\\/g, "/")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`);
    renameSync(tmp, file);
    const rows = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${file.replace(/\\/g, "/")}')`)).getRowObjectsJson()[0].n);
    recordCountry(dataDir, release, cc, file, rows);
    log(`${cc}: ${rows.toLocaleString()} places saved to ${path.relative(root, file)} in ${Math.round((Date.now() - started) / 1000)} s.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // HF_TOKEN comes from the environment or from HF_TOKEN=... in .env.local (Git-ignored).
  const envFile = path.join(root, ".env.local");
  const fromFile = existsSync(envFile) ? /^\s*HF_TOKEN\s*=\s*["']?([^"'\s]+)["']?\s*$/m.exec(readFileSync(envFile, "utf8"))?.[1] : "";
  const token = process.env.HF_TOKEN || fromFile;
  if (!token) {
    console.error("No token found. Put HF_TOKEN=hf_... on its own line in .env.local (see the comment at the top of this file).");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const at = args.indexOf("--release");
  let release = at >= 0 ? args[at + 1] : "latest";
  const countries = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)).map((a) => a.toUpperCase());
  if (release === "latest") release = await latestRelease(token);
  await extract(args.includes("--all") ? "all" : countries.length ? countries : ["IN"], release, token);
}
