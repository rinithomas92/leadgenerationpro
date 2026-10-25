// Shared by the Overture and Foursquare extract scripts: the all-countries mode
// writes every place once, partitioned by country (a single pass over the source),
// then turns each country into one location-sorted file the sources service
// searches, recording it in the manifest as soon as it is ready.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const fwd = (p) => p.replace(/\\/g, "/");

export function readManifest(dataDir) {
  const file = path.join(dataDir, "manifest.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { releases: {} };
}
export function recordCountry(dataDir, release, cc, file, rows) {
  const m = readManifest(dataDir);
  m.releases[release] ??= {};
  m.releases[release][cc] = { file: fwd(path.relative(dataDir, file)), rows, extractedAt: new Date().toISOString() };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify(m, null, 2));
}

/**
 * Writes `selectSql` (which must yield a `cc` column with the two-letter country
 * code) to a staging folder partitioned by cc, then compacts each country into
 * <dataDir>/<release>/<CC>.parquet sorted by location.
 */
export async function extractAllCountries(c, { dataDir, release, selectSql, log = console.log }) {
  const dir = path.join(dataDir, release);
  const staging = path.join(dir, "_staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const started = Date.now();
  log("Downloading every country in one pass (this takes a while; nothing is written to the final files until it ends)…");
  await c.run(`COPY (${selectSql}) TO '${fwd(staging)}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (cc), OVERWRITE_OR_IGNORE)`);
  log(`Download finished in ${Math.round((Date.now() - started) / 60000)} min. Sorting each country…`);
  const done = [];
  for (const d of readdirSync(staging).sort()) {
    const cc = /^cc=([A-Z]{2})$/.exec(d)?.[1];
    if (!cc) continue;
    const file = path.join(dir, `${cc}.parquet`);
    const tmp = file + ".tmp";
    rmSync(tmp, { force: true });
    await c.run(
      `COPY (SELECT * FROM read_parquet('${fwd(path.join(staging, d))}/*.parquet') ORDER BY round(bbox.ymin, 1), round(bbox.xmin, 1), id)
       TO '${fwd(tmp)}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
    );
    renameSync(tmp, file);
    const rows = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${fwd(file)}')`)).getRowObjectsJson()[0].n);
    recordCountry(dataDir, release, cc, file, rows);
    rmSync(path.join(staging, d), { recursive: true, force: true });
    done.push([cc, rows]);
  }
  rmSync(staging, { recursive: true, force: true });
  log(`${done.length} countries saved, ${done.reduce((n, [, r]) => n + r, 0).toLocaleString()} places, in ${Math.round((Date.now() - started) / 60000)} min.`);
  return done;
}
