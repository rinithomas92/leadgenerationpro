import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  newCampaign,
  demoLeads,
  suggestMarkets,
  deduplicate,
  parseCSV,
  toCSV,
  getFollowUps,
  updateStage,
  stateSchema,
} from "../lib/leadgen.ts";

function fixture() {
  const campaign = newCampaign(2);
  campaign.markets = suggestMarkets(campaign.description, campaign.location, 2);
  const lead = { ...demoLeads(campaign)[0], demo: false };
  return {
    campaign,
    lead,
    state: { ...emptyWorkspace(), campaigns: [campaign], leads: [lead] },
  };
}

test("duplicate businesses are skipped within a campaign, but can belong to another campaign", () => {
  const { lead } = fixture();
  assert.equal(deduplicate([lead], [{ ...lead, id: "other" }]).length, 0);
  assert.equal(
    deduplicate([lead], [{ ...lead, id: "other", campaignId: "another" }])
      .length,
    1,
  );
  assert.equal(deduplicate([], [lead, { ...lead, id: "other" }]).length, 1);
});

test("CSV handles BOM, multiline fields, escaped quotes and rejects broken rows", () => {
  assert.deepEqual(
    parseCSV('\uFEFFname,notes\r\n"A, B","line 1\n""quoted"""'),
    [{ name: "A, B", notes: 'line 1\n"quoted"' }],
  );
  assert.throws(() => parseCSV("name,name\na,b"), /unique/);
  assert.throws(() => parseCSV("name,website\na"), /columns/);
  assert.throws(() => parseCSV('name\n"unclosed'), /quote/);
});

test("CSV export neutralizes formulas and preserves quoted business names", () => {
  const { lead } = fixture();
  const exported = toCSV([{ ...lead, name: "=SUM(1,2)", phone: "+123" }]);
  const [row] = parseCSV(exported);
  assert.equal(row.name, "'=SUM(1,2)");
  assert.equal(row.phone, "'+123");
});

test("follow-ups include draft reminders and exclude sample, converted and lost leads", () => {
  const { state, lead } = fixture();
  state.leads[0] = { ...lead, followUp: "2026-10-08" };
  state.drafts = [
    {
      id: "draft",
      leadId: lead.id,
      channel: "Email",
      tone: "Warm",
      subject: "Hello",
      body: "Message",
      createdAt: "2026-10-08",
      scheduledFor: "2026-10-09",
    },
  ];
  const reminders = getFollowUps(state, "2026-10-08");
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].due, true);
  assert.equal(reminders[1].due, false);
  state.leads[0].stage = "Converted";
  assert.deepEqual(getFollowUps(state), []);
  state.leads[0].stage = "New";
  state.leads[0].demo = true;
  assert.deepEqual(getFollowUps(state), []);
});

test("moving stages preserves first contact time and bounds history", () => {
  const { lead } = fixture();
  const contacted = updateStage(lead, "Contacted");
  assert.ok(contacted.contactedAt);
  assert.equal(
    updateStage(contacted, "Interested").contactedAt,
    contacted.contactedAt,
  );
  assert.equal(updateStage(contacted, "Contacted"), contacted);
  assert.equal(
    updateStage(
      {
        ...lead,
        history: Array(500).fill({ at: "2026-10-08", event: "Saved" }),
      },
      "Replied",
    ).history.length,
    500,
  );
});

test("workspace validation rejects blank campaign names and excessive markets", () => {
  const { state } = fixture();
  assert.equal(stateSchema.safeParse(state).success, true);
  state.campaigns[0].name = "   ";
  assert.equal(stateSchema.safeParse(state).success, false);
  state.campaigns[0].name = "Campaign";
  state.campaigns[0].markets = Array(21).fill(state.campaigns[0].markets[0]);
  assert.equal(stateSchema.safeParse(state).success, false);
});
