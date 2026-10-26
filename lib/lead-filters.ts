// Filters for custom-project leads, shared by the Leads page and the map.
import type { Lead } from "./leadgen.ts";

export type ProjectFilter = {
  tier: string; // "" = any
  segment: string;
  delivery: "" | "available" | "given";
  outreach: string;
  batch: string; // delivery id
  hasPhone?: boolean;
  hasEmail?: boolean;
};
export const anyProjectFilter = (): ProjectFilter => ({ tier: "", segment: "", delivery: "", outreach: "", batch: "" });
export const isFiltering = (f: ProjectFilter) => !!(f.tier || f.segment || f.delivery || f.outreach || f.batch || f.hasPhone || f.hasEmail);

/** Leads outside custom projects pass only when no project filter is set. */
export function matchesProjectFilter(l: Lead, f: ProjectFilter) {
  if (!isFiltering(f)) return true;
  const p = l.project;
  if (!p) return false;
  return (
    (!f.tier || p.tier === f.tier) &&
    (!f.segment || p.segmentId === f.segment) &&
    (!f.delivery || p.delivery.status === f.delivery) &&
    (!f.outreach || p.outreach.status === f.outreach) &&
    (!f.batch || p.delivery.id === f.batch) &&
    (!f.hasPhone || !!l.phone) &&
    (!f.hasEmail || !!l.email)
  );
}
export const outreachLabels: Record<string, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting: "Meeting / call booked",
  won: "Won",
  not_interested: "Not interested",
  no_response: "No response",
  bad_contact: "Bad contact",
  do_not_contact: "Do not contact",
};
