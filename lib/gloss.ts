// Gloss creator and professional-prospect workflow. Everything here is
// transparent and rule-based; nothing contacts or reads social platforms.
import {
  assessFit,
  creatorSchema,
  glossSchema,
  normalizeHandle,
  now,
  partnershipTypes,
  platforms,
  professions,
  safeUrl,
  templateDraft,
  uid,
  type Campaign,
  type Creator,
  type Draft,
  type Gloss,
  type Lead,
  type Workspace,
} from "./leadgen.ts";

export type Platform = (typeof platforms)[number];
export type Partnership = (typeof partnershipTypes)[number];

const platformHosts: Record<Exclude<Platform, "Website">, RegExp> = {
  Instagram: /(^|\.)instagram\.com$/i,
  YouTube: /(^|\.)(youtube\.com|youtu\.be)$/i,
  TikTok: /(^|\.)tiktok\.com$/i,
  LinkedIn: /(^|\.)linkedin\.com$/i,
  Facebook: /(^|\.)(facebook\.com|fb\.com)$/i,
};
export const urlField = {
  Instagram: "instagramUrl",
  YouTube: "youtubeUrl",
  TikTok: "tiktokUrl",
  LinkedIn: "linkedinUrl",
  Facebook: "facebookUrl",
} as const;

export const glossConfig = (c: Campaign): Gloss =>
  c.gloss ?? glossSchema.parse({});
export const isGloss = (c?: Campaign) => !!c && c.audience !== "General";
export const emptyCreator = (): Creator => creatorSchema.parse({});

/** Returns a normalized https profile URL on the platform's own domain, or "". */
export function profileUrl(platform: Platform, raw: string) {
  const url = safeUrl(raw.trim());
  if (!url) return "";
  // A plain-http website is still a valid way to reach someone.
  if (platform === "Website") return url;
  if (!url.startsWith("https:")) return "";
  return platformHosts[platform].test(new URL(url).hostname) ? url : "";
}
export const instagramUrl = (handle: string) =>
  normalizeHandle(handle)
    ? `https://www.instagram.com/${normalizeHandle(handle)}/`
    : "";
export const displayHandle = (handle: string) =>
  normalizeHandle(handle) ? "@" + normalizeHandle(handle) : "";

/** Public profile links for a lead, Instagram first. Only valid URLs are returned. */
export function profileLinks(lead: Lead) {
  const c = lead.creator;
  const links: { platform: Platform; url: string }[] = [];
  if (c) {
    const ig =
      profileUrl("Instagram", c.instagramUrl) || instagramUrl(c.instagram);
    if (ig) links.push({ platform: "Instagram", url: ig });
    for (const p of ["TikTok", "YouTube", "LinkedIn", "Facebook"] as const) {
      const url = profileUrl(p, c[urlField[p]]);
      if (url) links.push({ platform: p, url });
    }
  }
  const site = profileUrl("Website", lead.website);
  if (site) links.push({ platform: "Website", url: site });
  return links;
}
export function primaryProfile(lead: Lead) {
  const links = profileLinks(lead);
  return (
    links.find((l) => l.platform === lead.creator?.platform) || links[0] || null
  );
}

/** Accepts 12500, "12,500", "12.5k", "1.2M". Empty returns null; invalid returns undefined. */
export function parseFollowers(raw: string | number | null | undefined) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number")
    return Number.isInteger(raw) && raw >= 0 ? raw : undefined;
  const s = raw.trim().toLowerCase().replace(/[,\s_]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1));
  return Number.isSafeInteger(n) && n <= 10_000_000_000 ? n : undefined;
}
export function formatFollowers(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}
export function followerBand(n: number | null | undefined) {
  if (n === null || n === undefined) return "Unknown";
  if (n < 10_000) return "Under 10K";
  if (n < 100_000) return "10K–100K";
  if (n < 1_000_000) return "100K–1M";
  return "1M+";
}
export const followerBands = ["Under 10K", "10K–100K", "100K–1M", "1M+", "Unknown"];
export function followerRangeLabel(g: Gloss) {
  if (!g.followerMin && !g.followerMax) return "Any follower count";
  if (!g.followerMax) return `${formatFollowers(g.followerMin)}+ followers`;
  return `${formatFollowers(g.followerMin)}–${formatFollowers(g.followerMax)} followers`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").trim();
export function assessCreatorFit(lead: Lead, campaign: Campaign) {
  const g = glossConfig(campaign);
  const c = lead.creator ?? emptyCreator();
  const profession = norm(c.profession);
  const targeted = g.professions.some((p) => norm(p) === profession)
    ? 25
    : professions.some((p) => norm(p) === profession)
      ? 12
      : 0;
  const city = norm(campaign.location.split(",")[0] || "");
  const location = city && norm(lead.location).includes(city) ? 20 : 0;
  const profile = profileLinks(lead).length ? 20 : 0;
  const source = (safeUrl(lead.source) ? 10 : 0) + (c.verifiedAt ? 5 : 0);
  const ranged = g.followerMin > 0 || g.followerMax > 0;
  const followers =
    c.followers === null
      ? 0
      : !ranged ||
          (c.followers >= g.followerMin &&
            (!g.followerMax || c.followers <= g.followerMax))
        ? 10
        : 0;
  const filled = [
    lead.name.trim(),
    c.profession,
    lead.location,
    lead.email || lead.phone || normalizeHandle(c.instagram),
    c.followers !== null,
    c.photoUrl || c.engagement,
  ].filter(Boolean).length;
  const complete = Math.round((filled / 6) * 10);
  return {
    score: targeted + location + profile + source + followers + complete,
    reason: `Rule-based Gloss fit estimate: profession relevance ${targeted}/25; target location ${location}/20; valid public profile ${profile}/20; source link and manual verification ${source}/15; follower range (${followerRangeLabel(g)}) ${followers}/10; profile completeness ${complete}/10. This is a relevance checklist, not a conversion probability, buying intent or performance prediction.`,
    missing:
      "Audience quality, partnership or purchase interest, and the accuracy of public profile details need direct review.",
  };
}
export function scoreLead(lead: Lead, campaign: Campaign) {
  return lead.kind === "creator"
    ? assessCreatorFit(lead, campaign)
    : assessFit(lead, campaign);
}

/** Display label for a stage. Underlying stages and analytics are unchanged. */
export function stageLabel(lead: Lead, stage: Lead["stage"] = lead.stage) {
  if (lead.kind !== "creator" || stage !== "Converted") return stage;
  return lead.creator?.partnership === "Starter Prospect"
    ? "Signed up"
    : "Partnered";
}
export const allowedPartnerships = (c: Campaign): Partnership[] =>
  c.audience === "Creator Partners"
    ? ["Creator Partner", "Both"]
    : c.audience === "Professional Prospects"
      ? ["Starter Prospect", "Both"]
      : [];

/** Server and client rule: creator partners and customer prospects never mix. */
/** One lead's audience rule; empty when valid. */
export function glossLeadError(lead: Lead, c: Campaign | undefined) {
  if (!c) return "";
  if (lead.kind === "creator") {
    if (!isGloss(c))
      return "Creator leads must belong to a Gloss creator or professional campaign.";
    if (!lead.creator) return "Creator leads need creator profile details.";
    if (!allowedPartnerships(c).includes(lead.creator.partnership))
      return `${lead.name}: a ${lead.creator.partnership} lead cannot belong to a ${c.audience} campaign.`;
  } else if (c.audience === "Creator Partners")
    return "Creator partner campaigns can only contain creator leads.";
  return "";
}
export function glossWorkspaceError(state: Workspace) {
  const campaigns = new Map(state.campaigns.map((c) => [c.id, c]));
  for (const lead of state.leads) {
    const error = glossLeadError(lead, campaigns.get(lead.campaignId));
    if (error) return error;
  }
  return "";
}

const professionMarkets: Record<string, { name: string; search: string }> = {
  "Makeup Artist": { name: "Makeup artists and beauty studios", search: "makeup artist" },
  Hairstylist: { name: "Hairstylists and hair salons", search: "hairstylist" },
  "Nail Artist": { name: "Nail artists and nail salons", search: "nail artist" },
  "Bridal Makeup Artist": { name: "Bridal makeup studios", search: "bridal makeup artist" },
  "Beauty Creator": { name: "Beauty creators", search: "beauty creator" },
  Model: { name: "Models and modelling agencies", search: "model" },
  "Creative Freelancer": { name: "Creative freelancers and photographers", search: "creative freelancer" },
  "Chef / Hospitality": { name: "Chefs, restaurants, cafés and hotels", search: "chef" },
};
export function glossMarkets(c: Campaign) {
  const g = glossConfig(c);
  const list = g.professions.length ? g.professions : (["Makeup Artist", "Hairstylist"] as const);
  return list.map((p, i) => ({
    name: professionMarkets[p].name,
    reason:
      c.audience === "Creator Partners"
        ? `${p}s with a relevant public audience could introduce Gloss to other professionals. Validate audience fit before outreach.`
        : `${p}s may need a polished resume and enquiry link. Validate their needs before outreach.`,
    needs: "A clear professional presence and a simple way to receive enquiries.",
    positioning: "A short, specific introduction with no promised results.",
    search: `${professionMarkets[p].search} ${c.location} ${g.keywords}`.trim(),
    score: Math.max(50, (i < 2 ? 85 : 75) - i * 3),
  }));
}

/** Search pages the user opens themselves. Only campaign keywords are included. */
export function searchLinks(c: Campaign, profession = "") {
  const g = glossConfig(c);
  const who = profession || g.professions[0] || "makeup artist";
  const city = c.location.split(",")[0].trim();
  const q = [who, city, g.keywords].filter(Boolean).join(" ");
  const e = encodeURIComponent;
  const tag = (city + who).toLowerCase().replace(/[^a-z0-9]/g, "");
  const all: { platform: Platform; label: string; url: string }[] = [
    { platform: "Instagram", label: "Instagram profiles (web search)", url: `https://www.google.com/search?q=${e(`site:instagram.com ${q}`)}` },
    { platform: "Instagram", label: `Instagram #${tag}`, url: `https://www.instagram.com/explore/tags/${tag}/` },
    { platform: "YouTube", label: "YouTube search", url: `https://www.youtube.com/results?search_query=${e(q)}` },
    { platform: "TikTok", label: "TikTok search", url: `https://www.tiktok.com/search?q=${e(q)}` },
    { platform: "LinkedIn", label: "LinkedIn people search", url: `https://www.linkedin.com/search/results/people/?keywords=${e(q)}` },
    { platform: "Facebook", label: "Facebook search", url: `https://www.facebook.com/search/top/?q=${e(q)}` },
    { platform: "Website", label: "Portfolio websites (web search)", url: `https://www.google.com/search?q=${e(q + " portfolio")}` },
  ];
  const wanted = new Set<Platform>(["Instagram", ...g.platforms]);
  return all.filter((l) => wanted.has(l.platform));
}

type CreatorInput = {
  name: string;
  location: string;
  website: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  tags: string;
  creator: Partial<Creator> & { followers?: number | null };
};
/** Validates and normalizes a creator. Throws a readable error when invalid. */
export function newCreatorLead(campaign: Campaign, input: CreatorInput, origin = "Added manually"): Lead {
  if (!isGloss(campaign))
    throw new Error("Choose a Gloss creator or professional campaign first.");
  const name = input.name.trim();
  if (!name) throw new Error("Add the creator's name.");
  const raw: Creator = {
    ...emptyCreator(),
    ...Object.fromEntries(
      Object.entries(input.creator).filter(([, v]) => v !== undefined),
    ),
  };
  const handle = raw.instagram.trim() ? normalizeHandle(raw.instagram) : "";
  if (raw.instagram.trim() && !handle)
    throw new Error("Enter a valid Instagram handle, e.g. @studio.name.");
  const igUrl = raw.instagramUrl.trim() ? profileUrl("Instagram", raw.instagramUrl) : "";
  if (raw.instagramUrl.trim() && !igUrl)
    throw new Error("Instagram URL must be an https://instagram.com/ profile link.");
  const urlHandle = igUrl ? normalizeHandle(igUrl) : "";
  if (handle && urlHandle && handle !== urlHandle)
    throw new Error("Instagram handle and Instagram URL point to different profiles.");
  const creator: Creator = {
    ...raw,
    profession: raw.profession.trim(),
    instagram: handle || urlHandle,
    instagramUrl: igUrl || instagramUrl(handle),
    photoUrl: "",
  };
  for (const p of ["TikTok", "YouTube", "LinkedIn", "Facebook"] as const) {
    const v = raw[urlField[p]].trim();
    creator[urlField[p]] = v ? profileUrl(p, v) : "";
    if (v && !creator[urlField[p]])
      throw new Error(`${p} URL must be an https link on ${p}'s own website.`);
  }
  const website = input.website.trim() ? profileUrl("Website", input.website) : "";
  if (input.website.trim() && !website)
    throw new Error("Website / portfolio must be a full http:// or https:// address.");
  if (raw.photoUrl.trim()) {
    creator.photoUrl = profileUrl("Website", raw.photoUrl);
    if (!creator.photoUrl) throw new Error("Profile photo must be an https image URL.");
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    throw new Error("Enter a valid email address.");
  if (creator.followers !== null && (!Number.isSafeInteger(creator.followers) || creator.followers < 0))
    throw new Error("Followers must be a whole number.");
  const allowed = allowedPartnerships(campaign);
  if (!input.creator.partnership) creator.partnership = allowed[0];
  else if (!allowed.includes(creator.partnership))
    throw new Error(`${creator.partnership} leads belong in a ${creator.partnership === "Creator Partner" ? "Creator Partners" : "Professional Prospects"} campaign.`);
  const draft: Lead = {
    id: uid(),
    campaignId: campaign.id,
    name: name.slice(0, 300),
    industry: creator.profession || "Creator",
    location: input.location.trim(),
    website,
    email: input.email.trim(),
    phone: input.phone.trim(),
    source: "",
    sourceLabel: "",
    discoveredAt: now(),
    score: 0,
    reason: "",
    missing: "",
    stage: "New",
    notes: input.notes,
    tags: input.tags,
    followUp: "",
    contactedAt: "",
    demo: false,
    history: [{ at: now(), event: `Creator ${origin.toLowerCase()}` }],
    kind: "creator",
    creator,
    checkedAt: "",
    sourceVerifiedAt: "",
    scope: "" as const,
  };
  if (!profileLinks(draft).length)
    throw new Error("Add at least one public profile: Instagram, TikTok, YouTube, LinkedIn, Facebook or a website.");
  const source = input.source.trim() ? safeUrl(input.source) : "";
  if (input.source.trim() && !source)
    throw new Error("Source must be a full http or https link.");
  draft.source = source || primaryProfile(draft)!.url;
  draft.sourceLabel = `${origin} · public profile, verify before outreach`;
  return { ...draft, ...assessCreatorFit(draft, campaign) };
}

const headerAliases: Record<string, string> = {
  instagram_handle: "instagram",
  handle: "instagram",
  primary_contact_platform: "platform",
  primary_platform: "platform",
  website_portfolio: "website",
  portfolio: "website",
  source_url: "source",
  partnership_type: "partnership",
  partnership: "partnership",
  profile_photo: "photo_url",
  photo: "photo_url",
};
const key = (h: string) => {
  const k = h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return headerAliases[k] || k;
};
/** Maps one parsed CSV row (including exported Excel headers) to a creator lead. */
export function creatorFromRecord(record: Record<string, string>, campaign: Campaign, row: number) {
  const r: Record<string, string> = {};
  for (const [h, v] of Object.entries(record)) r[key(h)] = v ?? "";
  const followers = parseFollowers(r.followers);
  try {
    if (followers === undefined) throw new Error("Followers must be a number such as 12500 or 12.5K.");
    const platform = platforms.find((p) => p.toLowerCase() === (r.platform || "").trim().toLowerCase());
    if (r.platform?.trim() && !platform) throw new Error(`Platform must be one of ${platforms.join(", ")}.`);
    const partnership = partnershipTypes.find((p) => p.toLowerCase() === (r.partnership || "").trim().toLowerCase());
    if (r.partnership?.trim() && !partnership) throw new Error(`Partnership must be one of ${partnershipTypes.join(", ")}.`);
    return newCreatorLead(
      campaign,
      {
        name: r.name || "",
        location: r.location || "",
        website: r.website || "",
        email: r.email || "",
        phone: r.phone || "",
        source: r.source || "",
        notes: r.notes || "",
        tags: r.tags || "",
        creator: {
          profession: r.profession || "",
          platform: platform || (r.instagram || r.instagram_url ? "Instagram" : undefined),
          instagram: r.instagram || "",
          instagramUrl: r.instagram_url || "",
          tiktokUrl: r.tiktok_url || r.tiktok || "",
          youtubeUrl: r.youtube_url || r.youtube || "",
          linkedinUrl: r.linkedin_url || r.linkedin || "",
          facebookUrl: r.facebook_url || r.facebook || "",
          followers,
          engagement: r.engagement || "",
          partnership,
          photoUrl: r.photo_url || "",
        },
      },
      "Imported from CSV",
    );
  } catch (e) {
    throw new Error(`Row ${row}: ${e instanceof Error ? e.message : "invalid creator"}`);
  }
}
export const creatorImportColumns =
  "name,profession,location,platform,instagram_handle,instagram_url,tiktok_url,youtube_url,linkedin_url,facebook_url,website,email,phone,followers,engagement,partnership_type,source_url,photo_url,tags,notes";

/**
 * Neutralizes spreadsheet formulas while keeping plain Instagram handles
 * such as @studio.name intact.
 */
export function safeSpreadsheetText(value: unknown) {
  const s = String(value ?? "");
  if (/^@[A-Za-z0-9._]{1,30}$/.test(s)) return s;
  // Plain phone numbers (digits, spaces and + - ( ) .) cannot carry a formula.
  if (/^\+?[\d\s().-]{6,24}$/.test(s) && /\d{3}/.test(s) && !/[-+]\s*$/.test(s)) return s;
  return /^\s*[=+\-@]|^[\t\r\n]/.test(s) ? "'" + s : s;
}
export const exportColumns = [
  "Name", "Profession", "Location", "Instagram Handle", "Instagram URL",
  "Primary Contact Platform", "TikTok URL", "YouTube URL", "LinkedIn URL",
  "Facebook URL", "Website / Portfolio", "Followers", "Engagement",
  "Gloss Fit Score", "Fit Reasons", "Lead Type", "Partnership Type",
  "Source URL", "Outreach Status", "Last Contacted", "Follow-up Date", "Notes",
  "Email", "Phone", "Category", "Source Name", "Discovery Area", "Last Verified",
  "Last Source Check",
] as const;
export const exportWidths = [24, 20, 20, 20, 36, 14, 30, 30, 30, 30, 30, 12, 12, 10, 60, 14, 16, 36, 16, 14, 14, 40, 26, 18, 20, 36, 14, 14, 14];
const tierLabels: Record<string, string> = {
  locality: "Locality", city: "City", state: "State", country: "Country", global: "Global",
};
/** Most recent verification: a manual profile check or the source's own date. */
export function lastVerified(l: Lead) {
  return [l.creator?.verifiedAt || "", l.sourceVerifiedAt].sort().at(-1) || "";
}
export function creatorRows(leads: Lead[]): (string | number | null)[][] {
  const t = safeSpreadsheetText;
  return [
    [...exportColumns],
    ...leads.map((l) => {
      const c = l.creator ?? emptyCreator();
      const creator = l.kind === "creator";
      return [
        t(l.name), t(c.profession || (creator ? l.industry : "")), t(l.location),
        displayHandle(c.instagram), t(c.instagramUrl || instagramUrl(c.instagram)),
        t(l.creator ? c.platform : ""), t(c.tiktokUrl), t(c.youtubeUrl), t(c.linkedinUrl), t(c.facebookUrl),
        t(l.website), c.followers, t(c.engagement), l.score, t(l.reason),
        creator ? "Creator" : "Business", creator ? t(c.partnership) : "",
        t(l.source), t(stageLabel(l)), l.contactedAt.slice(0, 10), l.followUp, t(l.notes),
        t(l.email), t(l.phone), t(l.industry), t(l.sourceLabel), tierLabels[l.scope] || "",
        lastVerified(l), l.checkedAt,
      ];
    }),
  ];
}
export function creatorCSV(leads: Lead[]) {
  return creatorRows(leads)
    .map((row) => row.map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"').join(","))
    .join("\r\n");
}

const firstName = (lead: Lead) =>
  lead.kind === "creator" ? lead.name.trim().split(/\s+/)[0] : `${lead.name} team`;
const plural = (p: string) =>
  !p ? "professionals" : /s$/i.test(p) ? p.toLowerCase() : p.toLowerCase().replace(/ \/ .*/, "") + "s";
export function offerLine(g: Gloss) {
  if (g.offerMode === "Omit" || !g.offer.trim()) return "";
  return g.offerMode === "Proposed"
    ? `Our proposed launch offer is ${g.offer.trim()} (proposed pricing, not final yet).`
    : `The current offer is ${g.offer.trim()}.`;
}
/** Draft-only Gloss templates. They never promise income, work, bookings or results. */
export function glossDraft(
  lead: Lead,
  campaign: Campaign,
  channel: Draft["channel"],
  tone: string,
  sender: string,
) {
  const g = glossConfig(campaign);
  const c = lead.creator ?? emptyCreator();
  const partnership: Partnership =
    lead.kind === "creator" ? c.partnership : "Starter Prospect";
  const creatorPitch = partnership !== "Starter Prospect";
  const profession = (c.profession || lead.industry || "creative").toLowerCase();
  const hello = tone === "Formal" ? `Hello ${firstName(lead)},` : `Hi ${firstName(lead)},`;
  const where = lead.kind === "creator" && c.platform !== "Website" ? ` on ${c.platform}` : "";
  const intro = `I’m ${sender} from Gloss.`;
  const about =
    "Gloss helps beauty, creative and hospitality professionals turn their experience into a polished resume and a branded enquiry link they can share.";
  const terms = g.commission.trim()
    ? `The proposed partner terms are ${g.commission.trim()}; anything we agree would be confirmed in writing first.`
    : "We would agree any partnership terms with you before anything is shared.";
  const offer = offerLine(g);
  const question =
    tone === "Concise"
      ? "Would you be open to hearing more?"
      : tone === "Formal"
        ? "Would you be open to a brief conversation to explore whether this could be a suitable fit? There is no obligation."
        : "Would you be open to a short chat to see whether it’s a good fit? No obligation at all.";
  const signoff = channel === "Email" ? "Best," : "Thanks,";
  if (channel === "Phone")
    return {
      subject: creatorPitch ? "Gloss creator partnership call" : "Gloss introduction call",
      body: `Opening: ${hello} ${intro}\n\nContext: ${about}\n\n${creatorPitch ? `Ask: We’re speaking with a few creators about sharing Gloss with professionals in their audience. ${terms}` : `Ask: Would a resume and enquiry link be useful for your ${profession} work?${offer ? " " + offer : ""}`}\n\nListen: How do clients or collaborators find you today?\n\nClose: Agree on a next step only if there is interest.`,
    };
  if (channel === "Follow-up")
    return {
      subject: "Following up from Gloss",
      body: `${hello}\n\nFollowing up on my earlier note about ${creatorPitch ? "a possible Gloss creator partnership" : "Gloss"}. ${question}\n\n${signoff}\n${sender}`,
    };
  if (creatorPitch) {
    const both =
      partnership === "Both"
        ? ` You’re also welcome to try Gloss for your own ${profession} work.${offer ? " " + offer : ""}`
        : "";
    if (channel === "Instagram DM" || channel === "WhatsApp")
      return {
        subject: "",
        body: `${hello} ${intro} I came across your ${profession} work${where} and liked how you present it. Gloss helps professionals share a polished resume and enquiry link. We’re exploring a few creator partnerships. ${terms}${both} ${question}`,
      };
    return {
      subject: `Gloss × ${lead.name.slice(0, 60)}: a possible creator partnership`,
      body: `${hello}\n\n${intro} I came across your ${profession} work${where} and liked how you present it.\n\n${about}\n\nWe’re speaking with a small number of creators about sharing Gloss with professionals in their audience. ${terms}${both}\n\n${question}\n\n${signoff}\n${sender}`,
    };
  }
  const audience = `How many enquiries you receive depends on your own clients and audience.`;
  if (channel === "Instagram DM" || channel === "WhatsApp")
    return {
      subject: "",
      body: `${hello} ${intro} Gloss gives ${plural(c.profession || lead.industry)} a polished resume and a branded link where clients can send enquiries.${offer ? " " + offer : ""} ${question}`,
    };
  return {
    subject: `A polished resume and enquiry link for your ${profession} work`,
    body: `${hello}\n\n${intro} ${about} The same link can be shared on Instagram, WhatsApp or email.\n\n${offer ? offer + "\n\n" : ""}${audience}\n\n${question}\n\n${signoff}\n${sender}`,
  };
}
/** Gloss campaigns and creator leads use Gloss templates; everything else is unchanged. */
export function outreachDraft(
  lead: Lead,
  campaign: Campaign,
  channel: Draft["channel"],
  tone: string,
  sender: string,
) {
  return lead.kind === "creator" || isGloss(campaign)
    ? glossDraft(lead, campaign, channel, tone, sender)
    : templateDraft(lead, campaign, channel, tone, sender);
}
export const glossAIRules =
  "Gloss rules: drafts are for manual review and are never sent automatically. Do not promise or imply guaranteed income, jobs, bookings, enquiries, conversions or results. Mention commission or partner terms only if campaign.gloss.commission is non-empty, using that wording. Mention the Starter offer only when campaign.gloss.offerMode is not Omit; when it is Proposed, label the offer as proposed and not final. Instagram DM and WhatsApp drafts must be short, with an empty subject. Do not invent follower counts, collaborations or facts about the person.";
