// Schemas for custom lead projects. Kept free of imports from leadgen.ts so
// leadgen.ts can embed them as optional fields without a circular import.
// Every field that Gloss records could carry is optional, so Gloss data and
// its parsed shape are unchanged.
import { z } from "zod";

const text = z.string().max(10000);
const short = z.string().max(300);

// Same values as `scopes` in leadgen.ts; "country" is the home-country tier
// (labelled "India" for an Indian base location).
export const tiers = ["locality", "city", "state", "country", "global"] as const;
export type Tier = (typeof tiers)[number];
export const tierRank = (t: string) => tiers.indexOf(t as Tier);
export const batchSizes = [50, 100, 250, 500, 1000, 2500, 5000] as const;
export const defaultSplits: Record<number, number[]> = {
  1: [100],
  2: [70, 30],
  3: [50, 30, 20],
  4: [40, 30, 20, 10],
  5: [35, 25, 20, 12, 8],
};
export const outreachStatuses = [
  "not_contacted",
  "contacted",
  "replied",
  "interested",
  "meeting",
  "won",
  "not_interested",
  "no_response",
  "bad_contact",
  "do_not_contact",
] as const;
export type OutreachStatus = (typeof outreachStatuses)[number];
export const templateChannels = [
  "WhatsApp",
  "Email",
  "Instagram DM",
  "Call script",
  "Follow-up 1",
  "Follow-up 2",
] as const;
export type TemplateChannel = (typeof templateChannels)[number];

export const segmentSchema = z.object({
  id: short.min(1),
  label: short.trim().min(1),
  include: z.array(short).max(30).default([]),
  exclude: z.array(short).max(30).default([]),
  // Overture taxonomy category ids, e.g. "architect", "furniture_store".
  categories: z.array(short).max(40).default([]),
});
export const senderSchema = z.object({
  name: short.default(""),
  business: short.default(""),
  pitch: short.default(""),
  website: short.default(""),
  phone: short.default(""),
  offer: short.default(""),
  cta: short.default("Can I share a 2-minute overview?"),
});
export const templateSchema = z.object({
  id: short.min(1),
  name: short.trim().min(1),
  channel: z.enum(templateChannels),
  // Empty means the project default for the channel.
  segmentId: short.default(""),
  subject: short.default(""),
  body: text,
  version: z.number().int().min(1).default(1),
  updatedAt: short.default(""),
});
export const projectReportSchema = z.object({
  source: short,
  scope: short,
  area: short.default(""),
  segment: short.default(""),
  status: z.enum(["ok", "partial", "empty", "failed", "skipped", "not-configured"]),
  found: z.number().int().min(0).max(10_000_000),
  added: z.number().int().min(0).max(10_000_000).default(0),
  refreshed: z.number().int().min(0).max(10_000_000).default(0),
  excluded: z.number().int().min(0).max(10_000_000).default(0),
  closed: z.number().int().min(0).max(10_000_000).default(0),
  suppressed: z.number().int().min(0).max(10_000_000).default(0),
  message: text.default(""),
});
const place = z.object({
  name: short,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  code: short.default(""),
});
const geoPlace = z.object({
  name: short,
  areaId: z.number().int().optional(),
  wikidata: short.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  code: short.optional(),
});
// Discovery progress per tier, segment and source, so a top-up continues
// where the last one stopped.
export const poolCursorSchema = z.object({
  cursor: short.default(""),
  exhausted: z.boolean().default(false),
  fetched: z.number().int().min(0).default(0),
});
export const customProjectSchema = z.object({
  segments: z.array(segmentSchema).min(1).max(20),
  // Selected tiers, nearest first.
  tiers: z.array(z.enum(tiers)).min(1).max(5),
  // Percentage per selected tier, in 5% steps, totalling 100.
  split: z.array(z.number().int().min(0).max(100)).max(5),
  mode: z.enum(["split", "nearest"]).default("split"),
  // ISO 3166-1 alpha-2 codes searched one at a time for the Global tier.
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).default([]),
  localityKm: z.number().min(0.5).max(25).default(3),
  cityKm: z.number().min(2).max(80).default(20),
  enrich: z.boolean().default(true),
  sender: senderSchema.default({}),
  templates: z.array(templateSchema).max(80).default([]),
  followUpDays: z.number().int().min(1).max(60).default(3),
  noResponseDays: z.number().int().min(1).max(90).default(7),
  // Resolved base location, set when the brief is saved.
  base: z
    .object({
      locality: place.optional(),
      city: place.optional(),
      state: z.object({ name: short, code: short.default("") }).optional(),
      country: z.object({ name: short, code: short.default("") }).optional(),
    })
    .default({}),
  // The resolved location (OpenStreetMap areas, Wikidata ids, state code), so
  // discovery does not look it up again while the location is unchanged.
  geo: z
    .object({
      input: short,
      locality: geoPlace.optional(),
      city: geoPlace.optional(),
      state: geoPlace.optional(),
      country: geoPlace.optional(),
      stateCode: short.optional(),
      stateBbox: z.object({ w: z.number(), s: z.number(), e: z.number(), n: z.number() }).optional(),
    })
    .optional(),
  pool: z.record(short, poolCursorSchema).default({}),
  lastRunAt: short.default(""),
  lastReport: z.array(projectReportSchema).max(400).default([]),
});

export const deliveryStateSchema = z.object({
  status: z.enum(["available", "given"]).default("available"),
  id: short.default(""),
  givenAt: short.default(""),
  batch: z.number().int().min(0).default(0),
});
export const sourceRefSchema = z.object({
  name: short,
  url: short.default(""),
  id: short,
});
export const customLeadSchema = z.object({
  kind: z.literal("custom").default("custom"),
  segmentId: short,
  tier: z.enum(tiers),
  categories: z.array(short).max(20).default([]),
  address: short.default(""),
  locality: short.default(""),
  city: short.default(""),
  region: short.default(""),
  country: short.default(""),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  distanceKm: z.number().min(0).nullable().default(null),
  // Stable key of the record that first created this lead; never changes.
  dedupeKey: short.min(1),
  // Every source record merged into this lead, e.g. "ov:<gers id>", "osm:node/1".
  sourceIds: z.array(short).max(50).default([]),
  sources: z.array(sourceRefSchema).max(50).default([]),
  confidence: z.number().min(0).max(1).nullable().default(null),
  phoneE164: short.default(""),
  phoneType: z.enum(["", "mobile", "landline", "either", "unknown"]).default(""),
  websiteStatus: z.enum(["", "live", "redirects", "dead", "timeout"]).default(""),
  emailCheck: z.enum(["", "valid domain", "no mail server", "invalid"]).default(""),
  // Where an enriched field came from: field name → page URL.
  provenance: z.record(short, short).default({}),
  delivery: deliveryStateSchema.default({}),
  outreach: z
    .object({
      status: z.enum(outreachStatuses).default("not_contacted"),
      lastContactedAt: short.default(""),
      repliedAt: short.default(""),
      channel: short.default(""),
      templateId: short.default(""),
      templateVersion: z.number().int().min(0).default(0),
      // Follow-up step the current reminder is for (0 = none scheduled).
      followUpStep: z.number().int().min(0).max(2).default(0),
    })
    .default({}),
  drafts: z.record(short, z.object({ subject: short.default(""), body: text })).default({}),
});

export const deliverySchema = z.object({
  id: short,
  campaignId: short,
  seq: z.number().int().min(1),
  requested: z.number().int().min(1),
  mode: z.enum(["split", "nearest"]),
  planned: z.record(short, z.number().int()),
  actual: z.object({
    tiers: z.record(short, z.number().int()),
    segments: z.record(short, z.number().int()),
  }),
  notes: z.array(text),
  delivered: z.number().int().min(0),
  suppressed: z.number().int().min(0),
  createdAt: short,
  filename: short,
});
export const contactEventSchema = z.object({
  id: short.min(1),
  campaignId: short.min(1),
  leadId: short.min(1),
  channel: short.min(1),
  templateId: short.default(""),
  templateVersion: z.number().int().min(0).default(0),
  direction: z.enum(["outbound", "reply"]),
  note: text.default(""),
  createdAt: short,
});
export const suppressionKinds = ["phone", "email", "domain", "handle", "name"] as const;
export const suppressionSchema = z.object({
  id: short.min(1),
  kind: z.enum(suppressionKinds),
  value: short.min(1),
  reason: short.default(""),
  origin: z.enum(["manual", "csv", "do-not-contact"]).default("manual"),
  createdAt: short.default(""),
});

export type Segment = z.infer<typeof segmentSchema>;
export type Sender = z.infer<typeof senderSchema>;
export type ProjectTemplate = z.infer<typeof templateSchema>;
export type CustomProject = z.infer<typeof customProjectSchema>;
export type CustomLead = z.infer<typeof customLeadSchema>;
export type ProjectReport = z.infer<typeof projectReportSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type DeliveryState = z.infer<typeof deliveryStateSchema>;
export type ContactEvent = z.infer<typeof contactEventSchema>;
export type Suppression = z.infer<typeof suppressionSchema>;
