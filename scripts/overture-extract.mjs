// Downloads Overture Maps Places extracts for one or more countries into
// data/overture/<release>/<CC>.parquet (git-ignored) and records them in
// data/overture/manifest.json. Re-run to update to the latest monthly release.
//
//   npm run overture:extract                  # India, latest release
//   npm run overture:extract -- AE GB         # other countries
//   npm run overture:extract -- IN --release 2026-10-21.0
//   npm run overture:extract -- --all         # every country in one pass (recommended for worldwide use)
//
// Data: Overture Maps Foundation, Places theme (CDLA-Permissive-2.0 / Apache-2.0
// per source). Reads anonymously from Overture's public S3 bucket; no account
// or key is needed.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { extractAllCountries } from "./extract-common.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.env.OVERTURE_DATA || path.join(root, "data", "overture");
const bucket = "s3://overturemaps-us-west-2/release";

export async function latestRelease(f = fetch) {
  const r = await f("https://stac.overturemaps.org/catalog.json", { headers: { "User-Agent": "LeadGenPro/1.0 (overture extract)" } });
  if (!r.ok) throw new Error(`Overture release catalog unavailable (HTTP ${r.status})`);
  const catalog = await r.json();
  const releases = (catalog.links || [])
    .map((l) => /(\d{4}-\d{2}-\d{2}\.\d+)/.exec(l.href || "")?.[1])
    .filter(Boolean)
    .sort();
  if (!releases.length) throw new Error("No releases listed in the Overture catalog.");
  return releases.at(-1);
}
function readManifest() {
  const file = path.join(dataDir, "manifest.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { releases: {} };
}
function writeManifest(m) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify(m, null, 2));
}

export async function extract(countries, release, log = console.log) {
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2';");
  if (countries === "all") {
    const glob = `${bucket}/${release}/theme=places/type=place/*`;
    const files = (await c.runAndReadAll(`SELECT file FROM glob('${glob}') ORDER BY file`)).getRowObjectsJson().map((r) => r.file);
    const partSql = (file) => `SELECT addresses[1].country AS cc, id, names, basic_category, taxonomy, confidence, operating_status, addresses, phones, emails, websites, socials, brand, sources, bbox
      FROM read_parquet('${file.replace(/'/g, "''")}') WHERE regexp_matches(coalesce(addresses[1].country, ''), '^[A-Z]{2}$')`;
    return extractAllCountries(c, { dataDir, release, parts: { files, partSql }, log });
  }
  for (const cc of countries) {
    if (!/^[A-Z]{2}$/.test(cc)) throw new Error(`Not an ISO country code: ${cc}`);
    const started = Date.now();
    log(`${cc}: finding the country area in Overture divisions (${release})…`);
    const area = await c.runAndReadAll(
      `SELECT min(bbox.xmin) AS w, min(bbox.ymin) AS s, max(bbox.xmax) AS e, max(bbox.ymax) AS n
       FROM read_parquet('${bucket}/${release}/theme=divisions/type=division_area/*', hive_partitioning=1)
       WHERE subtype = 'country' AND country = '${cc}' AND class = 'land'`,
    );
    const b = area.getRowObjectsJson()[0];
    if (b?.w == null) throw new Error(`${cc} was not found in Overture divisions.`);
    log(`${cc}: bbox ${[b.w, b.s, b.e, b.n].map((v) => Number(v).toFixed(2)).join(", ")}; downloading places (this can take 5–20 minutes)…`);
    const dir = path.join(dataDir, release);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${cc}.parquet`);
    const tmp = file + ".tmp";
    rmSync(tmp, { force: true });
    await c.run(
      `COPY (
        SELECT id, names, basic_category, taxonomy, confidence, operating_status, addresses, phones, emails, websites, socials, brand, sources, bbox
        FROM read_parquet('${bucket}/${release}/theme=places/type=place/*', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN ${b.w} AND ${b.e} AND bbox.ymin BETWEEN ${b.s} AND ${b.n}
          AND addresses[1].country = '${cc}'
        -- Nearby places share row groups, so radius queries read little.
        ORDER BY round(bbox.ymin, 1), round(bbox.xmin, 1), id
      ) TO '${tmp.replace(/\\/g, "/")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
    );
    renameSync(tmp, file);
    const rows = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${file.replace(/\\/g, "/")}')`)).getRowObjectsJson()[0].n);
    const m = readManifest();
    m.releases[release] ??= {};
    m.releases[release][cc] = { file: path.relative(dataDir, file).replace(/\\/g, "/"), rows, extractedAt: new Date().toISOString() };
    writeManifest(m);
    log(`${cc}: ${rows.toLocaleString()} places saved to ${path.relative(root, file)} in ${Math.round((Date.now() - started) / 1000)} s.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--release");
  let release = at >= 0 ? args[at + 1] : "latest";
  const countries = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)).map((a) => a.toUpperCase());
  if (release === "latest") release = await latestRelease();
  await extract(args.includes("--all") ? "all" : countries.length ? countries : ["IN"], release);
}
