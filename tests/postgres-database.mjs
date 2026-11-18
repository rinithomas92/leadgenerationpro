import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { postgresDatabase, postgresPool } from "../lib/postgres-d1.ts";
export async function postgresTestDatabase(fn) {
  const schema = "leadgen_test_" + randomBytes(8).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.LEADGEN_TEST_SCHEMA = schema;
  const pool = postgresPool();
  await pool.query(readFileSync("deployment/postgres-schema.sql", "utf8").replaceAll("leadgen", schema));
  try { await fn(postgresDatabase); }
  finally { await pool.query(`DROP SCHEMA ${schema} CASCADE`); delete process.env.LEADGEN_TEST_SCHEMA; }
}
