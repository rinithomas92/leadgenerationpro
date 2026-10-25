// Custom lead projects: building projects and their leads. Rule-based only;
// nothing here calls an AI service or a paid API.
import {
  customLeadSchema,
  customProjectSchema,
  defaultSplits,
  tiers as tierOrder,
  type CustomLead,
  type CustomProject,
  type Segment,
  type Tier,
} from "./project-schema.ts";
import { localDate, newCampaign, now, safeUrl, uid, type Campaign, type Lead } from "./leadgen.ts";
import { normalizePhone } from "./phone.ts";

export const defaultSplit = (n: number) => defaultSplits[n] ?? [];

// ---------- Wizard rules ----------
export function briefErrors(b: { name: string; description: string; website: string }) {
  const errors: Record<string, string> = {};
  if (!b.name.trim()) errors.name = "Give the project a name.";
  else if (b.name.trim().length > 80) errors.name = "Keep the name under 80 characters.";
  const d = b.description.trim().length;
  if (d < 20) errors.description = "Describe the business in at least 20 characters (2–3 lines).";
  else if (d > 400) errors.description = "Keep the description under 400 characters.";
  if (b.website.trim() && !safeUrl(b.website.trim())) errors.website = "Use a full address such as https://example.com.";
  return errors;
}
export function segmentErrors(segments: Segment[]) {
  const errors: string[] = [];
  if (!segments.length) errors.push("Add at least one kind of lead.");
  if (segments.length > 20) errors.push("Use at most 20 segments.");
  const labels = segments.map((s) => s.label.trim().toLowerCase());
  segments.forEach((s, i) => {
    if (!s.label.trim()) errors.push(`Segment ${i + 1} needs a label.`);
    else if (labels.indexOf(labels[i]) !== i) errors.push(`“${s.label}” is listed twice.`);
    if (!s.categories.length) errors.push(`Confirm at least one category for “${s.label || `segment ${i + 1}`}”.`);
  });
  return errors;
}
/** Tier rules: Locality needs a locality; Global needs countries other than the home country. */
export function tierErrors(p: { tiers: Tier[]; countries: string[] }, hasLocality: boolean, home = "IN") {
  const errors: string[] = [];
  if (!p.tiers.length) errors.push("Pick at least one reach tier.");
  if (p.tiers.includes("locality") && !hasLocality) errors.push("Locality needs a location that names a locality, such as “Baner, Pune”.");
  if (p.tiers.includes("global") && !p.countries.filter((c) => c !== home).length)
    errors.push("Global needs at least one country. The whole world is never searched, and your own country has its own tier.");
  return errors;
}
/** Global never includes the home country, which has its own tier. */
export const globalCountries = (countries: string[], home = "IN") => [...new Set(countries.filter((c) => /^[A-Z]{2}$/.test(c) && c !== home))];
export function splitErrors(split: number[], tiers: number) {
  if (split.length !== tiers) return "Give every selected tier a percentage.";
  if (split.some((v) => v % 5 || v < 0)) return "Use steps of 5%.";
  const total = split.reduce((a, b) => a + b, 0);
  return total === 100 ? "" : `The split must total 100% (now ${total}%).`;
}

const stopwords = new Set(
  ("a an and are as at be been but by for from has have help helps i in into is it its of on or our that the their them they this to us we with you your " +
    "who what which will can also all any more most other some such than then there these those very just about across after before being both each few how " +
    "offer offers offering provide provides providing service services business company based work working make making best quality " +
    // Common Hinglish filler words.
    "aur hai hain ke ki ka ko mein se par bhi ye yeh wo").split(" "),
);
/** Keywords from the business description (simple stopword removal; no AI). */
export function descriptionKeywords(description: string, limit = 10) {
  const counts = new Map<string, number>();
  for (const w of description.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[\p{L}][\p{L}\p{N}-]+/gu) ?? [])
    if (w.length >= 3 && !stopwords.has(w) && !/^\d/.test(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

// Open place data lists businesses and organisations, never private people.
const privateTerms: [RegExp, string[]][] = [
  [/\bstudents?\b/, ["coaching institutes", "colleges", "schools", "hostels", "libraries"]],
  [/\bparents?\b/, ["schools", "preschools", "daycare centres", "children's activity centres"]],
  [/\bhome ?owners?\b|\bhome buyers?\b/, ["housing societies", "real estate developers", "real estate agents"]],
  [/\bcustomers?\b|\bclients?\b|\bconsumers?\b|\bbuyers?\b/, ["the businesses your customers already use"]],
  [/\bpeople\b|\bpublic\b|\bindividuals?\b|\bpersons?\b/, ["clubs", "community centres", "gyms", "cafés"]],
  [/\bpatients?\b/, ["clinics", "hospitals", "pharmacies"]],
  [/\b(employees?|professionals?|workers?)\b/, ["companies", "co-working spaces", "business parks"]],
  [/\b(women|men|kids|children|youth|seniors?|elderly)\b/, ["salons", "schools", "gyms", "senior care homes"]],
  [/\btenants?\b|\brenters?\b/, ["PG accommodation", "hostels", "property managers"]],
  [/\btravell?ers?\b|\btourists?\b/, ["hotels", "guest houses", "travel agents"]],
];
/** A warning and business stand-ins when a segment names private individuals. */
const businessWords =
  /\b(stores?|shops?|salons?|clinics?|schools?|cent(re|er)s?|studios?|agenc(y|ies)|firms?|offices?|hotels?|caf[eé]s?|restaurants?|compan(y|ies)|institutes?|colleges?|academ(y|ies)|gyms?|hospitals?|showrooms?|boutiques?|developers?|societ(y|ies)|hostels?|clubs?|associations?|organi[sz]ations?|brands?|makers?|manufacturers?|suppliers?|dealers?)\b/;
export function privateIndividualWarning(label: string) {
  const l = label.toLowerCase();
  const hit = privateTerms.find(([re]) => re.test(l));
  // "Women's clothing stores" names a business; "college students" does not.
  const at = hit ? l.search(hit[0]) : -1;
  if (at >= 0 && businessWords.test(l.slice(at + 1))) return undefined;
  return hit
    ? { message: `Open place data lists businesses, not private individuals, so “${label.trim()}” cannot be found directly. Try places that serve them instead.`, standIns: hit[1] }
    : undefined;
}

/** A new custom lead project; validated so it is ready to save. */
export function newCustomCampaign(input: {
  name: string;
  description: string;
  website?: string;
  location: string;
  project: Partial<CustomProject> & Pick<CustomProject, "segments" | "tiers">;
}): Campaign {
  const ordered = tierOrder.filter((t) => input.project.tiers.includes(t));
  const custom = customProjectSchema.parse({
    ...input.project,
    tiers: ordered,
    split: input.project.split ?? defaultSplit(ordered.length),
  });
  return {
    ...newCampaign(5, input.description),
    name: input.name,
    description: input.description,
    website: input.website ?? "",
    location: input.location,
    channels: ["WhatsApp", "Email", "Instagram DM", "Phone"],
    custom,
  };
}

export type ProjectLeadInput = {
  name: string;
  segmentId: string;
  tier: Tier;
  // The source record: e.g. { name: "Overture Maps", id: "ov:08f…", url: "" }.
  source: { name: string; id: string; url: string; label?: string };
  category?: string;
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  creator?: Lead["creator"];
  checkedAt?: string;
  sourceVerifiedAt?: string;
  project?: Partial<CustomLead>;
};
const clip = (s: string | undefined) => (s ?? "").trim().slice(0, 300);
/** A URL that fits the 300-character field: tracking query and fragment go first, then the path. */
export function fitUrl(raw: string | undefined) {
  const url = safeUrl((raw ?? "").trim());
  if (!url || url.length <= 300) return url;
  const u = new URL(url);
  const short = u.origin + u.pathname;
  return short.length <= 300 ? short : u.origin.slice(0, 300);
}
/** A lead found by discovery for a project. Every lead keeps its source id and link. */
export function projectLead(campaign: Campaign, input: ProjectLeadInput): Lead {
  const country = input.project?.country || campaign.custom?.base.country?.code || "IN";
  const phone = normalizePhone(input.phone ?? "", country);
  const p = input.project ?? {};
  const project = customLeadSchema.parse({
    ...p,
    address: clip(p.address),
    locality: clip(p.locality),
    city: clip(p.city),
    region: clip(p.region),
    country: clip(p.country),
    categories: (p.categories ?? []).slice(0, 20).map(clip),
    segmentId: input.segmentId,
    tier: input.tier,
    dedupeKey: input.project?.dedupeKey || input.source.id,
    sourceIds: [...new Set([input.source.id, ...(input.project?.sourceIds ?? [])])],
    sources: input.project?.sources ?? [{ name: input.source.name, url: input.source.url, id: input.source.id }],
    phoneE164: phone?.e164 ?? "",
    phoneType: phone?.type ?? "",
  });
  return {
    id: uid(),
    campaignId: campaign.id,
    name: input.name.trim().slice(0, 300),
    industry: (input.category ?? "").slice(0, 300),
    location: (input.location ?? "").slice(0, 300),
    website: fitUrl(input.website),
    email: input.email && input.email.length <= 300 ? input.email.trim() : "",
    // Shown in the international format when the number is valid.
    phone: phone?.display ?? (input.phone ?? "").slice(0, 300),
    source: input.source.url,
    sourceLabel: input.source.label ?? input.source.name,
    discoveredAt: now(),
    score: 0,
    reason: "",
    missing: "Contact details come from public sources and are not independently verified.",
    stage: "New",
    notes: "",
    tags: "",
    followUp: "",
    contactedAt: "",
    demo: false,
    history: [{ at: now(), event: `Discovered via ${input.source.name}` }],
    kind: "business",
    creator: input.creator,
    checkedAt: input.checkedAt ?? localDate(),
    sourceVerifiedAt: input.sourceVerifiedAt ?? "",
    scope: input.tier,
    project,
  };
}
