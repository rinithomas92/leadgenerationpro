// Overture Maps Places queries over local country extracts (Parquet), using
// DuckDB. Coordinates come from each place's point bbox, so no spatial
// extension is needed. String inputs are always bound as parameters; numbers
// are validated by zod before they reach the SQL.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DuckDBInstance, listValue, type DuckDBConnection } from "@duckdb/node-api";
import { z } from "zod";
import { otherStateNames, pinRanges } from "../lib/india-pin.ts";

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
export const areaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("radius"), lat: num(-90, 90), lon: num(-180, 180), km: num(0.1, 500) }),
  z.object({ kind: z.literal("bbox"), w: num(-180, 180), s: num(-90, 90), e: num(-180, 180), n: num(-90, 90) }),
  // A first-level region or a whole country. Overture writes the region either
  // as an ISO 3166-2 suffix ("MH") or as a name ("Maharashtra"), so `names`
  // lists the other spellings. Places without a region fall back to the bbox.
  z.object({
    kind: z.literal("region"),
    region: z.string().regex(/^[A-Z0-9]{1,3}$/).optional(),
    names: z.array(z.string().trim().min(2).max(60)).max(4).default([]),
    bbox: z.object({ w: num(-180, 180), s: num(-90, 90), e: num(-180, 180), n: num(-90, 90) }).optional(),
  }),
]);
export type Area = z.infer<typeof areaSchema>;
const keyword = z.string().trim().min(1).max(80);
export const querySchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  categories: z.array(z.string().regex(/^[a-z0-9_]{1,80}$/)).min(1).max(400),
  include: z.array(keyword).max(30).default([]),
  // "widen" (default): a place matches by category OR by an include keyword in its name.
  // "narrow": it must match a category AND a keyword.
  keywords: z.enum(["widen", "narrow"]).default("widen"),
  exclude: z.array(keyword).max(30).default([]),
  area: areaSchema,
  // Nearer tiers, subtracted so every place belongs to exactly one tier.
  excludeAreas: z.array(areaSchema).max(5).default([]),
});
export const searchSchema = querySchema.extend({
  cursor: z.string().max(200).default(""),
  limit: z.number().int().min(1).max(1000).default(500),
});
export type Query = z.infer<typeof querySchema>;
export const lookupSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  ids: z.array(z.string().min(1).max(100)).min(1).max(2000),
});

// ---------- Extracts ----------
export type Manifest = {
  releases: Record<string, Record<string, { file: string; rows: number; extractedAt: string }>>;
};
export function readManifest(dataDir: string): Manifest {
  const file = path.join(dataDir, "manifest.json");
  if (!existsSync(file)) return { releases: {} };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return { releases: {} };
  }
}
/** The newest extract of a country, if one was downloaded. */
export function extractFor(dataDir: string, country: string) {
  const m = readManifest(dataDir);
  const release = Object.keys(m.releases)
    .filter((r) => m.releases[r][country])
    .sort()
    .at(-1);
  if (!release) return undefined;
  const e = m.releases[release][country];
  return { release, file: path.resolve(dataDir, e.file), rows: e.rows, extractedAt: e.extractedAt };
}
export function extracts(dataDir: string) {
  const m = readManifest(dataDir);
  const countries = new Set(Object.values(m.releases).flatMap((r) => Object.keys(r)));
  return [...countries].sort().map((c) => ({ country: c, ...extractFor(dataDir, c)! }));
}

// ---------- SQL ----------
const LAT = "bbox.ymin";
const LON = "bbox.xmin";
const box = (b: { w: number; s: number; e: number; n: number }) =>
  `(${LON} BETWEEN ${b.w} AND ${b.e} AND ${LAT} BETWEEN ${b.s} AND ${b.n})`;
export function areaSql(a: Area, param: (v: unknown) => string, country = "") {
  if (a.kind === "radius") {
    const dLat = a.km / 110.574;
    const dLon = a.km / (111.32 * Math.max(0.01, Math.cos((a.lat * Math.PI) / 180)));
    const hav =
      `2 * 6371.0088 * asin(sqrt(pow(sin(radians(${LAT} - ${a.lat}) / 2), 2) + ` +
      `cos(radians(${a.lat})) * cos(radians(${LAT})) * pow(sin(radians(${LON} - ${a.lon}) / 2), 2)))`;
    return `(${box({ w: a.lon - dLon, e: a.lon + dLon, s: a.lat - dLat, n: a.lat + dLat })} AND ${hav} <= ${a.km})`;
  }
  if (a.kind === "bbox") return box(a);
  if (!a.region) return "TRUE";
  // coalesce keeps places without a region from becoming NULL, which would
  // drop them from both this tier and the tier that excludes it.
  const values = [a.region, ...(a.names ?? [])].map((v) => v!.toLowerCase());
  const region = `coalesce(list_contains(${param(listValue(values))}, lower(addresses[1].region)), FALSE)`;
  // Places without a region: in India the PIN code's prefix decides the state;
  // only places with neither fall back to the (coarser) state bbox.
  // Some records carry stray whitespace around the PIN.
  const code = "trim(coalesce(addresses[1].postcode, ''))";
  const pin = `regexp_matches(${code}, '^[1-9][0-9]{5}$')`;
  const ranges = country === "IN" && a.region ? pinRanges(a.region) : [];
  const byPin = ranges.length
    ? `(addresses[1].region IS NULL AND ${pin} AND (${ranges.map(([lo, hi]) => `TRY_CAST(substr(${code}, 1, 3) AS INTEGER) BETWEEN ${lo} AND ${hi}`).join(" OR ")}))`
    : "FALSE";
  // With neither, an address naming another state or its capital is left out of the bbox.
  const others = ranges.length ? otherStateNames(a.region) : [];
  const notElsewhere = others.length
    ? `NOT regexp_matches(lower(coalesce(addresses[1].freeform, '') || ' ' || coalesce(addresses[1].locality, '')), ${param(`\\b(${others.join("|")})\\b`)}) AND `
    : "";
  const byBox = a.bbox ? `(addresses[1].region IS NULL AND ${ranges.length ? `NOT ${pin} AND ` : ""}${notElsewhere}${box(a.bbox)})` : "FALSE";
  return `(${region} OR ${byPin} OR ${byBox})`;
}
const escapeRe = (s: string) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const CHANNEL =
  "(len(coalesce(phones, [])) > 0 OR len(coalesce(emails, [])) > 0 OR len(coalesce(websites, [])) > 0 OR len(coalesce(socials, [])) > 0)";
export const OPEN = "coalesce(operating_status, 'open') <> 'permanently_closed'";

/** The shared WHERE clause and its bound parameters. */
export function whereSql(q: Query) {
  const params: Record<string, unknown> = {};
  let n = 0;
  const param = (v: unknown) => {
    const k = `p${n++}`;
    params[k] = v;
    return `$${k}`;
  };
  const cats = param(listValue(q.categories));
  const byCategory = `(taxonomy.primary IN (SELECT unnest(${cats})) OR list_has_any(coalesce(taxonomy.alternates, []), ${cats}) OR basic_category IN (SELECT unnest(${cats})))`;
  const byName = q.include.length ? `regexp_matches(lower(names.primary), ${param(q.include.map(escapeRe).join("|"))})` : "";
  const parts = [
    `addresses[1].country = ${param(q.country)}`,
    byName && q.keywords === "widen" ? `(${byCategory} OR ${byName})` : byCategory,
    areaSql(q.area, param, q.country),
    ...q.excludeAreas.map((a) => `NOT ${areaSql(a, param, q.country)}`),
  ];
  if (byName && q.keywords === "narrow") parts.push(byName);
  if (q.exclude.length) parts.push(`NOT regexp_matches(lower(coalesce(names.primary, '')), ${param(q.exclude.map(escapeRe).join("|"))})`);
  parts.push("names.primary IS NOT NULL");
  return { where: parts.join("\n  AND "), params, param };
}
const source = (file: string) => `read_parquet('${file.replace(/\\/g, "/").replace(/'/g, "''")}')`;

export function countSql(q: Query, file: string) {
  const { where, params } = whereSql(q);
  return {
    sql: `SELECT count(*)::INTEGER AS total,
  (count(*) FILTER (WHERE NOT ${OPEN}))::INTEGER AS closed,
  (count(*) FILTER (WHERE ${OPEN} AND NOT ${CHANNEL}))::INTEGER AS no_channel,
  (count(*) FILTER (WHERE ${OPEN} AND ${CHANNEL}))::INTEGER AS reachable
FROM ${source(file)}
WHERE ${where}`,
    params,
  };
}
const COLUMNS = `id, names.primary AS name, basic_category, taxonomy.primary AS category, taxonomy.alternates AS alternates,
  addresses[1].freeform AS address, addresses[1].locality AS locality, addresses[1].postcode AS postcode,
  addresses[1].region AS region, addresses[1].country AS country,
  ${LAT} AS lat, ${LON} AS lon, phones, emails, websites, socials, brand.names.primary AS brand,
  confidence, operating_status, list_transform(sources, s -> {'dataset': s.dataset, 'record_id': s.record_id, 'update_time': s.update_time, 'license': s.license}) AS sources`;
/** Records by GERS id, open or closed, for re-checking stale leads. */
export const lookupSql = (file: string) => `SELECT ${COLUMNS} FROM ${source(file)} WHERE list_contains($ids, id) ORDER BY id`;
export function searchSql(q: z.infer<typeof searchSchema>, file: string) {
  const { where, params, param } = whereSql(q);
  const cursor = q.cursor ? `AND id > ${param(q.cursor)}` : "";
  return {
    sql: `SELECT ${COLUMNS}
FROM ${source(file)}
WHERE ${where}
  AND ${OPEN} AND ${CHANNEL} ${cursor}
ORDER BY id
LIMIT ${q.limit}`,
    params,
  };
}

export type OvertureRow = {
  id: string;
  name: string;
  basic_category: string | null;
  category: string | null;
  alternates: string[] | null;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
  phones: string[] | null;
  emails: string[] | null;
  websites: string[] | null;
  socials: string[] | null;
  brand: string | null;
  confidence: number | null;
  operating_status: string | null;
  sources: { dataset: string | null; record_id: string | null; update_time: string | null; license: string | null }[] | null;
};

/** One shared DuckDB connection; queries are serialised. */
export class Overture {
  private conn?: Promise<DuckDBConnection>;
  private queue: Promise<unknown> = Promise.resolve();
  readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }
  private connection() {
    this.conn ??= DuckDBInstance.create(":memory:").then((db) => db.connect());
    return this.conn;
  }
  private run<T>(sql: string, params: Record<string, unknown>) {
    const job = this.queue.then(async () => {
      const c = await this.connection();
      const r = await c.runAndReadAll(sql, params as never);
      return r.getRowObjectsJson() as T[];
    });
    this.queue = job.catch(() => {});
    return job;
  }
  private file(country: string) {
    const e = extractFor(this.dataDir, country);
    if (!e || !existsSync(e.file))
      throw Object.assign(new Error(`No Overture extract for ${country}. Run: npm run overture:extract -- ${country}`), { status: 404 });
    return e;
  }
  async count(q: Query) {
    const e = this.file(q.country);
    const { sql, params } = countSql(q, e.file);
    const [r] = await this.run<{ total: number; closed: number; no_channel: number; reachable: number }>(sql, params);
    return { total: r.total, closed: r.closed, noChannel: r.no_channel, reachable: r.reachable, release: e.release };
  }
  /** Records by GERS id in the newest extract; ids missing from it are listed. */
  async lookup(q: z.infer<typeof lookupSchema>) {
    const e = this.file(q.country);
    const rows = await this.run<OvertureRow>(lookupSql(e.file), { ids: listValue(q.ids) });
    const found = new Set(rows.map((r) => r.id));
    return { rows, missing: q.ids.filter((id) => !found.has(id)), release: e.release };
  }
  async search(q: z.infer<typeof searchSchema>) {
    const e = this.file(q.country);
    const { sql, params } = searchSql(q, e.file);
    const rows = await this.run<OvertureRow>(sql, params);
    return { rows, nextCursor: rows.length === q.limit ? rows[rows.length - 1].id : "", release: e.release };
  }
}
