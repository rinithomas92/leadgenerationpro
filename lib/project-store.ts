// D1 persistence for custom lead projects: deliveries (the "Given" ledger),
// contact events and the do-not-contact list. A delivery or undo is one batch
// with the workspace revision check, so a stale tab cannot double-deliver.
import { chunkJson, loadDocument, loadLeads, suppressionStatements } from "./workspace-store.ts";
import { availableState, isCustom, planDelivery, undoError } from "./ledger.ts";
import { suppressionIndex } from "./suppression.ts";
import { now, uid } from "./leadgen.ts";
import type { ContactEvent, Delivery, DeliveryState, Suppression } from "./project-schema.ts";

type DeliveryRow = {
  id: string; campaign_id: string; seq: number; requested: number; mode: string; planned: string; actual: string;
  notes: string; delivered: number; suppressed: number; created_at: string; filename: string;
};
const toDelivery = (r: DeliveryRow): Delivery => ({
  id: r.id,
  campaignId: r.campaign_id,
  seq: r.seq,
  requested: r.requested,
  mode: r.mode as Delivery["mode"],
  planned: JSON.parse(r.planned),
  actual: JSON.parse(r.actual),
  notes: JSON.parse(r.notes),
  delivered: r.delivered,
  suppressed: r.suppressed,
  createdAt: r.created_at,
  filename: r.filename,
});
export async function loadDeliveries(db: D1Database, owner: string, campaignId?: string) {
  const q = campaignId
    ? db.prepare("SELECT * FROM deliveries WHERE owner = ? AND campaign_id = ? ORDER BY seq").bind(owner, campaignId)
    : db.prepare("SELECT * FROM deliveries WHERE owner = ? ORDER BY campaign_id, seq").bind(owner);
  return (await q.all<DeliveryRow>()).results.map(toDelivery);
}
export async function loadEvents(db: D1Database, owner: string, campaignId?: string): Promise<ContactEvent[]> {
  const q = campaignId
    ? db.prepare("SELECT * FROM contact_events WHERE owner = ? AND campaign_id = ? ORDER BY created_at").bind(owner, campaignId)
    : db.prepare("SELECT * FROM contact_events WHERE owner = ? ORDER BY created_at").bind(owner);
  const rows = (await q.all<Record<string, string | number | null>>()).results;
  return rows.map((r) => ({
    id: String(r.id),
    campaignId: String(r.campaign_id),
    leadId: String(r.lead_id),
    channel: String(r.channel),
    templateId: String(r.template_id ?? ""),
    templateVersion: Number(r.template_version ?? 0),
    direction: r.direction === "reply" ? "reply" : "outbound",
    note: String(r.note ?? ""),
    createdAt: String(r.created_at),
  }));
}
export async function loadSuppression(db: D1Database, owner: string): Promise<Suppression[]> {
  const rows = (await db.prepare("SELECT * FROM suppression WHERE owner = ? ORDER BY created_at").bind(owner).all<Record<string, string>>()).results;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Suppression["kind"],
    value: r.value,
    reason: r.reason ?? "",
    origin: r.origin as Suppression["origin"],
    createdAt: r.created_at,
  }));
}

/**
 * Writes a ledger change in one batch: the revision bump first, then the
 * lead updates and delivery-row statements, each guarded by this write's token.
 */
async function guarded(db: D1Database, owner: string, revision: number, build: (won: string) => D1PreparedStatement[]) {
  const token = crypto.randomUUID();
  const won = `EXISTS (SELECT 1 FROM workspaces WHERE owner = ?1 AND write_token = '${token}')`;
  const results = await db.batch([
    db.prepare("UPDATE workspaces SET revision = revision + 1, write_token = ? WHERE owner = ? AND revision = ?").bind(token, owner, revision),
    ...build(won),
  ]);
  return { won: !!results[0].meta.changes, results };
}
const setDelivery = (db: D1Database, owner: string, state: DeliveryState, ids: string[], won: string, where: string) =>
  chunkJson(ids).map((json) =>
    db
      .prepare(
        `UPDATE leads SET data = json_set(data, '$.project.delivery', json(?2))
         WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?3)) AND ${where} AND ${won}`,
      )
      .bind(owner, JSON.stringify(state), json),
  );

export type LedgerResult =
  | { error: string; status: number }
  | { revision: number; delivery: Delivery; ids: string[]; state: DeliveryState };

/** Hands out one batch of available leads and marks them Given. */
export async function deliverBatch(db: D1Database, owner: string, campaignId: string, size: number, revision: number): Promise<LedgerResult> {
  const doc = await loadDocument(db, owner);
  const campaign = doc.campaigns.find((c) => c.id === campaignId);
  if (!isCustom(campaign)) return { error: "Lead project not found.", status: 404 };
  const [leads, deliveries, suppression] = await Promise.all([
    loadLeads(db, owner, campaignId),
    loadDeliveries(db, owner, campaignId),
    loadSuppression(db, owner),
  ]);
  const seq = Math.max(0, ...deliveries.map((d) => d.seq)) + 1;
  let plan;
  try {
    plan = planDelivery(campaign, leads, size, seq, suppressionIndex(suppression), uid(), now());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid batch.", status: 400 };
  }
  if (!plan.ids.length) return { error: "No available leads in the pool. Run discovery first.", status: 409 };
  const d = plan.delivery;
  const { won } = await guarded(db, owner, revision, (guard) => [
    ...setDelivery(db, owner, plan.state, plan.ids, guard, "json_extract(data, '$.project.delivery.status') = 'available'"),
    db
      .prepare(
        `INSERT INTO deliveries (owner, id, campaign_id, seq, requested, mode, planned, actual, notes, delivered, suppressed, created_at, filename)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 WHERE ${guard}`,
      )
      .bind(owner, d.id, d.campaignId, d.seq, d.requested, d.mode, JSON.stringify(d.planned), JSON.stringify(d.actual), JSON.stringify(d.notes), d.delivered, d.suppressed, d.createdAt, d.filename),
  ]);
  if (!won) return { error: "This workspace changed in another tab. Reload, then generate the batch again.", status: 409 };
  return { revision: revision + 1, delivery: d, ids: plan.ids, state: plan.state };
}

/** Returns the latest batch's leads to the pool and deletes its record. */
export async function undoBatch(db: D1Database, owner: string, campaignId: string, deliveryId: string, revision: number): Promise<LedgerResult> {
  const [leads, deliveries] = await Promise.all([loadLeads(db, owner, campaignId), loadDeliveries(db, owner, campaignId)]);
  const delivery = deliveries.find((d) => d.id === deliveryId);
  const error = undoError(deliveries, delivery, leads);
  if (error || !delivery) return { error: error || "Batch not found.", status: 409 };
  const ids = leads.filter((l) => l.project?.delivery.id === deliveryId).map((l) => l.id);
  const state = availableState();
  const { won } = await guarded(db, owner, revision, (guard) => [
    ...setDelivery(db, owner, state, ids, guard, `json_extract(data, '$.project.delivery.id') = '${deliveryId.replace(/'/g, "''")}'`),
    db.prepare(`DELETE FROM deliveries WHERE owner = ?1 AND id = ?2 AND ${guard}`).bind(owner, deliveryId),
  ]);
  if (!won) return { error: "This workspace changed in another tab. Reload before undoing.", status: 409 };
  return { revision: revision + 1, delivery, ids, state };
}

/** Adds or removes do-not-contact entries (manual entries and CSV imports). */
export async function changeSuppression(db: D1Database, owner: string, add: Suppression[], remove: string[]) {
  const statements = suppressionStatements(db, owner, { add, remove });
  if (statements.length) await db.batch(statements);
  return loadSuppression(db, owner);
}
