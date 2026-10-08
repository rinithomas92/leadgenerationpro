import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = path.join(root, ".sites-runtime", "local-db.json");
mkdirSync(path.dirname(config), { recursive: true });
writeFileSync(
  config,
  JSON.stringify({
    name: "leadgenerationpro-local",
    compatibility_date: "2026-09-01",
    d1_databases: [
      {
        binding: "DB",
        database_name: "site-creator-d1",
        database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: path.join(root, "drizzle"),
      },
    ],
  }),
);
const result = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(path.join(root, "scripts/sites-env.mjs")).href,
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    config,
    "--persist-to",
    path.join(root, ".wrangler/state"),
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
