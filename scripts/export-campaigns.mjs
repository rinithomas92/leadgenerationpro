// Writes one Excel workbook per campaign from the local development database
// into ./exports, using the same generator as the in-app download.
// Usage: node --experimental-strip-types scripts/export-campaigns.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateSchema } from "../lib/leadgen.ts";
import { campaignWorkbook } from "../lib/campaign-export.ts";

const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (!file) throw new Error("No local database found. Run npm run db:migrate and use the app first.");
const db = new DatabaseSync(path.join(dir, file), { readOnly: true });
mkdirSync("exports", { recursive: true });
for (const { owner, data } of db.prepare("SELECT owner, data FROM workspaces").all()) {
  const doc = stateSchema.parse({ ...JSON.parse(data), leads: [] });
  for (const campaign of doc.campaigns) {
    const leads = db
      .prepare("SELECT data FROM leads WHERE owner = ? AND campaign_id = ? ORDER BY rowid")
      .all(owner, campaign.id)
      .map((r) => JSON.parse(r.data));
    const { body, filename } = campaignWorkbook(campaign, leads);
    writeFileSync(path.join("exports", filename), body);
    console.log(`${filename}: ${leads.length} leads`);
  }
}
