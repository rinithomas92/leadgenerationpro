import { z } from "zod";
import { leadSchema, type Campaign, type Lead } from "./leadgen.ts";
import { normalizeName, registrableDomain } from "./dedupe.ts";
import { normalizePhone } from "./phone.ts";

export const PLACE_POLICY = "2026-11-15-v1";
export const placeCategories = {
  Hotels: { key: "tourism", values: ["hotel", "guest_house"] },
  Salons: { key: "shop", values: ["hairdresser", "beauty"] },
  Colleges: { key: "amenity", values: ["college", "university"] },
  "Aviation academies": { key: "amenity", values: ["flight_school"] },
  "Hospitality institutes": { key: "amenity", values: ["college", "training"] },
  Restaurants: { key: "amenity", values: ["restaurant", "cafe"] },
} as const;
export const providerSchema = z.enum(["osm", "google", "apple"]);
export type PlaceProvider = z.infer<typeof providerSchema>;
export const providerNames = { osm: "OpenStreetMap", google: "Google Maps", apple: "Apple Maps" };
const short = z.string().trim().max(300);
export const publicUrl = (value: string) => {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes(".") || /(^|\.)(localhost|local|internal|test)$/.test(u.hostname)) return "";
    if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) return "";
    return u.href;
  } catch { return ""; }
};
const url = short.refine(v => !v || !!publicUrl(v), "Use a public http or https URL.");
export const areaSchema = z.object({
  label: short.min(1), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  areaId: z.number().int().positive().optional(),
});
export const searchSchema = z.object({
  id: z.string().uuid(), title: short.min(1), category: z.enum(Object.keys(placeCategories) as [keyof typeof placeCategories, ...(keyof typeof placeCategories)[]]),
  keyword: z.string().trim().max(80).default(""), provider: providerSchema, area: areaSchema,
  scope: z.enum(["radius", "area"]).default("radius"), radiusKm: z.number().min(1).max(50).default(3),
  campaignId: short.default(""),
}).refine(s => s.scope !== "area" || (s.provider === "osm" && !!s.area.areaId), "Administrative boundaries are supported by OpenStreetMap only. Choose a boundary or use a radius.");
export type PlaceSearch = z.infer<typeof searchSchema>;
export type PlaceResult = {
  id: string; provider: PlaceProvider; name: string; category: string; address: string;
  website: string; email: string; phone: string; source: string; lat?: number; lon?: number; checkedAt: string;
  attributions?: { name: string; url: string }[];
};
export const evidenceFields = ["name", "category", "address", "website", "email", "phone"] as const;
export const evidenceSchema = z.object({
  value: short, sourceUrl: url, source: z.enum(["official", "owned", "osm"]),
  checkedAt: z.string().datetime(), status: z.enum(["Not found", "Published", "Manually confirmed", "Needs review", "Invalid"]),
});
export const contactSchema = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative().default(0),
  fields: z.object(Object.fromEntries(evidenceFields.map(f => [f, evidenceSchema])) as Record<typeof evidenceFields[number], typeof evidenceSchema>),
  purpose: z.enum(["General office", "Admissions", "Placements", "Partnerships", "Other"]).default("General office"),
  notes: z.string().max(3000).default(""),
  attested: z.literal(true), archived: z.boolean().default(false),
  origin: z.enum(["independent", "osm"]), resultId: short.default(""), runId: short.default(""),
}).superRefine((c, ctx) => {
  for (const key of evidenceFields) {
    const f = c.fields[key];
    if (f.value && !f.sourceUrl) ctx.addIssue({ code: "custom", path: ["fields", key], message: `${key}: add an evidence URL.` });
    if (f.value && /(^|\.)(google\.[a-z.]+|apple\.com|maps\.apple\.com)$/.test((() => { try { return new URL(f.sourceUrl).hostname; } catch { return ""; } })())) ctx.addIssue({ code: "custom", message: "Map-provider results cannot be relabeled as independent evidence." });
    if (Date.parse(f.checkedAt) > Date.now() + 60_000) ctx.addIssue({ code: "custom", message: "Evidence date cannot be in the future." });
  }
  if (!c.fields.name.value) ctx.addIssue({ code: "custom", message: "A contact name is required." });
  if (c.fields.website.value && !publicUrl(c.fields.website.value)) ctx.addIssue({ code: "custom", message: "Invalid website." });
  if (c.fields.email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.fields.email.value)) ctx.addIssue({ code: "custom", message: "Invalid email format." });
  if (c.fields.phone.value && !normalizePhone(c.fields.phone.value)) ctx.addIssue({ code: "custom", message: "Enter a valid phone number including country code." });
});
export type PlaceContact = z.infer<typeof contactSchema>;
export type PlaceRun = { id: string; search: PlaceSearch; status: string; count: number; message: string; createdAt: string; updatedAt: string; results: PlaceResult[] };
export type ProviderStatus = { id: PlaceProvider; name: string; enabled: boolean; reason: string; cap: number; used: number; period: string; checkedAt: string; operations?: { operation: string; count: number }[] };
export type PlacesSnapshot = { searches: PlaceSearch[]; runs: PlaceRun[]; contacts: PlaceContact[]; blocked: string[]; providers: ProviderStatus[]; audit: { action: string; at: string; subject: string }[] };
export function contactLead(c: PlaceContact, campaignId: string, id: string): Lead {
  const v = (k: typeof evidenceFields[number]) => ["Published", "Manually confirmed"].includes(c.fields[k].status) ? c.fields[k].value : "";
  return leadSchema.parse({ id, campaignId, name: c.fields.name.value, industry: v("category"), location: v("address"), website: v("website"), email: v("email"), phone: v("phone"), source: c.fields.name.sourceUrl, sourceLabel: c.origin === "osm" ? "OpenStreetMap contributors · ODbL" : "Independent contact evidence", discoveredAt: new Date().toISOString(), checkedAt: c.fields.name.checkedAt, score: 0, reason: "Reviewed in Places Discovery; no buying intent inferred.", missing: [!v("website") && "Website", !v("email") && "Email", !v("phone") && "Phone"].filter(Boolean).join(", "), stage: "New", notes: `${c.notes}\nContact purpose: ${c.purpose}\nEvidence:\n${evidenceFields.filter(k=>c.fields[k].value).map(k=>`${k}: ${c.fields[k].sourceUrl} (${c.fields[k].checkedAt})`).join("\n")}`, tags: "Places Discovery", followUp: "", contactedAt: "", demo: false, history: [{ at: new Date().toISOString(), event: "Qualified in Places Discovery" }] });
}
export function campaignEligible(c: Campaign) { return !c.demo && c.status === "Active" && c.audience !== "Creator Partners" && !c.custom; }
export function duplicatePlaces(a: Pick<Lead,"name"|"location"|"website"|"phone">, b: Pick<Lead,"name"|"location"|"website"|"phone">) {
  const sameAddress = !!a.location && normalizeName(a.location) === normalizeName(b.location);
  const phone = normalizePhone(a.phone)?.e164;
  return (!!phone && phone === normalizePhone(b.phone)?.e164) || (sameAddress && (normalizeName(a.name) === normalizeName(b.name) || (!!a.website && registrableDomain(a.website) === registrableDomain(b.website))));
}
export function placesCSV(contacts: PlaceContact[]) {
  const cell = (v: string) => '"' + (/^[\s]*[=+@-]/.test(v) ? "'" : "") + v.replaceAll('"','""') + '"';
  const rows = [["Name", "Category", "Address", "Website", "Email", "Phone", "Contact purpose", ...evidenceFields.flatMap(f=>[`${f} evidence`, `${f} checked`, `${f} status`]), "Attribution"]];
  for (const c of contacts) rows.push([...evidenceFields.map(f=>["Published","Manually confirmed"].includes(c.fields[f].status)?c.fields[f].value:""), c.purpose, ...evidenceFields.flatMap(f=>[c.fields[f].sourceUrl,c.fields[f].checkedAt,c.fields[f].status]), c.origin === "osm" ? "© OpenStreetMap contributors; ODbL https://www.openstreetmap.org/copyright" : "Independent evidence"]);
  return "\ufeff" + rows.map(r=>r.map(cell).join(",")).join("\r\n");
}
