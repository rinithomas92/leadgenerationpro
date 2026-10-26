// Re-maps the categories of an existing Foursquare extract in place, without
// downloading anything, using the current label mapping (see mapLabel in
// fsq-extract.mjs). Useful after the mapping improves.
//
//   npm run fsq:remap              # every country in the newest release
//   npm run fsq:remap -- IN
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import taxonomy from "../lib/overture-taxonomy.json" with { type: "json" };
import { mapLabel } from "./fsq-extract.mjs";
import { readManifest } from "./extract-common.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.env.FSQ_DATA || path.join(root, "data", "foursquare");
const known = new Set(taxonomy.categories.map((r) => r[0]));
const fwd = (p) => p.replace(/\\/g, "/");
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function remap(countries, log = console.log) {
  const m = readManifest(dataDir);
  const release = Object.keys(m.releases).sort().at(-1);
  if (!release) throw new Error("No Foursquare extract to remap. Run npm run fsq:extract first.");
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  for (const [cc, e] of Object.entries(m.releases[release])) {
    if (countries.length && !countries.includes(cc)) continue;
    const file = path.resolve(dataDir, e.file);
    if (!existsSync(file)) continue;
    const src = `read_parquet('${fwd(file)}')`;
    const ids = (await c.runAndReadAll(
      `SELECT DISTINCT x FROM (SELECT taxonomy.primary AS x FROM ${src} UNION ALL SELECT unnest(taxonomy.alternates) FROM ${src}) WHERE x IS NOT NULL`,
    )).getRowObjectsJson().map((r) => r.x);
    const todo = ids.filter((x) => !known.has(x));
    const map = new Map(todo.map((x) => [x, mapLabel(x.replace(/_/g, " "))]).filter(([x, y]) => known.has(y) && y !== x));
    log(`${cc}: ${todo.length} category ids unmatched, ${map.size} now mapped.`);
    if (!map.size) continue;
    const lookup = `MAP {${[...map].map(([k, v]) => `${sqlStr(k)}: ${sqlStr(v)}`).join(", ")}}`;
    const p = `coalesce(${lookup}[taxonomy.primary], taxonomy.primary)`;
    // Re-mapped alternates keep their order; duplicates are dropped by position, not by list_distinct.
    const alts = `list_transform(coalesce(taxonomy.alternates, []::VARCHAR[]), a -> coalesce(${lookup}[a], a))`;
    const tmp = file + ".tmp";
    rmSync(tmp, { force: true });
    await c.run(
      `COPY (SELECT * REPLACE ({'primary': ${p}, 'hierarchy': [${p}], 'alternates': list_filter(${alts}, (a, i) -> a IS DISTINCT FROM ${p} AND list_position(${alts}, a) = i)} AS taxonomy) FROM ${src})
       TO '${fwd(tmp)}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
    );
    renameSync(tmp, file);
    const matched = Number((await c.runAndReadAll(`SELECT count(*) n FROM read_parquet('${fwd(file)}') WHERE taxonomy.primary IN (${[...known].map(sqlStr).join(",")})`)).getRowObjectsJson()[0].n);
    log(`${cc}: ${matched.toLocaleString()} of ${e.rows.toLocaleString()} places now sit in an Overture category.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await remap(process.argv.slice(2).map((a) => a.toUpperCase()));
}
