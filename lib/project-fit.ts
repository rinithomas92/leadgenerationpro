// Fit score for custom lead projects: a transparent 100-point checklist.
// It is not a prediction of replies or sales. Gloss scoring is separate.
import { localDate, safeUrl, type Lead } from "./leadgen.ts";
import type { CustomProject, Segment, Tier } from "./project-schema.ts";

// Distance that scores zero in tiers without a fixed radius.
const TIER_SCALE_KM: Partial<Record<Tier, number>> = { state: 500, country: 2500, global: 10000 };
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

export function channelCount(l: Lead) {
  const c = l.creator;
  return [l.phone, l.email, safeUrl(l.website), c?.instagram || c?.instagramUrl, c?.facebookUrl, c?.linkedinUrl, c?.youtubeUrl, c?.tiktokUrl].filter(Boolean).length;
}

export function projectFit(l: Lead, segment: Segment | undefined, project: Pick<CustomProject, "localityKm" | "cityKm">, today = localDate()) {
  const p = l.project!;
  const lower = (s: string) => s.toLowerCase();
  const haystack = lower([l.name, l.industry, ...p.categories].join(" "));
  const segCats = new Set(segment?.categories ?? []);
  const reasons: string[] = [];

  let category = 0;
  if (p.categories[0] && segCats.has(p.categories[0])) category = 30;
  else if (p.categories.some((c) => segCats.has(c))) category = 20;
  else if (segment && lower(segment.label).split(/\W+/).some((w) => w.length > 3 && haystack.includes(w))) category = 10;
  reasons.push(`category match ${category}/30`);

  let keywords = 15;
  if (segment?.include.length) {
    const hit = segment.include.filter((k) => haystack.includes(lower(k))).length;
    keywords = Math.round((15 * hit) / segment.include.length);
    reasons.push(`keywords ${keywords}/15 (${hit} of ${segment.include.length} matched)`);
  } else reasons.push("keywords 15/15 (none set)");

  let distance = 0;
  const radius = p.tier === "locality" ? project.localityKm : p.tier === "city" ? project.cityKm : TIER_SCALE_KM[p.tier];
  if (p.distanceKm != null && radius) distance = Math.round(20 * Math.max(0, 1 - p.distanceKm / radius));
  reasons.push(p.distanceKm == null ? "distance 0/20 (no location)" : `distance ${distance}/20 (${p.distanceKm} km)`);

  const n = channelCount(l);
  const channels = Math.min(20, n * 5);
  reasons.push(`reach-out channels ${channels}/20 (${n})`);

  let quality: number;
  if (p.confidence != null) quality = Math.round(p.confidence * 10);
  else if (l.sourceVerifiedAt) quality = daysBetween(l.sourceVerifiedAt, today) <= 730 ? 8 : 5;
  else quality = 4;
  const recent = l.checkedAt && daysBetween(l.checkedAt, today) <= 90 ? 5 : 0;
  reasons.push(`source confidence and recency ${quality + recent}/15`);

  return {
    score: Math.min(100, category + keywords + distance + channels + quality + recent),
    reason: `Rule-based fit: ${reasons.join("; ")}. This is a checklist, not a prediction of replies or sales.`,
  };
}
