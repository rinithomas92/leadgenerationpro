// Outreach templates for custom lead projects. Rule-based placeholder filling
// (no AI); drafts are text only and nothing is ever sent automatically.
// Syntax: {placeholder}, {placeholder|fallback}, and {{ / }} for literal braces.
import { uid, now, type Lead } from "./leadgen.ts";
import { canWhatsApp, telLink, waLink } from "./phone.ts";
import { readableCategory } from "./categories.ts";
import type { CustomProject, ProjectTemplate, TemplateChannel } from "./project-schema.ts";

export const placeholders = {
  business_name: "The lead's name",
  segment: "The lead's segment label",
  category: "The lead's main category",
  area: "The lead's locality, or its city",
  city: "The lead's city",
  state: "The lead's state",
  country: "The lead's country",
  distance_km: "Distance from your base location, rounded",
  website: "The lead's website",
  my_name: "Your name (sender profile)",
  my_business: "Your business name",
  my_pitch: "Your one-line pitch",
  my_website: "Your website",
  my_phone: "Your phone",
  offer: "Your offer (optional)",
  cta: "Your call to action",
} as const;
export type Placeholder = keyof typeof placeholders;
const known = new Set(Object.keys(placeholders));

type Token = { kind: "text"; value: string } | { kind: "field"; name: string; fallback?: string; raw: string };
/** Splits a template into text and placeholders; reports syntax errors instead of guessing. */
export function parseTemplate(src: string): { tokens: Token[]; errors: string[] } {
  const tokens: Token[] = [];
  const errors: string[] = [];
  let text = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" && src[i + 1] === "{") {
      text += "{";
      i++;
    } else if (ch === "}" && src[i + 1] === "}") {
      text += "}";
      i++;
    } else if (ch === "{") {
      const end = src.indexOf("}", i + 1);
      const next = src.indexOf("{", i + 1);
      if (end < 0 || (next >= 0 && next < end)) {
        errors.push(`Unclosed “{” near “${src.slice(i, i + 20)}”. Use {{ for a literal brace.`);
        text += ch;
        continue;
      }
      const raw = src.slice(i, end + 1);
      const inner = src.slice(i + 1, end);
      const bar = inner.indexOf("|");
      const name = (bar < 0 ? inner : inner.slice(0, bar)).trim();
      if (text) tokens.push({ kind: "text", value: text });
      text = "";
      tokens.push({ kind: "field", name, fallback: bar < 0 ? undefined : inner.slice(bar + 1), raw });
      i = end;
    } else if (ch === "}") {
      errors.push("A lone “}”. Use }} for a literal brace.");
      text += ch;
    } else text += ch;
  }
  if (text) tokens.push({ kind: "text", value: text });
  return { tokens, errors };
}
/** Unknown placeholders (usually typos) and syntax errors, for flagging while editing. */
export function lintTemplate(src: string) {
  const { tokens, errors } = parseTemplate(src);
  const unknown = [...new Set(tokens.filter((t) => t.kind === "field" && !known.has(t.name)).map((t) => (t as { name: string }).name))];
  return { unknown, errors };
}

export type Context = Partial<Record<Placeholder, string>>;
export type Rendered = { text: string; missing: string[]; unknown: string[]; errors: string[] };
/**
 * Fills a template. A placeholder with no value uses its fallback; without one
 * it is reported as missing (and shown as [name] in the preview). A line made
 * only of placeholders that came out empty is dropped, so an unset {offer|}
 * leaves no blank line behind.
 */
export function render(src: string, ctx: Context): Rendered {
  const { tokens, errors } = parseTemplate(src);
  const missing = new Set<string>();
  const unknown = new Set<string>();
  let out = "";
  const emptied: number[] = [];
  let line = 0;
  let lineHasText = false, lineHadField = false, lineValue = "";
  const endLine = () => {
    if (lineHadField && !lineHasText && !lineValue.trim()) emptied.push(line);
    line++;
    lineHasText = lineHadField = false;
    lineValue = "";
  };
  for (const t of tokens) {
    if (t.kind === "text") {
      const parts = t.value.split("\n");
      parts.forEach((p, k) => {
        if (k > 0) endLine();
        if (p.trim()) lineHasText = true;
        lineValue += p;
      });
      out += t.value;
      continue;
    }
    lineHadField = true;
    let value: string;
    if (!known.has(t.name)) {
      unknown.add(t.name);
      value = t.raw;
    } else {
      const v = (ctx[t.name as Placeholder] ?? "").trim();
      if (v) value = v;
      else if (t.fallback !== undefined) value = t.fallback;
      else {
        missing.add(t.name);
        value = `[${t.name}]`;
      }
    }
    lineValue += value;
    out += value;
  }
  endLine();
  const lines = out.split("\n").filter((_, i) => !emptied.includes(i));
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), missing: [...missing], unknown: [...unknown], errors };
}
export const canSend = (r: Rendered) => !r.missing.length && !r.unknown.length && !r.errors.length;

const regionNames = (code: string) => {
  try {
    return code.length === 2 ? new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code : code;
  } catch {
    return code;
  }
};
/** Placeholder values for one lead and the project's sender profile. */
export function contextFor(lead: Lead, project: CustomProject): Context {
  const p = lead.project;
  const s = project.sender;
  const seg = project.segments.find((x) => x.id === p?.segmentId);
  // Overture writes Indian states as codes ("MH"); the base state's name reads better.
  const state = p?.region && project.base.state && p.region === project.base.state.code ? project.base.state.name : p?.region ?? "";
  return {
    business_name: lead.name,
    segment: seg?.label ?? "",
    category: p?.categories[0] ? readableCategory(p.categories[0]).toLowerCase() : lead.industry.toLowerCase(),
    area: p?.locality || p?.city || "",
    city: p?.city ?? "",
    state,
    country: p?.country ? regionNames(p.country) : "",
    distance_km: p?.distanceKm != null ? String(Math.round(p.distanceKm)) : "",
    website: lead.website,
    my_name: s.name,
    my_business: s.business,
    my_pitch: s.pitch,
    my_website: s.website,
    my_phone: s.phone,
    offer: s.offer,
    cta: s.cta,
  };
}

// ---------- Starter templates ----------
// Neutral for any business: no promised results, income, bookings or prices;
// the offer appears only through {offer}; email and follow-ups can be declined.
const optOut = "If this isn't relevant, just let me know and I won't message again.";
export const starterTemplates: Record<TemplateChannel, { subject: string; body: string }> = {
  WhatsApp: {
    subject: "",
    body: `Hi {business_name|there}, I'm {my_name} from {my_business}. {my_pitch}
I came across {business_name} in {area|your area} and thought this might be useful for you.
{offer|}
{cta}`,
  },
  Email: {
    subject: "{my_business} · a quick introduction for {business_name}",
    body: `Hello {business_name|team},

I'm {my_name} from {my_business}. {my_pitch}

I found {business_name} while looking at {segment|businesses} in {area|your area}, and wanted to introduce what we do in case it's useful to you.
{offer|}

{cta}

Best regards,
{my_name}
{my_business}
{my_website|}
{my_phone|}

${optOut}`,
  },
  "Instagram DM": {
    subject: "",
    body: `Hi {business_name|there}! I'm {my_name} from {my_business}. {my_pitch}
I came across your page and thought this could be relevant for you.
{offer|}
{cta}`,
  },
  "Call script": {
    subject: "",
    body: `Opening: Hello, is this {business_name}? My name is {my_name}, calling from {my_business}.
Reason: {my_pitch} I'm reaching out to {segment|businesses} in {area|your area}.
{offer|}
Ask: {cta}
Listen: what matters most to them right now? Note it down.
Close: agree a next step only if they are interested; otherwise thank them and end the call.`,
  },
  "Follow-up 1": {
    subject: "Following up · {my_business}",
    body: `Hi {business_name|there}, this is {my_name} from {my_business} following up on my earlier message. {my_pitch}
{cta}

${optOut}`,
  },
  "Follow-up 2": {
    subject: "One last note from {my_business}",
    body: `Hi {business_name|there}, just a last note from {my_name} at {my_business}. If the timing isn't right, no problem at all; you can reach me any time at {my_phone|this number}.

${optOut}`,
  },
};
export function starterTemplate(channel: TemplateChannel): ProjectTemplate {
  return { id: `starter-${channel}`, name: `Starter · ${channel}`, channel, segmentId: "", ...starterTemplates[channel], version: 1, updatedAt: "" };
}
/** Template for a lead and channel: segment-specific, then project default, then workspace default, then the starter. */
export function pickTemplate(channel: TemplateChannel, segmentId: string, project: CustomProject, workspace: ProjectTemplate[] = []) {
  return (
    project.templates.find((t) => t.channel === channel && t.segmentId === segmentId && segmentId) ??
    project.templates.find((t) => t.channel === channel && !t.segmentId) ??
    workspace.find((t) => t.channel === channel) ??
    starterTemplate(channel)
  );
}
/** Saves edits; the version goes up whenever the subject or body changes, so outcomes compare per version. */
export function reviseTemplate(old: ProjectTemplate | undefined, next: Omit<ProjectTemplate, "version" | "updatedAt">): ProjectTemplate {
  const changed = !old || old.subject !== next.subject || old.body !== next.body;
  return { ...next, version: old ? old.version + (changed ? 1 : 0) : 1, updatedAt: changed || !old ? now() : old.updatedAt };
}
export const duplicateTemplate = (t: ProjectTemplate): ProjectTemplate => ({ ...t, id: uid(), name: `${t.name} (copy)`, version: 1, updatedAt: now() });

// ---------- Opening apps (the user always presses send) ----------
export const LONG_MESSAGE = 600;
export const MAILTO_LIMIT = 1800;
export function messageWarnings(channel: TemplateChannel, text: string) {
  const w: string[] = [];
  if ((channel === "WhatsApp" || channel === "Instagram DM") && text.length > LONG_MESSAGE)
    w.push(`This message is ${text.length} characters; messages over about ${LONG_MESSAGE} are often skimmed.`);
  return w;
}
export function whatsappLink(lead: Lead, text: string) {
  const p = lead.project;
  return p?.phoneE164 && canWhatsApp(p.phoneType) ? waLink(p.phoneE164, text) : "";
}
/** A mailto: link, or tooLong when mail apps may cut it off (use Copy instead). */
export function mailtoLink(email: string, subject: string, body: string) {
  const href = `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { href, tooLong: href.length > MAILTO_LIMIT };
}
export const callLink = (lead: Lead) => telLink(lead.project?.phoneE164 || "");
export const instagramProfile = (lead: Lead) => lead.creator?.instagramUrl || "";

/** Text drafts for every lead in a batch and the chosen channels (stored on the lead; never sent). */
export function batchDrafts(leads: Lead[], channels: TemplateChannel[], project: CustomProject, workspace: ProjectTemplate[] = []) {
  let blocked = 0;
  const out = leads.map((l) => {
    if (!l.project) return l;
    const drafts = { ...l.project.drafts };
    for (const ch of channels) {
      const tpl = pickTemplate(ch, l.project.segmentId, project, workspace);
      const ctx = contextFor(l, project);
      const body = render(tpl.body, ctx);
      const subject = render(tpl.subject, ctx);
      if (!canSend(body) || !canSend(subject)) blocked++;
      drafts[ch] = { subject: subject.text, body: body.text };
    }
    return { ...l, project: { ...l.project, drafts } };
  });
  return { leads: out, blocked };
}
