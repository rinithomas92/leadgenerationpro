import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

pg.types.setTypeParser(20, Number);
let pool: pg.Pool | undefined;
export function postgresPool() {
  if (!process.env.LEADGEN_DATABASE_URL) throw new Error("Database connection is not configured.");
  return pool ??= new pg.Pool({ connectionString: process.env.LEADGEN_DATABASE_URL,
    ssl: { ca: readFileSync(path.join(process.cwd(), "certs/supabase-ca.crt"), "utf8"), rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
}

// Keep the existing store's bound parameters and atomic batches while moving
// its small SQLite dialect to PostgreSQL. Values are never interpolated in SQL.
export function postgresSQL(source: string) {
  let next = 0;
  let sql = source.replace(/--[^\n]*|('(?:''|[^'])*')|\?(\d*)/g, (match, quoted, index) => {
    if (quoted || match.startsWith("--")) return match;
    const position = index ? Number(index) : next + 1;
    next = Math.max(next, position);
    return `$${position}`;
  });
  sql = sql.replace(/\bWHERE 1\b/g, "WHERE TRUE");
  sql = sql.replace(/\bjson\(/g, "jsonb(");
  sql = sql.replace(/json_extract\(value, '\$\.templateVersion'\)/g, "(json_extract(value, '$.templateVersion'))::integer");
  if (/INSERT OR IGNORE/i.test(sql)) {
    sql = sql.replace(/INSERT OR IGNORE/i, "INSERT");
    const returning = sql.search(/\bRETURNING\b/i);
    sql = returning < 0 ? sql + " ON CONFLICT DO NOTHING" : sql.slice(0, returning) + " ON CONFLICT DO NOTHING " + sql.slice(returning);
  }
  return sql;
}

class Statement {
  readonly sql: string;
  readonly values: unknown[];
  constructor(sql: string, values: unknown[] = []) { this.sql = sql; this.values = values; }
  bind(...values: unknown[]) { return new Statement(this.sql, values); }
  async all<T>() { return (await execute([this]))[0] as { results: T[]; success: boolean; meta: { changes: number } }; }
  async run() { return (await execute([this]))[0]; }
  async first<T>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    return (row ? column ? row[column] : row : null) as T | null;
  }
}
async function execute(statements: Statement[]) {
  const client = await postgresPool().connect();
  try {
    await client.query("BEGIN");
    const schema = process.env.NODE_ENV === "test" && /^leadgen_test_[a-f0-9]+$/.test(process.env.LEADGEN_TEST_SCHEMA || "") ? process.env.LEADGEN_TEST_SCHEMA! : "leadgen";
    await client.query(`SET LOCAL search_path = ${schema}, pg_catalog`);
    await client.query("SET LOCAL statement_timeout = '30s'");
    const results = [];
    for (const statement of statements) {
      const result = await client.query(postgresSQL(statement.sql), statement.values);
      results.push({ results: result.rows, success: true, meta: { changes: result.command === "SELECT" ? 0 : result.rowCount ?? 0 } });
    }
    await client.query("COMMIT");
    return results;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export const postgresDatabase = {
  prepare: (sql: string) => new Statement(sql),
  batch: (statements: Statement[]) => execute(statements),
} as unknown as D1Database;
