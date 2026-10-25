// The "Given" ledger: which pool leads a batch hands out. Pure; the Worker
// applies the result atomically (see project-store.ts).
import { allocate, type Candidate } from "./allocation.ts";
import { batchSizes, type CustomProject, type Delivery, type DeliveryState } from "./project-schema.ts";
import { isSuppressed, type SuppressionIndex } from "./suppression.ts";
import { localDate, type Campaign, type Lead } from "./leadgen.ts";

export const isCustom = (c?: Campaign): c is Campaign & { custom: CustomProject } => !!c?.custom;
export const isBatchSize = (n: number) => (batchSizes as readonly number[]).includes(n);
export const homeLabel = (p: CustomProject) => p.base.country?.name || "India";

export function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}
export const batchFilename = (campaign: Campaign, seq: number, date = localDate()) =>
  `${slug(campaign.name)}-batch-${seq}-${date}.xlsx`;

/** Leads that can still be delivered: in the pool, not Given, not suppressed. */
export function available(leads: Lead[], campaignId: string, suppressed: SuppressionIndex) {
  let skipped = 0;
  const list = leads.filter((l) => {
    if (l.campaignId !== campaignId || !l.project || l.project.delivery.status !== "available") return false;
    if (isSuppressed(l, suppressed)) {
      skipped++;
      return false;
    }
    return true;
  });
  return { list, suppressed: skipped };
}
export const candidate = (l: Lead): Candidate => ({
  id: l.id,
  tier: l.project!.tier,
  segmentId: l.project!.segmentId,
  fit: l.score,
  distanceKm: l.project!.distanceKm,
  name: l.name,
});

/** Plans a batch: chosen lead ids, the delivery record and the state they get. */
export function planDelivery(
  campaign: Campaign & { custom: CustomProject },
  leads: Lead[],
  size: number,
  seq: number,
  suppressed: SuppressionIndex,
  id: string,
  at: string,
): { delivery: Delivery; state: DeliveryState; ids: string[] } {
  if (!isBatchSize(size)) throw new Error(`Batch size must be one of ${batchSizes.join(", ")}.`);
  const p = campaign.custom;
  const pool = available(leads, campaign.id, suppressed);
  const result = allocate(
    {
      size,
      tiers: p.tiers.map((tier, i) => ({ tier, pct: p.mode === "nearest" ? 0 : (p.split[i] ?? 0) })),
      segments: p.segments.map((s) => s.id),
      segmentLabels: Object.fromEntries(p.segments.map((s) => [s.id, s.label])),
      available: pool.list.map(candidate),
      mode: p.mode,
    },
    homeLabel(p),
  );
  const notes = [...result.notes];
  if (pool.suppressed) notes.push(`${pool.suppressed} pool leads match the do-not-contact list and were not delivered.`);
  return {
    ids: result.ids,
    state: { status: "given", id, givenAt: at, batch: seq },
    delivery: {
      id,
      campaignId: campaign.id,
      seq,
      requested: size,
      mode: p.mode,
      planned: result.planned as Record<string, number>,
      actual: result.actual as Delivery["actual"],
      notes,
      delivered: result.ids.length,
      suppressed: pool.suppressed,
      createdAt: at,
      filename: batchFilename(campaign, seq, at.slice(0, 10)),
    },
  };
}
export const availableState = (): DeliveryState => ({ status: "available", id: "", givenAt: "", batch: 0 });

/** Applies a delivery (or its undo) to leads held in memory. */
export function applyDelivery(leads: Lead[], ids: string[], state: DeliveryState) {
  const set = new Set(ids);
  return leads.map((l) => (set.has(l.id) && l.project ? { ...l, project: { ...l.project, delivery: state } } : l));
}
/** Undo is allowed only for the latest batch, and only before any of its leads was contacted. */
export function undoError(deliveries: Delivery[], delivery: Delivery | undefined, leads: Lead[]) {
  if (!delivery) return "Batch not found.";
  const latest = Math.max(...deliveries.filter((d) => d.campaignId === delivery.campaignId).map((d) => d.seq));
  if (delivery.seq !== latest) return "Only the latest batch can be undone.";
  const contacted = leads.filter((l) => l.project?.delivery.id === delivery.id && l.project.outreach.status !== "not_contacted").length;
  if (contacted) return `${contacted} leads in this batch already have outreach recorded, so it cannot be undone.`;
  return "";
}
