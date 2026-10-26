import { z } from "zod";
import { customLeadSchema, customProjectSchema, templateSchema } from "./project-schema.ts";
export const stages = [
  "New",
  "Shortlisted",
  "Contacted",
  "Replied",
  "Interested",
  "Converted",
  "Lost",
] as const;
// New channels are appended so existing saved drafts and slices keep their meaning.
export const channels = [
  "Email",
  "WhatsApp",
  "Phone",
  "Follow-up",
  "Instagram DM",
] as const;
export const audiences = [
  "General",
  "Creator Partners",
  "Professional Prospects",
] as const;
export const platforms = [
  "Instagram",
  "YouTube",
  "TikTok",
  "LinkedIn",
  "Facebook",
  "Website",
] as const;
// Makeup artists and hairstylists are the PRD launch focus and stay first.
export const professions = [
  "Makeup Artist",
  "Hairstylist",
  "Nail Artist",
  "Bridal Makeup Artist",
  "Beauty Creator",
  "Model",
  "Creative Freelancer",
  "Chef / Hospitality",
] as const;
export const partnershipTypes = [
  "Creator Partner",
  "Starter Prospect",
  "Both",
] as const;
export const offerModes = ["Proposed", "Confirmed", "Omit"] as const;
const text = z.string().max(10000);
const short = z.string().max(300);
const count = z.number().int().min(0).max(10_000_000_000);
export const glossSchema = z.object({
  professions: z
    .array(z.enum(professions))
    .max(professions.length)
    .default(["Makeup Artist", "Hairstylist"]),
  platforms: z
    .array(z.enum(platforms))
    .max(platforms.length)
    .default(["Instagram"]),
  followerMin: count.default(0),
  // 0 means no upper limit.
  followerMax: count.default(0),
  keywords: short.default(""),
  leadLimit: z.number().int().min(1).max(2000).default(500),
  offerMode: z.enum(offerModes).default("Proposed"),
  offer: short.default("₹199 Starter plan with 12 months of hosted access"),
  commission: short.default(""),
});
export const marketSchema = z.object({
  name: short.trim().min(1),
  reason: text,
  needs: text,
  positioning: text,
  search: short,
  score: z.number().min(0).max(100),
});
export const scopes = ["locality", "city", "state", "country", "global"] as const;
export const reportSchema = z.object({
  source: short,
  scope: short,
  area: short.default(""),
  status: z.enum(["ok", "partial", "empty", "failed", "skipped", "not-configured"]),
  found: z.number().int().min(0).max(1_000_000),
  added: z.number().int().min(0).max(1_000_000).default(0),
  refreshed: z.number().int().min(0).max(1_000_000).default(0),
  message: text.default(""),
});
export const discoverySchema = z.object({
  // 0 turns automatic refresh off.
  autoRefreshDays: z.number().int().min(0).max(90).default(0),
  lastRunAt: short.default(""),
  lastReport: z.array(reportSchema).max(80).default([]),
});
export const campaignSchema = z.object({
  id: short.min(1),
  name: short.trim().min(1),
  description: text.trim().min(1),
  website: short,
  location: short.trim().min(1),
  radius: short,
  customer: short,
  price: short,
  goal: short,
  channels: z.array(z.enum(channels)),
  markets: z.array(marketSchema).max(20),
  status: z.enum(["Active", "Paused", "Archived"]),
  createdAt: short,
  demo: z.boolean(),
  theme: z.number().int().min(0).max(5),
  audience: z.enum(audiences).default("General"),
  gloss: glossSchema.optional(),
  discovery: discoverySchema.optional(),
  // Present only on custom lead projects (see project-schema.ts).
  custom: customProjectSchema.optional(),
});
export const creatorSchema = z.object({
  profession: short.default(""),
  // Primary contact platform. Website uses the lead's website field.
  platform: z.enum(platforms).default("Instagram"),
  // Instagram handle, stored without the leading @.
  instagram: short.default(""),
  instagramUrl: short.default(""),
  tiktokUrl: short.default(""),
  youtubeUrl: short.default(""),
  linkedinUrl: short.default(""),
  facebookUrl: short.default(""),
  followers: count.nullable().default(null),
  engagement: short.default(""),
  partnership: z.enum(partnershipTypes).default("Creator Partner"),
  photoUrl: short.default(""),
  verifiedAt: short.default(""),
});
export const leadSchema = z.object({
  id: short.min(1),
  campaignId: short,
  name: short.trim().min(1),
  industry: short,
  location: short,
  website: short,
  email: short,
  phone: short,
  source: short,
  sourceLabel: short,
  discoveredAt: short,
  score: z.number().min(0).max(100),
  reason: text,
  missing: text,
  stage: z.enum(stages),
  notes: text,
  tags: short,
  followUp: short,
  contactedAt: short,
  demo: z.boolean(),
  history: z.array(z.object({ at: short, event: text })).max(500),
  kind: z.enum(["business", "creator"]).default("business"),
  // Creator leads always have this. Business leads may carry the social
  // links and profession published by their source (for example OpenStreetMap).
  creator: creatorSchema.optional(),
  // Date the source last confirmed this record (set on discovery and refresh).
  checkedAt: short.default(""),
  // Date the source itself says the record was last verified (e.g. an
  // OpenStreetMap mapper's check_date). Empty when the source has none.
  sourceVerifiedAt: short.default(""),
  // Geographic tier the record was discovered in, used for priority.
  scope: z.enum(["", ...scopes]).default(""),
  // Present only on leads of custom lead projects.
  project: customLeadSchema.optional(),
});
export const draftSchema = z.object({
  id: short,
  leadId: short,
  channel: z.enum(channels),
  tone: short,
  subject: short,
  body: text,
  createdAt: short,
  scheduledFor: short,
});
export const stateSchema = z.object({
  profile: z.object({
    name: short.trim().min(1),
    business: short,
    website: short,
    notifications: z.boolean(),
  }),
  campaigns: z.array(campaignSchema).max(200),
  leads: z.array(leadSchema).max(200_000),
  drafts: z.array(draftSchema).max(2000),
  templates: z
    .array(z.object({ id: short, name: short, subject: short, body: text }))
    .max(100),
  // Workspace-wide default templates for custom lead projects.
  customTemplates: z.array(templateSchema).max(40).optional(),
});
export type Market = z.infer<typeof marketSchema>;
export type Gloss = z.infer<typeof glossSchema>;
export type Creator = z.infer<typeof creatorSchema>;
export type Scope = (typeof scopes)[number];
export type DiscoveryReport = z.infer<typeof reportSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type Lead = z.infer<typeof leadSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Workspace = z.infer<typeof stateSchema>;
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function getFollowUps(state: Workspace, today = localDate()) {
  const eligible = state.leads.filter(
    (l) => !l.demo && !["Converted", "Lost"].includes(l.stage),
  );
  const leads = eligible
    .filter((l) => l.followUp)
    .map((lead) => ({
      id: `lead-${lead.id}`,
      lead,
      date: lead.followUp,
      label: "Lead reminder",
      draftId: "",
      due: lead.followUp <= today,
    }));
  const drafts = state.drafts.flatMap((d) => {
    const lead = eligible.find((l) => l.id === d.leadId);
    return lead && d.scheduledFor
      ? [
          {
            id: `draft-${d.id}`,
            lead,
            date: d.scheduledFor,
            label: d.subject || `${d.channel} draft`,
            draftId: d.id,
            due: d.scheduledFor <= today,
          },
        ]
      : [];
  });
  return [...leads, ...drafts].sort((a, b) => a.date.localeCompare(b.date));
}
export const emptyWorkspace = (): Workspace => ({
  profile: { name: "Rini", business: "", website: "", notifications: true },
  campaigns: [],
  leads: [],
  drafts: [],
  templates: [],
});
export const presets = [
  {
    name: "Gloss",
    description: "Beauty, talent & everything in between",
    offering:
      "Brand partnerships and creative services for the beauty industry",
    markets: [
      "Modeling agencies",
      "Salons",
      "Beauty academies",
      "Photographers",
      "Bridal studios",
    ],
  },
  {
    name: "Mindful Companion",
    description: "Wellness that reaches the right people",
    offering: "Mental wellbeing workshops and wellness programs",
    markets: [
      "Colleges and universities",
      "Wellness centers",
      "Employee assistance programs",
      "Coaching institutes",
      "Psychology practices",
    ],
  },
  {
    name: "Rini Aesthetics",
    description: "Spaces with a little more soul",
    offering: "Handmade paintings and bespoke artwork for beautiful spaces",
    markets: [
      "Cafés and restaurants",
      "Boutique hotels",
      "Interior designers",
      "Art galleries",
      "Corporate offices",
    ],
  },
  {
    name: "CA Campaigns",
    description: "Expertise businesses can count on",
    offering: "Business services for accounting and finance professionals",
    markets: [
      "Accounting firms",
      "Tax consultants",
      "CFO advisory firms",
      "Bookkeeping services",
    ],
  },
  {
    name: "Legal Campaigns",
    description: "The right professional connections",
    offering: "Professional services for legal practices",
    markets: [
      "Law firms",
      "Corporate legal practices",
      "IP and trademark firms",
      "Legal consultants",
    ],
  },
  {
    name: "Anything Else",
    description: "Your idea. A new possibility.",
    offering: "",
    markets: [
      "Independent businesses",
      "Specialist retailers",
      "Corporate teams",
    ],
  },
];
export function suggestMarkets(
  description: string,
  location: string,
  theme: number,
  customer = "",
): Market[] {
  const d = description.toLowerCase();
  const inferred = /paint|artwork|decor|interior/.test(d)
    ? 2
    : /wellness|mental|psycholog|well.?being|mindful|journ?al|jornal|counsell?ing|meditation/.test(
          d,
        )
      ? 1
      : /beauty|salon|modeling|bridal/.test(d)
        ? 0
        : /account|bookkeep|finance|tax/.test(d)
          ? 3
          : /legal|law |lawyer/.test(d)
            ? 4
            : theme;
  const list = [
    ...new Set([
      ...(customer.trim() ? [customer.trim()] : []),
      ...presets[inferred].markets,
    ]),
  ].slice(0, 5);
  return list.map((name, i) => ({
    name,
    reason: `${name} are a starting hypothesis for this offering. Validate their needs before outreach.`,
    needs:
      "A useful, relevant solution with a clear benefit and an appropriate price.",
    positioning: `Introduce ${description.slice(0, 130)} through a small, relevant pilot.`,
    search: `${name} in ${location}`,
    score: Math.max(50, 85 - i * 6),
  }));
}
export const uid = () => crypto.randomUUID();
export function assessFit(lead: Lead, campaign: Campaign) {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ");
  const category = normalize(lead.industry);
  const industry = campaign.markets.some((m) =>
    normalize(m.name)
      .split(" ")
      .filter((t) => t.length > 3)
      .some((t) => category.includes(t)),
  )
    ? 35
    : 0;
  const location =
    lead.location.trim() &&
    normalize(lead.location).includes(normalize(campaign.location))
      ? 25
      : 0;
  const website = safeUrl(lead.website) ? 15 : 0;
  const contact = lead.email || lead.phone ? 15 : 0;
  const source = safeUrl(lead.source) ? 10 : 0;
  return {
    score: industry + location + website + contact + source,
    reason: `Rule-based fit estimate: selected market match ${industry}/35; target location ${location}/25; website provided ${website}/15; contact provided ${contact}/15; source link provided ${source}/10. Market match is a proxy for offering suitability. Provided information is not independently verified.`,
    missing:
      "Actual buying intent, budget, offering suitability and accuracy of contact details need direct review.",
  };
}
export const now = () => new Date().toISOString();
export const glossOffering =
  "Gloss helps beauty, creative and hospitality professionals turn their experience into a polished resume and a branded enquiry link they can share.";
export function newCampaign(
  theme = 5,
  description = "",
  audience: Campaign["audience"] = "General",
): Campaign {
  if (audience !== "General")
    return {
      ...newCampaign(0, description || glossOffering),
      name:
        audience === "Creator Partners"
          ? "Gloss creator partners"
          : "Gloss professional prospects",
      // Gloss campaigns keep their leads current with a daily refresh.
      discovery: discoverySchema.parse({ autoRefreshDays: 1 }),
      goal:
        audience === "Creator Partners"
          ? "Start relevant creator partnership conversations"
          : "Invite professionals to try Gloss",
      channels: ["Instagram DM", "Email"],
      audience,
      gloss: glossSchema.parse({}),
    };
  return {
    id: uid(),
    name: theme === 5 ? "" : presets[theme].name,
    description: description || presets[theme].offering,
    website: "",
    location: "Pune",
    radius: "25 km",
    customer: "",
    price: "",
    goal: "Start qualified conversations",
    channels: ["Email"],
    markets: [],
    status: "Active",
    createdAt: now(),
    demo: false,
    theme,
    audience: "General",
  };
}
export function demoLeads(c: Campaign): Lead[] {
  return c.markets
    .slice(0, 3)
    .flatMap((m, i) =>
      ["Studio", "Collective"].map((suffix, j) => ({
        id: uid(),
        campaignId: c.id,
        name: `${["Juniper", "Willow", "Cedar"][i]} ${suffix} (sample)`,
        industry: m.name,
        location: c.location,
        website: `https://${["juniper", "willow", "cedar"][i]}-${suffix.toLowerCase()}.example`,
        email: j ? "" : `hello@${["juniper", "willow", "cedar"][i]}.example`,
        phone: "",
        source: "",
        sourceLabel: "Fictional demonstration record",
        discoveredAt: now(),
        score: 80 - i * 8 - j * 4,
        reason: `Illustrative fit: selected industry (+30), target location (+25), possible offering match (+25). This is a sample score, not a verified assessment or conversion prediction.`,
        missing:
          "Business identity, buying intent, budget and contact details are not verified.",
        stage: "New" as const,
        notes: "",
        tags: "sample",
        followUp: "",
        contactedAt: "",
        demo: true,
        history: [{ at: now(), event: "Sample lead added" }],
        kind: "business" as const,
        checkedAt: "",
        sourceVerifiedAt: "",
        scope: "" as const,
      })),
    );
}
export function sampleWorkspace(current: Workspace): Workspace {
  const campaigns = presets.slice(0, 5).map((_, i) => {
    const c = newCampaign(i);
    c.demo = true;
    c.markets = suggestMarkets(c.description, c.location, i).slice(0, 2);
    return c;
  });
  const leads = campaigns
    .flatMap(demoLeads)
    .map((l, i) => ({
      ...l,
      stage: stages[i % 6],
      contactedAt: i % 6 >= 2 ? now() : "",
      history: [
        ...l.history,
        { at: now(), event: `Sample stage: ${stages[i % 6]}` },
      ],
    }));
  return {
    ...current,
    campaigns: [...current.campaigns, ...campaigns],
    leads: [...current.leads, ...leads],
  };
}
export function updateStage(lead: Lead, stage: Lead["stage"]): Lead {
  if (lead.stage === stage) return lead;
  return {
    ...lead,
    stage,
    contactedAt:
      lead.contactedAt ||
      (["Contacted", "Replied", "Interested", "Converted"].includes(stage)
        ? now()
        : ""),
    history: [
      ...lead.history,
      { at: now(), event: `Stage changed from ${lead.stage} to ${stage}` },
    ].slice(-500),
  };
}
export function metrics(leads: Lead[]) {
  leads = leads.filter((l) => !l.demo);
  return {
    found: leads.length,
    contacted: leads.filter((l) => !!l.contactedAt).length,
    interested: leads.filter(
      (l) => l.stage === "Interested" || l.stage === "Converted",
    ).length,
    converted: leads.filter((l) => l.stage === "Converted").length,
    replied: leads.filter((l) =>
      ["Replied", "Interested", "Converted"].includes(l.stage),
    ).length,
  };
}
export function templateDraft(
  lead: Lead,
  c: Campaign,
  channel: Draft["channel"],
  tone: string,
  sender: string,
) {
  const hello =
    tone === "Formal" ? `Dear ${lead.name} team,` : `Hi ${lead.name} team,`;
  const offer = `I’m ${sender}. We offer ${c.description}.`;
  const question =
    tone === "Concise"
      ? "Would this be relevant for your team?"
      : "Would you be open to a brief conversation to see whether this could be useful for your team?";
  return {
    subject: `An introduction from ${c.name}`,
    body:
      channel === "Phone"
        ? `Opening: ${hello}\n\n${offer}\n\nAsk: ${question}\n\nListen: What are your current priorities?\n\nClose: Agree on a next step only if there is interest.`
        : channel === "Follow-up"
          ? `${hello}\n\nFollowing up on my earlier introduction about ${c.description}. ${question}\n\nBest,\n${sender}`
          : `${hello}\n\n${offer}\n\n${question}\n\n${channel === "WhatsApp" ? "Thanks," : "Best,"}\n${sender}`,
  };
}
export function safeUrl(s: string) {
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
export function normalizeHandle(raw: string) {
  let s = raw.trim();
  const url = safeUrl(s);
  if (url) {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return "";
    s = u.pathname.split("/").filter(Boolean)[0] || "";
  }
  s = s.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) && !/^\.|\.$|\.\./.test(s) ? s : "";
}
export function profileKey(raw: string) {
  const url = safeUrl(raw);
  if (!url) return "";
  const u = new URL(url);
  return (
    u.hostname.replace(/^(www|m)\./, "") + u.pathname.replace(/\/+$/, "")
  ).toLowerCase();
}
export function deduplicate(existing: Lead[], incoming: Lead[]) {
  const keys = (l: Lead) => {
    const c = l.kind === "creator" ? l.creator : undefined;
    // Creators are matched by public profile, so two different people with
    // the same name in one city are both kept.
    const profiles = c
      ? [
          normalizeHandle(c.instagram) && "ig:" + normalizeHandle(c.instagram),
          ...[
            c.instagramUrl,
            c.tiktokUrl,
            c.youtubeUrl,
            c.linkedinUrl,
            c.facebookUrl,
            l.website,
          ].map(profileKey),
        ].filter(Boolean)
      : [];
    // Directory records (e.g. one OpenStreetMap node per outlet) are matched
    // only by their source record, so branches that share a brand website or
    // name are all kept.
    const directory = !c && /openstreetmap\.org\/(node|way|relation)\//.test(l.source);
    return (
      profiles.length
        ? profiles
        : directory
          ? []
          : [
              l.website
                ? safeUrl(l.website).replace(/\/$/, "").toLowerCase()
                : "",
              `${l.name.trim().toLowerCase()}|${l.location.trim().toLowerCase()}`,
            ]
    )
      // The same source record (e.g. one OpenStreetMap node) is never added twice.
      .concat(safeUrl(l.source) ? ["src:" + profileKey(l.source)] : [])
      .filter(Boolean)
      .map((key) => `${l.campaignId}|${key}`);
  };
  const seen = new Set(existing.flatMap(keys));
  const result: Lead[] = [];
  for (const l of incoming) {
    const k = keys(l);
    if (!k.some((x) => seen.has(x))) {
      result.push(l);
      k.forEach((x) => seen.add(x));
    }
  }
  return result;
}
export function toCSV(leads: Lead[]) {
  const columns = [
    "name",
    "industry",
    "location",
    "website",
    "email",
    "phone",
    "source",
    "stage",
    "tags",
    "demo",
  ];
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    columns,
    ...leads.map((l) => columns.map((k) => String(l[k as keyof Lead] ?? ""))),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}
export function parseCSV(raw: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = raw.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error("The CSV is empty.");
  const headers = rows.shift()!.map((x) => x.trim().toLowerCase());
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV column names must be unique.");
  if (!headers.includes("name"))
    throw new Error(
      "CSV needs a name column. Optional: industry, location, website, email, phone, source, tags.",
    );
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of columns.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}

export const wellnessTerms =
  /mental|wellness|well.?being|psycholog|psychiatr|counsell?ing|therap|mindful|journ?al|jornal|meditation/i;
export function matchesLeadSearch(lead: Lead, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [lead.name, lead.industry, lead.tags, lead.notes]
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  if (wellnessTerms.test(q) && wellnessTerms.test(haystack)) return true;
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
