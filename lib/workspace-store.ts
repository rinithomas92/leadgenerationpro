// Workspace persistence on D1. Campaigns, drafts and settings live in one
// document; leads live in their own table so their number is not limited by
// a single row's size. Saves send only the leads that changed.
import {
  emptyWorkspace,
  leadSchema,
  stateSchema,
  type Lead,
  type Workspace,
} from "./leadgen.ts";
import { glossLeadError, isGloss } from "./gloss.ts";
import { contactEventSchema, suppressionSchema, type ContactEvent, type Suppression } from "./project-schema.ts";
import { z } from "zod";

// D1 limits a bound string to about 2 MB; stay well below it per statement.
const CHUNK_BYTES = 800_000;
export function chunkJson(items: unknown[]) {
  const out: string[] = [];
  let batch: string[] = [];
  let size = 2;
  for (const item of items) {
    const s = JSON.stringify(item);
    if (batch.length && size + s.length + 1 > CHUNK_BYTES) {
      out.push(`[${batch.join(",")}]`);
      batch = [];
      size = 2;
    }
    batch.push(s);
    size += s.length + 1;
  }
  if (batch.length) out.push(`[${batch.join(",")}]`);
  return out;
}

export async function loadLeads(db: D1Database, owner: string, campaignId?: string) {
  const rows = campaignId
    ? await db.prepare("SELECT data FROM leads WHERE owner = ? AND campaign_id = ? ORDER BY rowid").bind(owner, campaignId).all<{ data: string }>()
    : await db.prepare("SELECT data FROM leads WHERE owner = ? ORDER BY rowid").bind(owner).all<{ data: string }>();
  return rows.results.map((r) => JSON.parse(r.data) as Lead);
}

type Changes = {
  upsert: Lead[];
  remove: string[];
  // Custom lead projects only: contact events and do-not-contact entries,
  // written in the same batch as the lead changes they belong to.
  events?: { insert: ContactEvent[] };
  suppression?: { add: Suppression[]; remove: string[] };
};
/**
 * Statements adding and removing do-not-contact entries. `guard` is an SQL
 * condition (?1 is the owner) that must hold for them to take effect.
 */
export function suppressionStatements(db: D1Database, owner: string, changes: Changes["suppression"], guard = "1") {
  return [
    ...chunkJson(changes?.add ?? []).map((json) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO suppression (owner, id, kind, value, reason, origin, created_at)
           SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.kind'), json_extract(value, '$.value'),
             json_extract(value, '$.reason'), json_extract(value, '$.origin'), json_extract(value, '$.createdAt')
           FROM json_each(?2) WHERE ${guard}`,
        )
        .bind(owner, json),
    ),
    ...chunkJson(changes?.remove ?? []).map((json) =>
      db.prepare(`DELETE FROM suppression WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?2)) AND ${guard}`).bind(owner, json),
    ),
  ];
}
/**
 * Applies a save atomically: the workspace document and the lead changes are
 * written in one batch, and lead statements only take effect when this save
 * won the revision check (identified by its write token).
 */
async function commit(db: D1Database, owner: string, data: Omit<Workspace, "leads">, revision: number, changes: Changes) {
  const token = crypto.randomUUID();
  const won = "EXISTS (SELECT 1 FROM workspaces WHERE owner = ?1 AND write_token = ?3)";
  const results = await db.batch([
    db
      .prepare("UPDATE workspaces SET data = ?, revision = revision + 1, write_token = ? WHERE owner = ? AND revision = ?")
      .bind(JSON.stringify({ ...data, leads: [] }), token, owner, revision),
    ...chunkJson(changes.upsert).map((json) =>
      db
        .prepare(
          `INSERT INTO leads (owner, id, campaign_id, data)
           SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.campaignId'), value FROM json_each(?2) WHERE ${won}
           ON CONFLICT(owner, id) DO UPDATE SET campaign_id = excluded.campaign_id,
             -- A custom-project lead's delivery state (Given, batch) is changed
             -- only by the delivery endpoints, never by a workspace save.
             data = CASE
               WHEN json_type(leads.data, '$.project.delivery') IS NOT NULL AND json_type(excluded.data, '$.project') IS NOT NULL
               THEN json_set(excluded.data, '$.project.delivery', json(json_extract(leads.data, '$.project.delivery')))
               ELSE excluded.data END`,
        )
        .bind(owner, json, token),
    ),
    ...chunkJson(changes.remove).map((json) =>
      db
        .prepare(`DELETE FROM leads WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?2)) AND ${won}`)
        .bind(owner, json, token),
    ),
    ...chunkJson(changes.events?.insert ?? []).map((json) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_events (owner, id, campaign_id, lead_id, channel, template_id, template_version, direction, note, created_at)
           SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.campaignId'), json_extract(value, '$.leadId'),
             json_extract(value, '$.channel'), json_extract(value, '$.templateId'), json_extract(value, '$.templateVersion'),
             json_extract(value, '$.direction'), json_extract(value, '$.note'), json_extract(value, '$.createdAt')
           FROM json_each(?2) WHERE ${won}`,
        )
        .bind(owner, json, token),
    ),
    // Guard written inline because these statements bind only owner and data.
    ...suppressionStatements(db, owner, changes.suppression, `EXISTS (SELECT 1 FROM workspaces WHERE owner = ?1 AND write_token = '${token}')`),
  ]);
  return !!results[0].meta.changes;
}

/** The workspace document (campaigns, drafts, settings) without its leads. */
export async function loadDocument(db: D1Database, owner: string) {
  const row = await db.prepare("SELECT data FROM workspaces WHERE owner = ?").bind(owner).first<{ data: string }>();
  const parsed = stateSchema.safeParse({ ...(row ? JSON.parse(row.data) : emptyWorkspace()), leads: [] });
  return parsed.success ? parsed.data : emptyWorkspace();
}
export async function loadWorkspace(db: D1Database, owner: string): Promise<{ state: Workspace; revision: number }> {
  await db
    .prepare("INSERT OR IGNORE INTO workspaces (owner, data, revision) VALUES (?, ?, 0)")
    .bind(owner, JSON.stringify(emptyWorkspace()))
    .run();
  const row = await db
    .prepare("SELECT data, revision FROM workspaces WHERE owner = ?")
    .bind(owner)
    .first<{ data: string; revision: number }>();
  if (!row) throw new Error("Missing workspace");
  const stored = JSON.parse(row.data) as Workspace;
  // Workspaces saved before leads had their own table are moved over once.
  if (Array.isArray(stored.leads) && stored.leads.length) {
    const { leads, ...rest } = stored;
    if (await commit(db, owner, rest, row.revision, { upsert: leads, remove: [] }))
      return loadWorkspace(db, owner);
  }
  const raw = { ...stored, leads: await loadLeads(db, owner) };
  // Older records are upgraded in memory with schema defaults.
  const parsed = stateSchema.safeParse(raw);
  return { state: parsed.success ? parsed.data : raw, revision: row.revision };
}

const short = z.string().max(300);
export const saveSchema = z.object({
  state: stateSchema,
  revision: z.number().int().nonnegative(),
  leads: z.object({
    upsert: z.array(leadSchema).max(100_000),
    remove: z.array(short).max(100_000),
    events: z.object({ insert: z.array(contactEventSchema).max(20_000) }).optional(),
    suppression: z
      .object({ add: z.array(suppressionSchema).max(50_000), remove: z.array(short).max(50_000) })
      .optional(),
  }),
});
export type SaveRequest = z.infer<typeof saveSchema>;

/** Validates and applies a save. Returns an error message and HTTP status, or the new revision. */
export async function saveWorkspace(db: D1Database, owner: string, body: SaveRequest) {
  const { state, revision, leads } = body;
  const campaigns = new Map(state.campaigns.map((c) => [c.id, c]));
  if (campaigns.size !== state.campaigns.length) return { error: "Duplicate record IDs are not allowed.", status: 400 };
  const upsertIds = new Set(leads.upsert.map((l) => l.id));
  if (upsertIds.size !== leads.upsert.length) return { error: "Duplicate record IDs are not allowed.", status: 400 };
  if (leads.upsert.some((l) => !campaigns.has(l.campaignId)))
    return { error: "Every lead must belong to an existing campaign.", status: 400 };
  const existing = await db
    .prepare("SELECT id, campaign_id FROM leads WHERE owner = ?")
    .bind(owner)
    .all<{ id: string; campaign_id: string }>();
  const removed = new Set(leads.remove);
  const finalIds = new Set(existing.results.map((r) => r.id).filter((id) => !removed.has(id)));
  for (const id of upsertIds) finalIds.add(id);
  if (existing.results.some((r) => !removed.has(r.id) && !upsertIds.has(r.id) && !campaigns.has(r.campaign_id)))
    return { error: "Every lead must belong to an existing campaign.", status: 400 };
  if (state.drafts.some((d) => !finalIds.has(d.leadId)))
    return { error: "Every draft must belong to an existing lead.", status: 400 };
  if (
    new Set(state.drafts.map((d) => d.id)).size !== state.drafts.length ||
    new Set(state.templates.map((t) => t.id)).size !== state.templates.length
  )
    return { error: "Duplicate record IDs are not allowed.", status: 400 };
  for (const lead of leads.upsert) {
    const error = glossLeadError(lead, campaigns.get(lead.campaignId));
    if (error) return { error, status: 400 };
    if (lead.project && !campaigns.get(lead.campaignId)?.custom)
      return { error: "Lead project details can only belong to a custom lead project.", status: 400 };
  }
  if (state.campaigns.some((c) => c.custom && isGloss(c)))
    return { error: "A custom lead project cannot also be a Gloss campaign.", status: 400 };
  for (const e of leads.events?.insert ?? [])
    if (!campaigns.get(e.campaignId)?.custom || !finalIds.has(e.leadId))
      return { error: "Every contact event must belong to a lead in a custom lead project.", status: 400 };
  // If a campaign's audience changed, its stored leads must still fit it.
  const storedRow = await db.prepare("SELECT data FROM workspaces WHERE owner = ?").bind(owner).first<{ data: string }>();
  const stored = storedRow ? (JSON.parse(storedRow.data) as Workspace) : emptyWorkspace();
  const changed = state.campaigns.filter((c) => stored.campaigns.find((s) => s.id === c.id && s.audience !== c.audience));
  for (const c of changed)
    for (const lead of await loadLeads(db, owner, c.id))
      if (!upsertIds.has(lead.id) && !removed.has(lead.id)) {
        const error = glossLeadError(lead, c);
        if (error) return { error, status: 400 };
      }
  const { leads: _ignored, ...rest } = state;
  void _ignored;
  if (!(await commit(db, owner, rest, revision, leads)))
    return { error: "This workspace changed in another tab. Reload before saving again; your input has been kept.", status: 409 };
  return { revision: revision + 1 };
}
