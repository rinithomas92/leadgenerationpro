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
//   npm run fsq:extract -- IN --release 2026-01-12
//
// Data: Foursquare Open Source Places, Apache-2.0.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import taxonomy from "../lib/overture-taxonomy.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.env.FSQ_DATA || path.join(root, "data", "foursquare");
const repo = "foursquare/fsq-os-places";
const known = new Set(taxonomy.categories.map((r) => r[0]));

export const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
/** Foursquare's last label segment ("Dining > Italian Restaurant") as an Overture category id when one matches. */
export function mapLabel(label) {
  const leaf = label.split(">").pop().trim();
  const id = slug(leaf);
  const options = [id, id.replace(/_(shop|store)$/, "_store"), id.replace(/_(shop|store)$/, "_shop"), id.replace(/s$/, ""), id.replace(/^(.*)_and_.*$/, "$1")];
  return options.find((o) => known.has(o)) ?? id;
}
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function latestRelease(token, f = fetch) {
  const r = await f(`https://huggingface.co/api/datasets/${repo}/tree/main/release`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Could not list Foursquare releases (HTTP ${r.status}). Check HF_TOKEN and that you accepted the dataset terms.`);
  const dates = (await r.json()).map((e) => /dt=(\d{4}-\d{2}-\d{2})/.exec(e.path || "")?.[1]).filter(Boolean).sort();
  if (!dates.length) throw new Error("No Foursquare releases found.");
  return dates.at(-1);
}
function readManifest() {
  const file = path.join(dataDir, "manifest.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { releases: {} };
}

/** SELECT that turns raw Foursquare place columns into the Overture-shaped row. `labelMap` is a DuckDB MAP literal. */
export function reshapeSql(placesSql, labelMap) {
  const cats = `list_distinct(list_filter(list_transform(coalesce(fsq_category_labels, []::VARCHAR[]), l -> coalesce(${labelMap}[trim(string_split(l, '>')[-1])], NULL)), x -> x IS NOT NULL))`;
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
  ORDER BY round(latitude, 1), round(longitude, 1), fsq_place_id`;
}

export async function extract(countries, release, token, log = console.log) {
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run("INSTALL httpfs; LOAD httpfs;");
  await c.run(`CREATE SECRET hf_secret (TYPE HUGGINGFACE, TOKEN ${sqlStr(token)})`);
  const base = `hf://datasets/${repo}/release/dt=${release}`;
  log(`Reading Foursquare category labels (${release})…`);
  const labels = (await c.runAndReadAll(`SELECT DISTINCT category_label AS l FROM read_parquet('${base}/categories/parquet/*.parquet')`)).getRowObjectsJson().map((r) => r.l);
  const leaves = [...new Set(labels.map((l) => l.split(">").pop().trim()))];
  const labelMap = `MAP {${leaves.map((l) => `${sqlStr(l)}: ${sqlStr(mapLabel(l))}`).join(", ")}}`;
  log(`${leaves.length} category labels, ${leaves.filter((l) => known.has(mapLabel(l))).length} matched to Overture categories.`);
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
    const m = readManifest();
    m.releases[release] ??= {};
    m.releases[release][cc] = { file: path.relative(dataDir, file).replace(/\\/g, "/"), rows, extractedAt: new Date().toISOString() };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify(m, null, 2));
    log(`${cc}: ${rows.toLocaleString()} places saved to ${path.relative(root, file)} in ${Math.round((Date.now() - started) / 1000)} s.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error("Set HF_TOKEN to a Hugging Face read token for an account that accepted the Foursquare terms (see the comment at the top of this file).");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const at = args.indexOf("--release");
  let release = at >= 0 ? args[at + 1] : "latest";
  const countries = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)).map((a) => a.toUpperCase());
  if (release === "latest") release = await latestRelease(token);
  await extract(countries.length ? countries : ["IN"], release, token);
}
