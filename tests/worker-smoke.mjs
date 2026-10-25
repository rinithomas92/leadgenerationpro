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
  stateSchema,
} from "../lib/leadgen.ts";
import { glossMarkets, newCreatorLead } from "../lib/gloss.ts";
import { newCustomCampaign, projectLead } from "../lib/project.ts";

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
  // Apply every migration in order, statement by statement.
  for (const file of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort())
    for (const sql of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint"))
      if (sql.trim()) await db.exec(sql.replace(/\r?\n/g, " ").trim());
  // Saves send the workspace document plus only the changed leads.
  const put = (state, revision, upsert = state.leads, remove = [], extra = {}) =>
    call("/api/workspace", {
      method: "PUT",
      ...extra,
      body: JSON.stringify({ state: { ...state, leads: [] }, revision, leads: { upsert, remove } }),
    });
  check((await worker.dispatchFetch(origin + "/api/workspace")).status, 401);
  const initial = await (await call("/api/workspace")).json();
  check(initial.state, emptyWorkspace());
  const campaign = newCampaign(2);
  campaign.markets = suggestMarkets(campaign.description, campaign.location, 2);
  const lead = { ...demoLeads(campaign)[0], demo: false };
  const state = { ...initial.state, campaigns: [campaign], leads: [lead] };
  const saved = await put(state, initial.revision);
  check(saved.status, 200);
  const snapshot = await saved.json();
  check(
    (await (await call("/api/workspace")).json()).state,
    stateSchema.parse(state),
  );
  check((await put(state, initial.revision)).status, 409);
  // A rejected (stale) save must not have written its lead changes.
  check((await (await call("/api/workspace")).json()).state.leads.length, 1);
  check(
    (await call("/api/workspace", { method: "PUT", body: "{invalid" })).status,
    400,
  );
  check(
    (await put(state, snapshot.revision, [], [], { headers: { ...headers, Origin: "https://untrusted.example" } })).status,
    403,
  );
  check((await put({ ...state, campaigns: [] }, snapshot.revision, [])).status, 400);
  // Many leads in one campaign: stored as rows, saved in chunks, nothing capped.
  const many = Array.from({ length: 2500 }, (_, i) => ({
    ...lead,
    id: `bulk-${i}`,
    name: `Outlet ${i}`,
    source: `https://www.openstreetmap.org/node/${i + 1}`,
    history: [{ at: "2026-10-09", event: "Discovered" }],
  }));
  const bulkSaved = await put({ ...state, leads: [lead, ...many] }, snapshot.revision, many);
  check(bulkSaved.status, 200);
  const bulk = await bulkSaved.json();
  check((await (await call("/api/workspace")).json()).state.leads.length, 2501);
  // Removing leads deletes only those rows.
  const trimmed = await put({ ...state, leads: [lead, ...many.slice(0, 2000)] }, bulk.revision, [], many.slice(2000).map((l) => l.id));
  const afterBulk = (await trimmed.json()).revision;
  check(trimmed.status, 200);
  check((await (await call("/api/workspace")).json()).state.leads.length, 2001);
  // Each campaign downloads as a complete Excel workbook.
  const workbook = await call(`/api/export?campaign=${encodeURIComponent(campaign.id)}`);
  check([workbook.status, workbook.headers.get("content-type")], [200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
  const xlsxText = new TextDecoder().decode(await workbook.arrayBuffer());
  assert.ok(xlsxText.includes("Outlet 1999") && xlsxText.includes('name="Discovery report"'));
  checks++;
  check((await call("/api/export?campaign=missing")).status, 404);
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
  // Gloss creator workflow: separate campaign, creator lead, draft-only outreach.
  const creatorCampaign = newCampaign(0, "", "Creator Partners");
  creatorCampaign.markets = glossMarkets(creatorCampaign);
  const creator = newCreatorLead(creatorCampaign, {
    name: "Priya Kulkarni",
    location: "Pune",
    website: "",
    email: "",
    phone: "",
    source: "",
    notes: "",
    tags: "",
    creator: { profession: "Makeup Artist", instagram: "@priya.mua", followers: 12500 },
  });
  const glossState = {
    ...state,
    campaigns: [...state.campaigns, creatorCampaign],
    leads: [...state.leads, creator],
  };
  const glossSaved = await put(glossState, afterBulk, [creator]);
  check(glossSaved.status, 200);
  const glossSnapshot = await glossSaved.json();
  const reloaded = (await (await call("/api/workspace")).json()).state;
  check(reloaded.leads.at(-1).creator.instagram, "priya.mua");
  check(reloaded.campaigns.at(-1).audience, "Creator Partners");
  check((await put(glossState, glossSnapshot.revision, [{ ...creator, campaignId: campaign.id }])).status, 400);
  // Discovery API: malformed requests are rejected; steps that need no
  // network return real snapshot records.
  check(
    (
      await call("/api/discover", {
        method: "POST",
        body: JSON.stringify({ campaign: creatorCampaign }),
      })
    ).status,
    400,
  );
  const geo = { input: "Pune", city: { name: "Pune", areaId: 3601986140, wikidata: "Q1538", lat: 18.52, lon: 73.85 } };
  const hotels = { ...newCampaign(2), location: "Pune" };
  hotels.markets = [{ name: "Boutique hotels", reason: "", needs: "", positioning: "", search: "", score: 50 }];
  const research = await (
    await call("/api/discover", {
      method: "POST",
      body: JSON.stringify({ action: "step", campaign: hotels, geo, step: { source: "research", scope: "city" } }),
    })
  ).json();
  check([research.report.status, research.leads.length > 0, research.leads[0].checkedAt], ["ok", true, "2026-09-14"]);
  // No source requires an API key; YouTube is not a discovery source.
  check(
    (
      await call("/api/discover", {
        method: "POST",
        body: JSON.stringify({ action: "step", campaign: creatorCampaign, geo, step: { source: "youtube", scope: "city" } }),
      })
    ).status,
    400,
  );
  const dm = await (
    await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        kind: "draft",
        campaign: creatorCampaign,
        lead: creator,
        channel: "Instagram DM",
        tone: "Warm",
        sender: "QA",
      }),
    })
  ).json();
  check([dm.mode, dm.subject], ["template", ""]);
  assert.match(dm.body, /Gloss/);
  assert.doesNotMatch(dm.body, /guarantee|₹/i);
  checks++;
  const glossMarketResponse = await (
    await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "markets", campaign: creatorCampaign }),
    })
  ).json();
  check(
    glossMarketResponse.markets.map((m) => m.name),
    glossMarkets(creatorCampaign).map((m) => m.name),
  );
  // A workspace stored before the Gloss fields existed loads with defaults.
  const legacyCampaign = { ...campaign };
  delete legacyCampaign.audience;
  const legacyLead = { ...lead };
  delete legacyLead.kind;
  await db
    .prepare("INSERT INTO workspaces (owner, data, revision) VALUES (?, ?, 7)")
    .bind(
      "legacy-user",
      JSON.stringify({
        ...emptyWorkspace(),
        campaigns: [legacyCampaign],
        leads: [legacyLead],
      }),
    )
    .run();
  const legacy = await (
    await call("/api/workspace", {
      headers: { ...headers, "oai-authenticated-user-id": "legacy-user" },
    })
  ).json();
  // Embedded leads are moved into the leads table on first load.
  check(
    [legacy.revision, legacy.state.leads[0].kind, legacy.state.campaigns[0].audience, legacy.state.leads[0].name],
    [8, "business", "General", lead.name],
  );
  const legacyRows = await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE owner = 'legacy-user'").first();
  const legacyDoc = JSON.parse((await db.prepare("SELECT data FROM workspaces WHERE owner = 'legacy-user'").first()).data);
  check([legacyRows.n, legacyDoc.leads.length], [1, 0]);
  const other = await call("/api/workspace", {
    headers: { ...headers, "oai-authenticated-user-id": "other-user" },
  });
  check((await other.json()).state.leads, []);

  // ---------- Custom lead projects: the Given ledger ----------
  const projectUser = { ...headers, "oai-authenticated-user-id": "project-user" };
  const pcall = (route, options = {}) => worker.dispatchFetch(origin + route, { headers: projectUser, ...options });
  const pput = (state, revision, leads = {}) =>
    pcall("/api/workspace", {
      method: "PUT",
      body: JSON.stringify({ state: { ...state, leads: [] }, revision, leads: { upsert: [], remove: [], ...leads } }),
    });
  const ledger = (body) => pcall("/api/projects", { method: "POST", body: JSON.stringify(body) });
  const pstart = await (await pcall("/api/workspace")).json();
  const custom = newCustomCampaign({
    name: "Interior studio",
    description: "Interior design studio in Baner, Pune.",
    location: "Baner, Pune",
    project: { segments: [{ id: "arch", label: "Architects", categories: ["architect"] }, { id: "dev", label: "Developers", categories: ["real_estate_developer"] }], tiers: ["locality", "city", "state"] },
  });
  const poolLeads = ["locality", "city", "state"].flatMap((tier) =>
    Array.from({ length: 80 }, (_, i) =>
      projectLead(custom, { name: `${tier} studio ${i}`, segmentId: i % 2 ? "arch" : "dev", tier, source: { name: "Overture Maps", id: `ov:${tier}-${i}`, url: "" }, phone: `+91 98${String(10000000 + i).slice(-8)}` }),
    ),
  );
  const pstate = { ...pstart.state, campaigns: [custom], leads: poolLeads };
  const psaved = await pput(pstate, pstart.revision, { upsert: poolLeads });
  check(psaved.status, 200);
  let rev = (await psaved.json()).revision;
  // Lead project details cannot be attached to a non-project campaign.
  check((await pput({ ...pstate, campaigns: [{ ...custom, custom: undefined }] }, rev, { upsert: [poolLeads[0]] })).status, 400);
  // The virtual columns read the lead JSON; Gloss rows read NULL.
  check((await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE owner = 'project-user' AND delivery_status = 'available' AND tier = 'city'").first()).n, 80);
  check((await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE owner = 'integration-test' AND delivery_status IS NOT NULL").first()).n, 0);
  check((await ledger({ action: "deliver", campaignId: custom.id, size: 300, revision: rev })).status, 400);
  const given = new Set();
  const batches = [];
  for (let seq = 1; seq <= 3; seq++) {
    const r = await ledger({ action: "deliver", campaignId: custom.id, size: 50, revision: rev });
    check(r.status, 200);
    const d = await r.json();
    check([d.delivery.seq, d.ids.length, d.delivery.actual.tiers], [seq, 50, { locality: 25, city: 15, state: 10 }]);
    for (const id of d.ids) {
      assert.ok(!given.has(id), "never re-delivered");
      given.add(id);
    }
    batches.push(d.delivery);
    rev = d.revision;
  }
  check((await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE owner = 'project-user' AND delivery_status = 'given'").first()).n, 150);
  // A stale tab cannot deliver: nothing is written.
  check((await ledger({ action: "deliver", campaignId: custom.id, size: 50, revision: rev - 1 })).status, 409);
  check((await db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE owner = 'project-user'").first()).n, 3);
  // A save (for example re-discovery) carrying an old "available" copy never resets Given.
  const givenId = [...given][0];
  const stale = poolLeads.find((l) => l.id === givenId);
  const resaved = await pput(pstate, rev, { upsert: [{ ...stale, notes: "edited" }] });
  check(resaved.status, 200);
  rev = (await resaved.json()).revision;
  const row = JSON.parse((await db.prepare("SELECT data FROM leads WHERE owner = 'project-user' AND id = ?").bind(givenId).first()).data);
  check([row.notes, row.project.delivery.status], ["edited", "given"]);
  // Only the latest batch can be undone.
  check((await ledger({ action: "undo", campaignId: custom.id, deliveryId: batches[0].id, revision: rev })).status, 409);
  const undone = await ledger({ action: "undo", campaignId: custom.id, deliveryId: batches[2].id, revision: rev });
  check(undone.status, 200);
  rev = (await undone.json()).revision;
  check((await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE owner = 'project-user' AND delivery_status = 'given'").first()).n, 100);
  const extras = await (await pcall("/api/projects")).json();
  check(extras.deliveries.map((d) => d.seq), [1, 2]);
  // Contact events are written in the same save as the lead change.
  const event = { id: "e1", campaignId: custom.id, leadId: givenId, channel: "WhatsApp", templateId: "t1", templateVersion: 2, direction: "outbound", note: "", createdAt: "2026-10-23T10:00:00Z" };
  const sent = await pput(pstate, rev, { events: { insert: [event] } });
  check(sent.status, 200);
  rev = (await sent.json()).revision;
  check((await pput(pstate, rev, { events: { insert: [{ ...event, id: "e2", leadId: "missing" }] } })).status, 400);
  // Do-not-contact list: CSV import, and suppressed leads are not delivered.
  const imported = await (await ledger({ action: "suppress", csv: "value\n+91 9810000001\nrival.in\n" })).json();
  check([imported.added, imported.suppression.map((s) => s.kind).sort()], [2, ["domain", "phone"]]);
  const after = await (await pcall("/api/projects")).json();
  check([after.events.length, after.events[0].templateVersion, after.suppression.length], [1, 2, 2]);
  // Each batch and the whole project download as Excel workbooks.
  const batchBook = await pcall(`/api/project-export?campaign=${custom.id}&delivery=${batches[0].id}`);
  check([batchBook.status, batchBook.headers.get("content-disposition")], [200, `attachment; filename="interior-studio-batch-1-${batches[0].createdAt.slice(0, 10)}.xlsx"`]);
  const batchText = new TextDecoder().decode(await batchBook.arrayBuffer());
  assert.ok(batchText.includes('name="Summary"') && batchText.includes('name="Locality"') && batchText.includes('name="All leads"'));
  checks++;
  const masterBook = await pcall(`/api/project-export?campaign=${custom.id}`);
  check(masterBook.status, 200);
  assert.ok(new TextDecoder().decode(await masterBook.arrayBuffer()).includes('name="Outcomes"'));
  checks++;
  check((await pcall(`/api/project-export?campaign=${custom.id}&delivery=missing`)).status, 404);
  check((await pcall(`/api/project-export?campaign=${campaign.id}`)).status, 404);
  // Project discovery validates its input and never accepts raw query text.
  check((await pcall("/api/project-discover", { method: "POST", body: JSON.stringify({ action: "osm", query: "[out:json];node;out;" }) })).status, 400);
  check((await pcall("/api/project-discover", { method: "POST", body: "{bad" })).status, 400);
  console.log(`Worker integration: ${checks} checks passed (isolated D1).`);
} finally {
  await worker.dispose();
}
