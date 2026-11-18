import { DatabaseSync } from "node:sqlite";
import { postgresPool } from "../lib/postgres-d1.ts";
const source = process.argv[2];
if (!source) throw new Error("Provide the local D1 SQLite path.");
const sqlite = new DatabaseSync(source, { readOnly: true });
const pool = postgresPool(), client = await pool.connect();
try {
  sqlite.exec("BEGIN");
  await client.query("BEGIN");
  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='leadgen' AND table_name<>'login_attempts'")).rows;
  let migrated = 0;
  for (const { table_name: table } of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
    const rows = sqlite.prepare(`SELECT ${columns.map(c => `"${c}"`).join(",")} FROM "${table}"`).all();
    for (const row of rows) if (row.owner === "local_seedy") row.owner = "leadgen-owner";
    const names = columns.map(c => `"${c}"`).join(",");
    for (let i = 0; i < rows.length; i += 250) {
      const result = await client.query(`INSERT INTO leadgen."${table}" (${names}) SELECT ${names} FROM json_populate_recordset(NULL::leadgen."${table}",$1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 250))]);
      migrated += result.rowCount;
    }
    console.log(`${table}: ${rows.length} source rows`);
  }
  await client.query("COMMIT");
  console.log(`Migration complete: ${migrated} rows added. Local data retained.`);
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { sqlite.close(); client.release(); await pool.end(); }
