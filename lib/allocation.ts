// Splits a batch across reach tiers. Pure and deterministic: the same pool and
// settings always choose the same leads.
import { tiers, type Tier } from "./project-schema.ts";

export type Candidate = {
  id: string;
  tier: Tier;
  segmentId: string;
  fit: number;
  distanceKm: number | null;
  name: string;
};
export type TierShare = { tier: Tier; pct: number };
export type AllocationInput = {
  size: number;
  tiers: TierShare[];
  // Segment ids in project order; also the round-robin order.
  segments: string[];
  available: Candidate[];
  mode: "split" | "nearest";
  // Display names for notes; ids are used when missing.
  segmentLabels?: Record<string, string>;
};
export type Allocation = {
  ids: string[];
  planned: Partial<Record<Tier, number>>;
  actual: { tiers: Partial<Record<Tier, number>>; segments: Record<string, number> };
  notes: string[];
};

export const tierLabel = (t: Tier, home = "India") =>
  ({ locality: "Locality", city: "City", state: "State", country: home, global: "Global" })[t];

/** Largest-remainder rounding: the targets always sum exactly to `size`. */
export function targets(size: number, shares: TierShare[]) {
  const total = shares.reduce((n, s) => n + s.pct, 0) || 1;
  const raw = shares.map((s) => (size * s.pct) / total);
  const base = raw.map(Math.floor);
  let left = size - base.reduce((n, b) => n + b, 0);
  // Ties go to the nearer tier (lower index), since sort is stable.
  const order = raw.map((r, i) => ({ i, rem: r - base[i] })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return Object.fromEntries(shares.map((s, i) => [s.tier, base[i]])) as Partial<Record<Tier, number>>;
}

/** Best fit first, then nearest, then a stable name/id order. */
export function orderBucket(leads: Candidate[]) {
  return leads.slice().sort(
    (a, b) =>
      b.fit - a.fit ||
      (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** Takes up to `n` leads, one segment at a time, so no segment fills a tier alone. */
function roundRobin(queues: Candidate[][], n: number) {
  const out: Candidate[] = [];
  while (out.length < n && queues.some((q) => q.length))
    for (const q of queues) if (q.length && out.length < n) out.push(q.shift()!);
  return out;
}

export function allocate(input: AllocationInput, home = "India"): Allocation {
  const selected = input.tiers
    .filter((s) => tiers.includes(s.tier))
    .sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier));
  // One ordered queue per segment per tier; segments not in the list go last.
  const segOrder = [...input.segments, ...new Set(input.available.map((c) => c.segmentId).filter((s) => !input.segments.includes(s)))];
  const queues = new Map<Tier, Candidate[][]>();
  for (const { tier } of selected)
    queues.set(
      tier,
      segOrder.map((seg) => orderBucket(input.available.filter((c) => c.tier === tier && c.segmentId === seg))),
    );
  const taken = new Map<Tier, Candidate[]>(selected.map((s) => [s.tier, []]));
  const notes: string[] = [];
  const label = (t: Tier) => tierLabel(t, home);
  let planned: Partial<Record<Tier, number>>;
  if (input.mode === "nearest") {
    planned = {};
    let want = input.size;
    for (const { tier } of selected) {
      const got = roundRobin(queues.get(tier)!, want);
      taken.get(tier)!.push(...got);
      planned[tier] = got.length;
      want -= got.length;
    }
  } else {
    planned = targets(input.size, selected);
    for (const { tier } of selected) taken.get(tier)!.push(...roundRobin(queues.get(tier)!, planned[tier] ?? 0));
    for (let i = 0; i < selected.length; i++) {
      const t = selected[i].tier;
      let deficit = (planned[t] ?? 0) - taken.get(t)!.length;
      if (deficit <= 0) continue;
      const emptySegs = segOrder
        .filter((_, k) => !queues.get(t)![k].length)
        .map((s) => input.segmentLabels?.[s] ?? s);
      // Spill outward first, then inward (nearest inner tier first).
      const order = [...selected.slice(i + 1), ...selected.slice(0, i).reverse()];
      for (const { tier: u } of order) {
        if (deficit <= 0) break;
        const got = roundRobin(queues.get(u)!, deficit);
        if (!got.length) continue;
        taken.get(u)!.push(...got);
        deficit -= got.length;
        notes.push(`${label(t)} exhausted${emptySegs.length ? ` for ${emptySegs.join(", ")}` : ""}; ${got.length} moved to ${label(u)}.`);
      }
    }
  }
  const chosen = selected.flatMap((s) => taken.get(s.tier)!);
  if (chosen.length < input.size)
    notes.push(`Only ${chosen.length} of ${input.size} requested leads were available; every selected tier is exhausted for now.`);
  const actualTiers: Partial<Record<Tier, number>> = {};
  const actualSegments: Record<string, number> = {};
  for (const c of chosen) {
    actualTiers[c.tier] = (actualTiers[c.tier] ?? 0) + 1;
    actualSegments[c.segmentId] = (actualSegments[c.segmentId] ?? 0) + 1;
  }
  return { ids: chosen.map((c) => c.id), planned, actual: { tiers: actualTiers, segments: actualSegments }, notes };
}
