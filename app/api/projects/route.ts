import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, sameOrigin } from "@/lib/server-store";
import { changeSuppression, deliverBatch, loadDeliveries, loadEvents, loadSuppression, undoBatch } from "@/lib/project-store";
import { normalizeEntry, parseSuppressionCSV } from "@/lib/suppression";
import { suppressionKinds, type Suppression } from "@/lib/project-schema";
import { now, uid } from "@/lib/leadgen";
import { z } from "zod";
export const dynamic = "force-dynamic";

const short = z.string().max(300);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deliver"), campaignId: short, size: z.number().int(), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("undo"), campaignId: short, deliveryId: short, revision: z.number().int().nonnegative() }),
  z.object({
    action: z.literal("suppress"),
    add: z.array(z.object({ kind: z.enum(suppressionKinds), value: short, reason: short.default("") })).max(5000).default([]),
    csv: z.string().max(5_000_000).default(""),
    remove: z.array(short).max(50_000).default([]),
  }),
]);
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Deliveries, contact events and the do-not-contact list for custom lead projects. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  try {
    const db = database();
    const [deliveries, events, suppression] = await Promise.all([
      loadDeliveries(db, user.userId),
      loadEvents(db, user.userId),
      loadSuppression(db, user.userId),
    ]);
    return json({ deliveries, events, suppression });
  } catch (e) {
    console.error("Project data load failed", e);
    return json({ error: "Project data could not be loaded. Please retry." }, 503);
  }
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 6_000_000) return json({ error: "Request is too large." }, 413);
    const parsed = requestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Invalid request." }, 400);
    const body = parsed.data;
    const db = database();
    if (body.action === "deliver") {
      const r = await deliverBatch(db, user.userId, body.campaignId, body.size, body.revision);
      return "error" in r ? json({ error: r.error }, r.status) : json(r);
    }
    if (body.action === "undo") {
      const r = await undoBatch(db, user.userId, body.campaignId, body.deliveryId, body.revision);
      return "error" in r ? json({ error: r.error }, r.status) : json(r);
    }
    const at = now();
    const add: Suppression[] = [];
    const invalid: string[] = [];
    for (const e of body.add) {
      const value = normalizeEntry(e.kind, e.value);
      if (value) add.push({ id: uid(), kind: e.kind, value, reason: e.reason, origin: "manual", createdAt: at });
      else invalid.push(e.value);
    }
    if (body.csv) {
      const csv = parseSuppressionCSV(body.csv, at);
      add.push(...csv.entries);
      invalid.push(...csv.invalid);
    }
    const suppression = await changeSuppression(db, user.userId, add, body.remove);
    return json({ suppression, added: add.length, invalid: invalid.slice(0, 50), invalidCount: invalid.length });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON request." }, 400);
    console.error("Project request failed", e);
    return json({ error: "The request could not be completed. Please retry." }, 503);
  }
}
