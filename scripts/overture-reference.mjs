// Builds the reference data shipped in lib/ from an Overture release:
//   lib/overture-taxonomy.json  every places category (taxonomy.primary) with its
//                               hierarchy, basic category and worldwide count
//   lib/countries.json          ISO country codes, English names and land bboxes
// Overture publishes no machine-readable taxonomy file, so it is read from the
// data itself (only the taxonomy columns are downloaded).
//
//   npm run overture:taxonomy [-- --release 2026-10-21.0]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { latestRelease } from "./overture-extract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--release");
const release = at >= 0 ? args[at + 1] : await latestRelease();
const bucket = `s3://overturemaps-us-west-2/release/${release}`;
const c = await (await DuckDBInstance.create(":memory:")).connect();
await c.run("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2';");

console.log(`Reading the places taxonomy from ${release} (taxonomy columns only)…`);
const cats = (
  await c.runAndReadAll(
    `SELECT taxonomy.primary AS id, any_value(taxonomy.hierarchy) AS hierarchy, mode(basic_category) AS basic, count(*)::INTEGER AS places
     FROM read_parquet('${bucket}/theme=places/type=place/*', hive_partitioning=1)
     WHERE taxonomy.primary IS NOT NULL GROUP BY 1 ORDER BY 1`,
  )
).getRowObjectsJson();
writeFileSync(
  `${root}lib/overture-taxonomy.json`,
  JSON.stringify({ release, source: "Overture Maps Foundation, Places theme taxonomy (read from the release data)", categories: cats.map((r) => [r.id, r.hierarchy ?? [], r.basic ?? "", r.places]) }) + "\n",
);
console.log(`lib/overture-taxonomy.json: ${cats.length} categories.`);

console.log("Reading country areas from Overture divisions…");
const countries = (
  await c.runAndReadAll(
    `SELECT country AS code, any_value(coalesce(names.common['en'], names.primary)) AS name,
       round(min(bbox.xmin), 3) AS w, round(min(bbox.ymin), 3) AS s, round(max(bbox.xmax), 3) AS e, round(max(bbox.ymax), 3) AS n
     FROM read_parquet('${bucket}/theme=divisions/type=division_area/*', hive_partitioning=1)
     WHERE subtype = 'country' AND class = 'land' AND country IS NOT NULL GROUP BY 1 ORDER BY 1`,
  )
).getRowObjectsJson();
writeFileSync(
  `${root}lib/countries.json`,
  JSON.stringify({ release, countries: countries.map((r) => [r.code, r.name, [r.w, r.s, r.e, r.n].map(Number)]) }) + "\n",
);
console.log(`lib/countries.json: ${countries.length} countries.`);
