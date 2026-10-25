import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(),
  // Workspace JSON without leads (profile, campaigns, drafts, templates).
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(0),
  // Identifies the save that produced the current revision, so lead changes
  // in the same batch are only applied when that save won the revision check.
  writeToken: text("write_token").notNull().default(""),
});
// Custom lead project fields, read from the lead JSON. Virtual, so they never
// need syncing and are NULL for Gloss and other leads.
const fromData = (path: string) => sql.raw(`json_extract(\`data\`,'$.project.${path}')`);
const virtualText = (name: string, path: string) => text(name).generatedAlwaysAs(fromData(path), { mode: "virtual" });
// One row per lead, so campaigns are not limited by a single row's size.
export const leads = sqliteTable(
  "leads",
  {
    owner: text("owner").notNull(),
    id: text("id").notNull(),
    campaignId: text("campaign_id").notNull(),
    data: text("data").notNull(),
    projectKind: virtualText("project_kind", "kind"),
    segmentId: virtualText("segment_id", "segmentId"),
    tier: virtualText("tier", "tier"),
    country: virtualText("country", "country"),
    distanceKm: real("distance_km").generatedAlwaysAs(fromData("distanceKm"), { mode: "virtual" }),
    dedupeKey: virtualText("dedupe_key", "dedupeKey"),
    deliveryStatus: virtualText("delivery_status", "delivery.status"),
    deliveryId: virtualText("delivery_id", "delivery.id"),
    givenAt: virtualText("given_at", "delivery.givenAt"),
    sourceIds: virtualText("source_ids", "sourceIds"),
    websiteStatus: virtualText("website_status", "websiteStatus"),
    emailCheck: virtualText("email_check", "emailCheck"),
    phoneType: virtualText("phone_type", "phoneType"),
    outreachStatus: virtualText("outreach_status", "outreach.status"),
    lastContactedAt: virtualText("last_contacted_at", "outreach.lastContactedAt"),
    repliedAt: virtualText("replied_at", "outreach.repliedAt"),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.id] }),
    index("leads_owner_campaign").on(t.owner, t.campaignId),
    index("leads_delivery").on(t.owner, t.campaignId, t.deliveryStatus, t.tier),
    index("leads_outreach").on(t.owner, t.campaignId, t.outreachStatus),
    uniqueIndex("leads_dedupe").on(t.owner, t.campaignId, t.dedupeKey).where(sql.raw("`dedupe_key` IS NOT NULL")),
  ],
);
// Batches handed out from a custom lead project (the "Given" ledger).
export const deliveries = sqliteTable(
  "deliveries",
  {
    owner: text("owner").notNull(),
    id: text("id").notNull(),
    campaignId: text("campaign_id").notNull(),
    seq: integer("seq").notNull(),
    requested: integer("requested").notNull(),
    mode: text("mode").notNull(),
    planned: text("planned").notNull(),
    actual: text("actual").notNull(),
    notes: text("notes").notNull(),
    delivered: integer("delivered").notNull(),
    suppressed: integer("suppressed").notNull().default(0),
    createdAt: text("created_at").notNull(),
    filename: text("filename").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.id] }), uniqueIndex("deliveries_seq").on(t.owner, t.campaignId, t.seq)],
);
// Outreach sent and replies received, recorded by hand. Nothing is sent automatically.
export const contactEvents = sqliteTable(
  "contact_events",
  {
    owner: text("owner").notNull(),
    id: text("id").notNull(),
    campaignId: text("campaign_id").notNull(),
    leadId: text("lead_id").notNull(),
    channel: text("channel").notNull(),
    templateId: text("template_id"),
    templateVersion: integer("template_version"),
    direction: text("direction").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.id] }),
    index("contact_events_lead").on(t.owner, t.leadId, t.createdAt),
    index("contact_events_campaign").on(t.owner, t.campaignId, t.createdAt),
  ],
);
// Workspace-wide do-not-contact list.
export const suppression = sqliteTable(
  "suppression",
  {
    owner: text("owner").notNull(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    reason: text("reason").notNull().default(""),
    origin: text("origin").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.id] }), uniqueIndex("suppression_value").on(t.owner, t.kind, t.value)],
);
