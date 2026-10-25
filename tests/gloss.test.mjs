import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  newCampaign,
  suggestMarkets,
  demoLeads,
  deduplicate,
  parseCSV,
  toCSV,
  templateDraft,
  stateSchema,
  normalizeHandle,
  channels,
} from "../lib/leadgen.ts";
import {
  assessCreatorFit,
  creatorCSV,
  creatorFromRecord,
  creatorRows,
  exportColumns,
  glossMarkets,
  glossWorkspaceError,
  newCreatorLead,
  outreachDraft,
  parseFollowers,
  profileUrl,
  safeSpreadsheetText,
  searchLinks,
  stageLabel,
} from "../lib/gloss.ts";
import { buildDirectoryQuery } from "../lib/discovery.ts";
import { xlsx } from "../lib/xlsx.ts";

const creatorCampaign = () => {
  const c = newCampaign(0, "", "Creator Partners");
  c.markets = glossMarkets(c);
  return c;
};
const prospectCampaign = () => {
  const c = newCampaign(0, "", "Professional Prospects");
  c.markets = glossMarkets(c);
  return c;
};
const input = (overrides = {}) => ({
  name: "Priya Kulkarni",
  location: "Pune · Baner",
  website: "",
  email: "",
  phone: "",
  source: "",
  notes: "",
  tags: "",
  ...overrides,
  creator: {
    profession: "Makeup Artist",
    instagram: "@Priya.MUA",
    followers: 12500,
    ...(overrides.creator || {}),
  },
});

test("workspaces saved before the Gloss changes still validate and gain safe defaults", () => {
  const campaign = newCampaign(2);
  campaign.markets = suggestMarkets(campaign.description, campaign.location, 2);
  const legacyCampaign = { ...campaign };
  delete legacyCampaign.audience;
  const legacyLead = { ...demoLeads(campaign)[0] };
  delete legacyLead.kind;
  const legacy = {
    ...emptyWorkspace(),
    campaigns: [legacyCampaign],
    leads: [legacyLead],
    drafts: [{ id: "d", leadId: legacyLead.id, channel: "Email", tone: "Warm", subject: "", body: "Hi", createdAt: "", scheduledFor: "" }],
  };
  const parsed = stateSchema.parse(legacy);
  assert.equal(parsed.campaigns[0].audience, "General");
  assert.equal(parsed.campaigns[0].gloss, undefined);
  assert.equal(parsed.leads[0].kind, "business");
  assert.equal(parsed.leads[0].creator, undefined);
  assert.equal(parsed.leads[0].name, legacyLead.name);
  assert.equal(glossWorkspaceError(parsed), "");
});

test("Instagram handles and platform URLs are normalized and restricted to their own domains", () => {
  assert.equal(normalizeHandle("@Priya.MUA"), "priya.mua");
  assert.equal(normalizeHandle("https://www.instagram.com/priya.mua/?hl=en"), "priya.mua");
  assert.equal(normalizeHandle("https://example.com/priya"), "");
  assert.equal(normalizeHandle("bad handle!"), "");
  assert.equal(normalizeHandle("a..b"), "");
  assert.equal(profileUrl("Instagram", "https://instagram.evil.com/x"), "");
  assert.equal(profileUrl("YouTube", "https://youtu.be/abc"), "https://youtu.be/abc");
  assert.equal(profileUrl("TikTok", "javascript:alert(1)"), "");
  assert.equal(profileUrl("Website", "http://plain.example"), "http://plain.example/", "plain-http websites are valid channels");
  assert.equal(profileUrl("Instagram", "http://www.instagram.com/x/"), "", "platform links must be https on the platform's domain");
  assert.equal(parseFollowers("12.5K"), 12500);
  assert.equal(parseFollowers("1.2M"), 1200000);
  assert.equal(parseFollowers("12,500"), 12500);
  assert.equal(parseFollowers(""), null);
  assert.equal(parseFollowers("lots"), undefined);
});

test("manually added creators derive a profile link, keep a source and refuse unverifiable profiles", () => {
  const c = creatorCampaign();
  const lead = newCreatorLead(c, input());
  assert.equal(lead.kind, "creator");
  assert.equal(lead.creator.instagram, "priya.mua");
  assert.equal(lead.creator.instagramUrl, "https://www.instagram.com/priya.mua/");
  assert.equal(lead.source, "https://www.instagram.com/priya.mua/");
  assert.equal(lead.creator.partnership, "Creator Partner");
  assert.throws(() => newCreatorLead(c, input({ creator: { instagram: "" } })), /public profile/);
  assert.throws(
    () => newCreatorLead(c, input({ creator: { instagramUrl: "https://www.instagram.com/someone.else/" } })),
    /different profiles/,
  );
  assert.throws(() => newCreatorLead(c, input({ creator: { partnership: "Starter Prospect" } })), /Professional Prospects/);
  assert.throws(() => newCreatorLead(newCampaign(0), input()), /Gloss/);
});

test("creators are deduplicated by handle or profile URL, not by shared names", () => {
  const c = creatorCampaign();
  const a = newCreatorLead(c, input());
  const sameProfile = newCreatorLead(c, input({ name: "Priya K", creator: { instagram: "https://instagram.com/priya.mua" } }));
  const namesake = newCreatorLead(c, input({ creator: { instagram: "@another.priya" } }));
  assert.equal(deduplicate([a], [sameProfile]).length, 0);
  assert.equal(deduplicate([a], [namesake]).length, 1);
  assert.equal(deduplicate([a], [{ ...sameProfile, campaignId: "other" }]).length, 1);
});

test("creator fit is transparent, bounded and not presented as a probability", () => {
  const c = creatorCampaign();
  c.gloss.followerMin = 5000;
  c.gloss.followerMax = 50000;
  const full = newCreatorLead(c, input({ email: "priya@example.com", source: "https://www.instagram.com/priya.mua/", creator: { engagement: "3%" } }));
  const verified = { ...full, creator: { ...full.creator, verifiedAt: "2026-10-09" } };
  const fit = assessCreatorFit(verified, c);
  assert.equal(fit.score, 100);
  assert.match(fit.reason, /not a conversion probability/);
  const outOfRange = assessCreatorFit({ ...verified, creator: { ...verified.creator, followers: 900000 } }, c);
  assert.equal(outOfRange.score, 90);
  const elsewhere = assessCreatorFit({ ...verified, location: "Mumbai", creator: { ...verified.creator, profession: "Tattoo artist" } }, c);
  assert.equal(elsewhere.score, 100 - 25 - 20);
});

test("creator CSV import accepts the Excel export headers and reports row errors", () => {
  const c = creatorCampaign();
  const exported = creatorCSV([newCreatorLead(c, input({ creator: { tiktokUrl: "https://www.tiktok.com/@priya" } }))]);
  const [row] = parseCSV(exported);
  const reimported = creatorFromRecord(row, c, 2);
  assert.equal(reimported.creator.instagram, "priya.mua");
  assert.equal(reimported.creator.tiktokUrl, "https://www.tiktok.com/@priya");
  assert.equal(reimported.creator.followers, 12500);
  assert.throws(() => creatorFromRecord({ name: "A", instagram_handle: "@a", followers: "many" }, c, 3), /Row 3: Followers/);
  assert.throws(() => creatorFromRecord({ name: "B" }, c, 4), /Row 4: .*public profile/);
  const prospect = creatorFromRecord({ name: "C", instagram_handle: "@c.hair", profession: "Hairstylist" }, prospectCampaign(), 5);
  assert.equal(prospect.creator.partnership, "Starter Prospect");
});

test("exports neutralize formulas but keep plain @handles", () => {
  assert.equal(safeSpreadsheetText("@priya.mua"), "@priya.mua");
  assert.equal(safeSpreadsheetText("@SUM(1,2)"), "'@SUM(1,2)");
  assert.equal(safeSpreadsheetText("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(safeSpreadsheetText(" =1+1"), "' =1+1");
  assert.equal(safeSpreadsheetText("+91 98200 00000"), "+91 98200 00000", "plain phone numbers stay readable");
  assert.equal(safeSpreadsheetText("+1+cmd|' /C calc'!A0"), "'+1+cmd|' /C calc'!A0");
  assert.equal(safeSpreadsheetText("-1-1"), "'-1-1", "short arithmetic is still neutralised");
  const c = creatorCampaign();
  const lead = newCreatorLead(c, input({ name: "=cmd|' /C calc'!A0", notes: "-2+3" }));
  const rows = creatorRows([lead]);
  assert.deepEqual(rows[0], [...exportColumns]);
  assert.equal(rows[0].length, 29);
  assert.equal(rows[1][0], "'=cmd|' /C calc'!A0");
  assert.equal(rows[1][3], "@priya.mua");
  assert.equal(rows[1][11], 12500);
  assert.equal(rows[1][exportColumns.indexOf("Notes")], "'-2+3");
  const [csvRow] = parseCSV(creatorCSV([lead]));
  assert.equal(csvRow["instagram handle"], "@priya.mua");
});

test("xlsx export is a valid zip with inline text, numeric cells and escaped XML", () => {
  const bytes = xlsx("Gloss creators", [["Name", "Followers"], ["A & <B>", 12500], ["@priya.mua", null]]);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  const text = new TextDecoder().decode(bytes);
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"])
    assert.ok(text.includes(part), part);
  assert.ok(text.includes("A &amp; &lt;B&gt;"));
  assert.ok(text.includes('<c r="B2"><v>12500</v></c>'));
  assert.ok(text.includes("@priya.mua"));
  assert.ok(!text.includes("<f>"));
  // End-of-central-directory record lists every part.
  const eocd = bytes.length - 22;
  assert.equal(new DataView(bytes.buffer).getUint32(eocd, true), 0x06054b50);
  assert.equal(new DataView(bytes.buffer).getUint16(eocd + 10, true), 6);
});

const promises = /guarantee|\bearn\b|\bincome\b|you will get|more (bookings|clients|jobs|work)|conversion/i;
test("Gloss drafts never promise results and only mention configured commercial terms", () => {
  const c = creatorCampaign();
  const partner = newCreatorLead(c, input());
  const prospectC = prospectCampaign();
  const prospect = newCreatorLead(prospectC, input({ creator: { instagram: "@p2", partnership: "Starter Prospect" } }));
  for (const [lead, camp] of [[partner, c], [prospect, prospectC], [{ ...partner, creator: { ...partner.creator, partnership: "Both" } }, c]])
    for (const channel of channels)
      for (const tone of ["Warm", "Formal", "Concise"]) {
        const d = outreachDraft(lead, camp, channel, tone, "Rini");
        assert.doesNotMatch(d.subject + d.body, promises, `${channel} ${tone}`);
        if (lead === partner) assert.doesNotMatch(d.body, /₹|commission/i);
      }
  const dm = outreachDraft(partner, c, "Instagram DM", "Warm", "Rini");
  assert.equal(dm.subject, "");
  assert.match(dm.body, /^Hi Priya,/);
  const starter = outreachDraft(prospect, prospectC, "Email", "Warm", "Rini");
  assert.match(starter.body, /proposed launch offer is ₹199 .*not final yet/);
  prospectC.gloss.offerMode = "Omit";
  assert.doesNotMatch(outreachDraft(prospect, prospectC, "Email", "Warm", "Rini").body, /₹/);
  c.gloss.commission = "10% of verified retained Starter sales";
  assert.match(outreachDraft(partner, c, "Email", "Warm", "Rini").body, /proposed partner terms are 10%/);
});

test("general business campaigns keep the original templates", () => {
  const campaign = newCampaign(2);
  campaign.markets = suggestMarkets(campaign.description, campaign.location, 2);
  const lead = { ...demoLeads(campaign)[0], demo: false };
  for (const channel of ["Email", "WhatsApp", "Phone", "Follow-up"])
    assert.deepEqual(
      outreachDraft(lead, campaign, channel, "Warm", "Rini"),
      templateDraft(lead, campaign, channel, "Warm", "Rini"),
    );
  assert.equal(stageLabel(lead, "Converted"), "Converted");
});

test("creator partners and customer prospects cannot be mixed", () => {
  const c = creatorCampaign();
  const p = prospectCampaign();
  const general = newCampaign(2);
  const partner = newCreatorLead(c, input());
  const state = { ...emptyWorkspace(), campaigns: [c, p, general], leads: [partner] };
  assert.equal(glossWorkspaceError(state), "");
  assert.match(glossWorkspaceError({ ...state, leads: [{ ...partner, campaignId: general.id }] }), /Gloss/);
  assert.match(glossWorkspaceError({ ...state, leads: [{ ...partner, campaignId: p.id }] }), /Creator Partner lead cannot/);
  const business = { ...demoLeads({ ...general, markets: suggestMarkets("", "Pune", 2) })[0], campaignId: c.id };
  assert.match(glossWorkspaceError({ ...state, leads: [business] }), /only contain creator/);
  assert.equal(glossWorkspaceError({ ...state, leads: [{ ...business, campaignId: p.id }] }), "");
  assert.equal(stageLabel(partner, "Converted"), "Partnered");
});

test("open search links stay on known hosts and include only campaign keywords", () => {
  const c = creatorCampaign();
  c.gloss.platforms = ["Instagram", "YouTube"];
  c.gloss.keywords = "bridal & airbrush";
  const links = searchLinks(c, "Makeup Artist");
  assert.equal(links[0].platform, "Instagram");
  assert.deepEqual([...new Set(links.map((l) => l.platform))], ["Instagram", "YouTube"]);
  for (const l of links) assert.match(new URL(l.url).hostname, /^(www\.)?(google|instagram|youtube)\.com$/);
  assert.ok(links[0].url.includes(encodeURIComponent("site:instagram.com Makeup Artist Pune bridal & airbrush")));
});

test("professional prospect markets reach the existing beauty and food directory categories", () => {
  const p = prospectCampaign();
  p.gloss.professions = ["Makeup Artist", "Nail Artist", "Chef / Hospitality"];
  p.markets = glossMarkets(p);
  const { selected } = buildDirectoryQuery(p);
  assert.deepEqual(
    selected.map((k) => k.industry).sort(),
    ["Cafés and restaurants", "Hotels", "Salons and beauty"],
  );
  // Existing business CSV export is unchanged.
  assert.equal(toCSV([]), '"name","industry","location","website","email","phone","source","stage","tags","demo"');
});
