// Outcome tracking for custom lead projects: statuses, contact events,
// follow-ups and the funnel. Rule-based; statuses never change silently.
import { updateStage, type Lead } from "./leadgen.ts";
import type { ContactEvent, OutreachStatus } from "./project-schema.ts";

/** Each outreach status kept in step with the app's existing stages (Pipeline, Insights). */
export const stageFor: Record<OutreachStatus, Lead["stage"]> = {
  not_contacted: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting: "Interested",
  won: "Converted",
  not_interested: "Lost",
  no_response: "Lost",
  bad_contact: "Lost",
  do_not_contact: "Lost",
};
const order: OutreachStatus[] = ["not_contacted", "contacted", "replied", "interested", "meeting", "won"];
/** How far along the main path a status is (exits count as where they left it). */
export const reached = (l: Lead, step: OutreachStatus) => {
  const s = l.project?.outreach.status ?? "not_contacted";
  const i = order.indexOf(s);
  if (i >= 0) return i >= order.indexOf(step);
  // Exits: a reply is implied by "not interested"; the others left after contact.
  const contacted = !!l.project?.outreach.lastContactedAt;
  if (step === "contacted") return contacted || s === "not_interested";
  if (step === "replied") return s === "not_interested" || !!l.project?.outreach.repliedAt;
  return false;
};

export const funnelSteps = [
  { key: "given", label: "Given" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "interested", label: "Interested" },
  { key: "meeting", label: "Meeting / call booked" },
  { key: "won", label: "Won" },
] as const;
export function funnel(leads: Lead[]) {
  const given = leads.filter((l) => l.project?.delivery.status === "given");
  return funnelSteps.map((s) => ({
    ...s,
    count: s.key === "given" ? given.length : given.filter((l) => reached(l, s.key as OutreachStatus)).length,
  }));
}

/** Sets an outreach status through the existing stage history. */
export function setStatus(l: Lead, status: OutreachStatus, at: string): Lead {
  if (!l.project) return l;
  const staged = updateStage(l, stageFor[status]);
  return {
    ...staged,
    history: [...staged.history, { at, event: `Outreach status: ${status.replace(/_/g, " ")}` }].slice(-500),
    project: { ...l.project, outreach: { ...l.project.outreach, status } },
  };
}
export const lastEvent = (events: ContactEvent[], leadId: string, direction?: ContactEvent["direction"]) =>
  events.filter((e) => e.leadId === leadId && (!direction || e.direction === direction)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

// ---------- Contact events ----------
const addDays = (date: string, days: number) => {
  const d = new Date(date.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/**
 * Mark as sent: records an outbound contact event (channel, template and
 * version), sets the lead to Contacted and schedules the next follow-up
 * reminder: Follow-up 1 after the first message, then Follow-up 2, then none.
 */
export function markSent(
  l: Lead,
  sent: { channel: string; templateId?: string; templateVersion?: number; note?: string },
  followUpDays: number,
  at: string,
  id = crypto.randomUUID(),
): { lead: Lead; event: ContactEvent } {
  const p = l.project!;
  const step = sent.channel === "Follow-up 1" ? 2 : sent.channel === "Follow-up 2" ? 0 : 1;
  const base = ["not_contacted", "no_response"].includes(p.outreach.status) ? setStatus(l, "contacted", at) : l;
  const lead: Lead = {
    ...base,
    contactedAt: l.contactedAt || at,
    followUp: step ? addDays(at, followUpDays) : "",
    history: [...base.history, { at, event: `Marked as sent (${sent.channel}${sent.templateId ? `, template v${sent.templateVersion ?? 1}` : ""})` }].slice(-500),
    project: {
      ...base.project!,
      outreach: {
        ...base.project!.outreach,
        lastContactedAt: at,
        channel: sent.channel,
        templateId: sent.templateId ?? "",
        templateVersion: sent.templateVersion ?? 0,
        followUpStep: step,
      },
    },
  };
  const event: ContactEvent = {
    id,
    campaignId: l.campaignId,
    leadId: l.id,
    channel: sent.channel,
    templateId: sent.templateId ?? "",
    templateVersion: sent.templateVersion ?? 0,
    direction: "outbound",
    note: (sent.note ?? "").slice(0, 2000),
    createdAt: at,
  };
  return { lead, event };
}
/** Log reply: a reply event, the reply date, and Replied unless the lead is already further along. */
export function logReply(l: Lead, channel: string, note: string, at: string, id = crypto.randomUUID()): { lead: Lead; event: ContactEvent } {
  const p = l.project!;
  const further = ["replied", "interested", "meeting", "won", "not_interested", "do_not_contact"].includes(p.outreach.status);
  const base = further ? l : setStatus(l, "replied", at);
  const lead: Lead = {
    ...base,
    // A reply ends the follow-up reminders.
    followUp: "",
    history: [...base.history, { at, event: `Reply logged (${channel})${note ? `: ${note.slice(0, 200)}` : ""}` }].slice(-500),
    project: { ...base.project!, outreach: { ...base.project!.outreach, repliedAt: p.outreach.repliedAt || at, followUpStep: 0 } },
  };
  return { lead, event: { id, campaignId: l.campaignId, leadId: l.id, channel, templateId: "", templateVersion: 0, direction: "reply", note: note.slice(0, 2000), createdAt: at } };
}
/** Follow-up label for the Follow-ups page. */
export const followUpLabel = (l: Lead) => (l.project?.outreach.followUpStep ? `Follow-up ${l.project.outreach.followUpStep}` : "");

/**
 * Leads to suggest as No response: contacted, never replied, no follow-up
 * still scheduled, and no contact for `days` days since the last message
 * (normally Follow-up 2). Suggestions only; statuses never change silently.
 */
export function noResponseSuggestions(leads: Lead[], events: ContactEvent[], days: (l: Lead) => number, today: string) {
  return leads.filter((l) => {
    const p = l.project;
    if (!p || p.outreach.status !== "contacted" || p.outreach.repliedAt) return false;
    if (events.some((e) => e.leadId === l.id && e.direction === "reply")) return false;
    const last = lastEvent(events, l.id, "outbound")?.createdAt || p.outreach.lastContactedAt;
    // After the last follow-up, count from that message; while a follow-up is
    // still pending, count from its (overdue) reminder date instead.
    const anchor = p.outreach.followUpStep === 0 ? last : l.followUp;
    return !!anchor && addDays(anchor, days(l)) <= today;
  });
}

// ---------- Insights ----------
export type Group = { key: string; label: string; given: number; contacted: number; replied: number; interested: number; won: number; bad: number };
export const rate = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
function group(leads: Lead[], keyOf: (l: Lead) => string[], labelOf: (k: string) => string): Group[] {
  const map = new Map<string, Group>();
  for (const l of leads)
    for (const key of keyOf(l)) {
      const g = map.get(key) ?? { key, label: labelOf(key), given: 0, contacted: 0, replied: 0, interested: 0, won: 0, bad: 0 };
      g.given += l.project?.delivery.status === "given" ? 1 : 0;
      g.contacted += reached(l, "contacted") ? 1 : 0;
      g.replied += reached(l, "replied") ? 1 : 0;
      g.interested += reached(l, "interested") ? 1 : 0;
      g.won += reached(l, "won") ? 1 : 0;
      g.bad += l.project?.outreach.status === "bad_contact" ? 1 : 0;
      map.set(key, g);
    }
  return [...map.values()];
}
export type Labels = { tier: (t: string) => string; segment: (s: string) => string; template: (id: string, v: number) => string };
export function insights(leads: Lead[], events: ContactEvent[], labels: Labels) {
  const own = leads.filter((l) => l.project && (l.project.delivery.status === "given" || reached(l, "contacted")));
  const firstOut = new Map<string, ContactEvent>();
  const firstReply = new Map<string, ContactEvent>();
  for (const e of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const m = e.direction === "outbound" ? firstOut : firstReply;
    if (!m.has(e.leadId)) m.set(e.leadId, e);
  }
  const channelOf = (l: Lead) => [firstOut.get(l.id)?.channel || l.project!.outreach.channel || "Not sent"];
  const templateOf = (l: Lead) => {
    const e = firstOut.get(l.id);
    return [e?.templateId ? `${e.templateId}@${e.templateVersion}` : "none"];
  };
  const sourceOf = (l: Lead) => [...new Set(l.project!.sources.map((s) => s.name))];
  const hours = own
    .map((l) => {
      const o = firstOut.get(l.id), r = firstReply.get(l.id);
      return o && r && r.createdAt >= o.createdAt ? (Date.parse(r.createdAt) - Date.parse(o.createdAt)) / 3600000 : undefined;
    })
    .filter((h): h is number => h !== undefined)
    .sort((a, b) => a - b);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null;
  const total = group(own, () => ["all"], () => "All")[0] ?? { key: "all", label: "All", given: 0, contacted: 0, replied: 0, interested: 0, won: 0, bad: 0 };
  return {
    funnel: funnel(leads.filter((l) => l.project)),
    totals: {
      ...total,
      contactRate: rate(total.contacted, total.given),
      replyRate: rate(total.replied, total.contacted),
      interestedRate: rate(total.interested, total.contacted),
      winRate: rate(total.won, total.contacted),
      medianHoursToReply: median,
    },
    byTier: group(own, (l) => [l.project!.tier], labels.tier),
    bySegment: group(own, (l) => [l.project!.segmentId], labels.segment),
    byChannel: group(own, channelOf, (k) => k),
    byTemplate: group(own, templateOf, (k) => (k === "none" ? "No template" : labels.template(k.split("@")[0], Number(k.split("@")[1])))),
    byBatch: group(own, (l) => [l.project!.delivery.batch ? `Batch ${l.project!.delivery.batch}` : "Not given"], (k) => k),
    bySource: group(own, sourceOf, (k) => k),
  };
}
export const MIN_GROUP = 30;
/** Rule-based hints, only when every compared group has at least 30 contacted leads. Never changes settings. */
export function hints(groups: Group[], dimension: string) {
  const active = groups.filter((g) => g.contacted > 0);
  if (active.length < 2 || active.some((g) => g.contacted < MIN_GROUP)) return [];
  const sorted = [...active].sort((a, b) => rate(b.replied, b.contacted) - rate(a.replied, a.contacted));
  const best = sorted[0], worst = sorted[sorted.length - 1];
  const a = rate(best.replied, best.contacted), b = rate(worst.replied, worst.contacted);
  if (a - b < 5) return [];
  const advice = dimension === "tier" ? ` Consider shifting the split towards ${best.label}.` : dimension === "template" ? ` Consider using “${best.label}” more.` : "";
  return [`${best.label} ${dimension} reply rate ${a}% vs ${worst.label} ${b}%.${advice}`];
}
/** Funnel and breakdown tables for the master workbook's Outcomes sheet. */
export function outcomesSheet(data: ReturnType<typeof insights>): (string | number | null)[][] {
  const table = (title: string, groups: Group[]) => [
    [],
    [title, "Given", "Contacted", "Replied", "Interested", "Won", "Contact rate %", "Reply rate %", "Win rate %", "Bad contact %"],
    ...groups.map((g) => [g.label, g.given, g.contacted, g.replied, g.interested, g.won, rate(g.contacted, g.given), rate(g.replied, g.contacted), rate(g.won, g.contacted), rate(g.bad, g.contacted)]),
  ];
  return [
    ["Funnel step", "Leads"],
    ...data.funnel.map((s) => [s.label, s.count]),
    [],
    ["Metric", "Value"],
    ["Contact rate %", data.totals.contactRate],
    ["Reply rate %", data.totals.replyRate],
    ["Interested rate %", data.totals.interestedRate],
    ["Win rate %", data.totals.winRate],
    ["Median hours to first reply", data.totals.medianHoursToReply === null ? "" : Math.round(data.totals.medianHoursToReply * 10) / 10],
    ...table("By tier", data.byTier),
    ...table("By segment", data.bySegment),
    ...table("By channel", data.byChannel),
    ...table("By template (version)", data.byTemplate),
    ...table("By batch", data.byBatch),
    ...table("By source", data.bySource),
  ];
}
