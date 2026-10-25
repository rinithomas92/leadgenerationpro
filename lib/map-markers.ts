// Marker data for the project map (pure, unit-tested). Colour shows the tier;
// the outline shows the lead's status. Leads without coordinates are listed,
// never silently dropped.
import { matchesProjectFilter, type ProjectFilter } from "./lead-filters.ts";
import type { Lead } from "./leadgen.ts";
import type { Tier } from "./project-schema.ts";

// Map tiles: OpenStreetMap standard tiles, light personal use, with visible
// attribution and no prefetching (https://operations.osmfoundation.org/policies/tiles/).
// Change these two constants to use another tile provider.
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

export const tierColors: Record<Tier, string> = {
  locality: "#2f9e6e",
  city: "#3b82c4",
  state: "#8b5cc6",
  country: "#d08a2c",
  global: "#c4475d",
};
export type MarkerStatus = "available" | "given" | "contacted" | "replied" | "won" | "lost" | "bad_contact";
export const statusStyles: Record<MarkerStatus, { label: string; ring: string; dashed?: boolean }> = {
  available: { label: "Available", ring: "#ffffff", dashed: true },
  given: { label: "Given", ring: "#ffffff" },
  contacted: { label: "Contacted", ring: "#f5c542" },
  replied: { label: "Replied", ring: "#5fd38d" },
  won: { label: "Won", ring: "#1f8f4e" },
  lost: { label: "Lost", ring: "#9aa3a0" },
  bad_contact: { label: "Bad contact", ring: "#e5534b" },
};
/** The status a marker shows: outreach once it has started, otherwise the delivery state. */
export function markerStatus(l: Lead): MarkerStatus {
  const p = l.project!;
  const s = p.outreach.status;
  if (s === "bad_contact") return "bad_contact";
  if (s === "won") return "won";
  if (s === "not_interested" || s === "no_response" || s === "do_not_contact") return "lost";
  if (s === "replied" || s === "interested" || s === "meeting") return "replied";
  if (s === "contacted") return "contacted";
  return p.delivery.status === "given" ? "given" : "available";
}
export type MapMarker = { id: string; lat: number; lon: number; color: string; ring: string; dashed: boolean; status: MarkerStatus; tier: Tier; country: string };

export function buildMarkers(leads: Lead[], filter: ProjectFilter, country = "") {
  const shown = leads.filter((l) => l.project && matchesProjectFilter(l, filter) && (!country || l.project.country === country));
  const markers: MapMarker[] = [];
  const missing: Lead[] = [];
  for (const l of shown) {
    const p = l.project!;
    if (p.lat == null || p.lon == null || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      missing.push(l);
      continue;
    }
    const status = markerStatus(l);
    const style = statusStyles[status];
    markers.push({ id: l.id, lat: p.lat, lon: p.lon, color: tierColors[p.tier], ring: style.ring, dashed: !!style.dashed, status, tier: p.tier, country: p.country });
  }
  const bounds = markers.length
    ? {
        s: Math.min(...markers.map((m) => m.lat)),
        n: Math.max(...markers.map((m) => m.lat)),
        w: Math.min(...markers.map((m) => m.lon)),
        e: Math.max(...markers.map((m) => m.lon)),
      }
    : undefined;
  // Global leads can be viewed one country at a time.
  const countries = [...new Set(leads.filter((l) => l.project?.tier === "global").map((l) => l.project!.country).filter(Boolean))].sort();
  return { markers, missing, bounds, countries };
}
