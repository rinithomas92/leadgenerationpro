// Exercises the compiled Worker against an isolated, in-memory D1 database.
// No local workspace records or external AI services are used.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";
import {
  emptyWorkspace,
  newCampaign,
  suggestMarkets,
  demoLeads,
} from "../lib/leadgen.ts";

const worker = new Miniflare({
  modules: [
    "index.js",
    ...readdirSync("dist/server", { recursive: true }).filter(
      (file) => file.endsWith(".js") && file !== "index.js",
    ),
  ].map((file) => ({
    type: "ESModule",
    path: path.resolve("dist/server", file),
  })),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
});
const origin = "http://localhost";
const headers = {
  "oai-authenticated-user-id": "integration-test",
  "oai-authenticated-user-email": "qa@example.test",
  Origin: origin,
  "Content-Type": "application/json",
};
const call = (route, options = {}) =>
  worker.dispatchFetch(origin + route, { headers, ...options });
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
try {
  const db = await worker.getD1Database("DB");
  await db.exec(
    readFileSync("drizzle/0000_needy_spyke.sql", "utf8").replace(/\r?\n/g, " "),
  );
  check((await worker.dispatchFetch(origin + "/api/workspace")).status, 401);
  const initial = await (await call("/api/workspace")).json();
  check(initial.state, emptyWorkspace());
  const campaign = newCampaign(2);
  campaign.markets = suggestMarkets(campaign.description, campaign.location, 2);
  const lead = { ...demoLeads(campaign)[0], demo: false };
  const state = { ...initial.state, campaigns: [campaign], leads: [lead] };
  const saved = await call("/api/workspace", {
    method: "PUT",
    body: JSON.stringify({ state, revision: initial.revision }),
  });
  check(saved.status, 200);
  const snapshot = await saved.json();
  check((await (await call("/api/workspace")).json()).state, state);
  check(
    (
      await call("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ state, revision: initial.revision }),
      })
    ).status,
    409,
  );
  check(
    (await call("/api/workspace", { method: "PUT", body: "{invalid" })).status,
    400,
  );
  check(
    (
      await call("/api/workspace", {
        method: "PUT",
        headers: { ...headers, Origin: "https://untrusted.example" },
        body: JSON.stringify({ state, revision: snapshot.revision }),
      })
    ).status,
    403,
  );
  check(
    (
      await call("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({
          state: { ...state, campaigns: [] },
          revision: snapshot.revision,
        }),
      })
    ).status,
    400,
  );
  check((await (await call("/api/generate")).json()).ai, false);
  const marketResponse = await call("/api/generate", {
    method: "POST",
    body: JSON.stringify({ kind: "markets", campaign }),
  });
  check(marketResponse.status, 200);
  check((await marketResponse.json()).mode, "starter");
  const draftResponse = await call("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      kind: "draft",
      campaign,
      lead,
      channel: "Email",
      tone: "Warm",
      sender: "QA",
    }),
  });
  check(draftResponse.status, 200);
  const draft = await draftResponse.json();
  check(draft.mode, "template");
  assert.ok(draft.body.includes("QA"));
  checks++;
  check(
    (await call("/api/generate", { method: "POST", body: "bad json" })).status,
    400,
  );
  check(
    (await call("/api/discover", { method: "POST", body: "bad json" })).status,
    400,
  );
  const other = await call("/api/workspace", {
    headers: { ...headers, "oai-authenticated-user-id": "other-user" },
  });
  check((await other.json()).state.leads, []);
  console.log(`Worker integration: ${checks} checks passed (isolated D1).`);
} finally {
  await worker.dispose();
}
