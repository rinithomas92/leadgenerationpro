// Client for the local sources service (npm run sources) and mapping of
// Overture Maps Places rows to project leads. When the service is not
// running, discovery reports it and uses OpenStreetMap and Wikidata only.
import { distanceKm } from "./discovery-engine.ts";
import { emptyCreator, profileUrl } from "./gloss.ts";
import { normalizeHandle, safeUrl, type Campaign, type Lead } from "./leadgen.ts";
import { fitUrl, projectLead } from "./project.ts";
import type { Tier } from "./project-schema.ts";

export const SOURCES_URL = "http://127.0.0.1:5188";
type Fetch = typeof fetch;

export type Area =
  | { kind: "radius"; lat: number; lon: number; km: number }
  | { kind: "bbox"; w: number; s: number; e: number; n: number }
  | { kind: "region"; region?: string; names?: string[]; bbox?: { w: number; s: number; e: number; n: number } };
export type SourceQuery = {
  country: string;
  categories: string[];
  include?: string[];
  exclude?: string[];
  keywords?: "widen" | "narrow";
  area: Area;
  excludeAreas?: Area[];
};
export type SourceId = "overture" | "foursquare";
/** How a place from one extract is credited on its lead. */
export type SourceTag = { name: string; prefix: string; licence: string };
export type Health = { ok: boolean; extracts: { source?: SourceId; country: string; release: string; rows: number; extractedAt: string }[] };
export type Counts = { total: number; closed: number; noChannel: number; reachable: number; release: string };
export type OvertureRow = {
  id: string;
  name: string;
  basic_category: string | null;
  category: string | null;
  alternates: string[] | null;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
  phones: string[] | null;
  emails: string[] | null;
  websites: string[] | null;
  socials: string[] | null;
  brand: string | null;
  confidence: number | null;
  operating_status: string | null;
  sources: { dataset: string | null; record_id: string | null; update_time: string | null; license: string | null }[] | null;
};

export class SourcesError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
/** The service status, or null when it is not running. */
export async function sourcesHealth(f: Fetch = fetch, url = SOURCES_URL): Promise<Health | null> {
  try {
    const r = await f(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? ((await r.json()) as Health) : null;
  } catch {
    return null;
  }
}
export async function sourcesCall<T>(route: string, body: unknown, f: Fetch = fetch, url = SOURCES_URL, timeoutMs = 120000): Promise<T> {
  let r: Response;
  try {
    r = await f(`${url}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SourcesError(`Sources service unreachable (${e instanceof Error ? e.message : "error"}). Start it with npm run sources.`, 0);
  }
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new SourcesError(d.error || `Sources service error (HTTP ${r.status})`, r.status);
  return d as T;
}

/** Sorts public profile links into the lead's social fields. */
export function socialFields(urls: string[]) {
  const c = emptyCreator();
  for (const raw of urls) {
    const u = fitUrl(raw.replace(/^http:/i, "https:"));
    if (!u) continue;
    if (!c.instagramUrl && profileUrl("Instagram", u)) {
      const handle = normalizeHandle(u);
      if (handle) Object.assign(c, { instagramUrl: `https://www.instagram.com/${handle}/`, instagram: handle });
    } else if (!c.facebookUrl && profileUrl("Facebook", u)) c.facebookUrl = u;
    else if (!c.linkedinUrl && profileUrl("LinkedIn", u)) c.linkedinUrl = u;
    else if (!c.youtubeUrl && profileUrl("YouTube", u)) c.youtubeUrl = u;
    else if (!c.tiktokUrl && profileUrl("TikTok", u)) c.tiktokUrl = u;
  }
  c.platform = c.instagramUrl ? "Instagram" : "Website";
  const any = c.instagramUrl || c.facebookUrl || c.linkedinUrl || c.youtubeUrl || c.tiktokUrl;
  return any ? c : undefined;
}
export const readable = (category: string) =>
  category ? category.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()) : "";

/** Maps one Overture place to a project lead with its source record and provenance. */
export function overtureLead(
  campaign: Campaign,
  row: OvertureRow,
  where: { tier: Tier; segmentId: string; base?: { lat: number; lon: number } },
  release: string,
  tag: SourceTag = { name: "Overture Maps", prefix: "ov", licence: "CDLA-Permissive-2.0" },
): Lead {
  const updated = (row.sources ?? []).map((s) => s.update_time?.slice(0, 10) || "").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) || "";
  const datasets = [...new Set((row.sources ?? []).map((s) => s.dataset).filter(Boolean))].join(", ");
  const category = row.category || row.basic_category || "";
  const city = row.locality || "";
  return projectLead(campaign, {
    name: row.name,
    segmentId: where.segmentId,
    tier: where.tier,
    source: {
      name: tag.name,
      id: `${tag.prefix}:${row.id}`,
      url: "",
      label: `${tag.name === "Overture Maps" ? "Overture Maps Places" : tag.name} ${release} (${datasets || tag.name}; ${tag.licence}) · record ${row.id}`,
    },
    category: readable(category),
    location: [city, row.region, row.country].filter(Boolean).join(", "),
    website: safeUrl(row.websites?.[0] || "") || "",
    email: row.emails?.[0] || "",
    phone: (row.phones ?? []).join("; "),
    creator: socialFields(row.socials ?? []),
    sourceVerifiedAt: updated,
    project: {
      categories: [...new Set([row.category, ...(row.alternates ?? []), row.basic_category].filter((x): x is string => !!x))].slice(0, 20),
      address: row.address || "",
      city,
      region: row.region || "",
      country: row.country || "",
      lat: row.lat,
      lon: row.lon,
      distanceKm: where.base ? Math.round(distanceKm(where.base, row) * 10) / 10 : null,
      confidence: row.confidence,
    },
  });
}
