import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, sameOrigin } from "@/lib/server-store";
import { emptyWorkspace, stateSchema } from "@/lib/leadgen";
import { z } from "zod";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in to load your workspace." }, 401);
  try {
    const db = database();
    await db
      .prepare(
        "INSERT OR IGNORE INTO workspaces (owner, data, revision) VALUES (?, ?, 0)",
      )
      .bind(user.userId, JSON.stringify(emptyWorkspace()))
      .run();
    const row = await db
      .prepare("SELECT data, revision FROM workspaces WHERE owner = ?")
      .bind(user.userId)
      .first<{ data: string; revision: number }>();
    if (!row) throw new Error("Missing workspace");
    return json({ state: JSON.parse(row.data), revision: row.revision });
  } catch (e) {
    console.error("Workspace load failed", e);
    return json(
      { error: "Your workspace could not be loaded. Please retry." },
      503,
    );
  }
}
export async function PUT(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in to save your workspace." }, 401);
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 1500000)
      return json(
        { error: "Workspace is too large. Export and remove old records." },
        413,
      );
    const parsed = z
      .object({ state: stateSchema, revision: z.number().int().nonnegative() })
      .safeParse(JSON.parse(raw));
    if (!parsed.success)
      return json(
        { error: "Some fields are invalid or exceed the workspace limits." },
        400,
      );
    const { state, revision } = parsed.data;
    const ids = new Set(state.campaigns.map((c) => c.id));
    if (state.leads.some((l) => !ids.has(l.campaignId)))
      return json(
        { error: "Every lead must belong to an existing campaign." },
        400,
      );
    const leadIds = new Set(state.leads.map((l) => l.id));
    if (state.drafts.some((d) => !leadIds.has(d.leadId)))
      return json(
        { error: "Every draft must belong to an existing lead." },
        400,
      );
    if (
      ids.size !== state.campaigns.length ||
      leadIds.size !== state.leads.length ||
      new Set(state.drafts.map((d) => d.id)).size !== state.drafts.length ||
      new Set(state.templates.map((t) => t.id)).size !== state.templates.length
    )
      return json({ error: "Duplicate record IDs are not allowed." }, 400);
    const result = await database()
      .prepare(
        "UPDATE workspaces SET data = ?, revision = revision + 1 WHERE owner = ? AND revision = ?",
      )
      .bind(JSON.stringify(state), user.userId, revision)
      .run();
    if (!result.meta.changes)
      return json(
        {
          error:
            "This workspace changed in another tab. Reload before saving again; your input has been kept.",
        },
        409,
      );
    return json({ state, revision: revision + 1 });
  } catch (e) {
    if (e instanceof SyntaxError)
      return json({ error: "Invalid JSON request." }, 400);
    console.error("Workspace save failed", e);
    return json(
      { error: "Could not save. Your input has been kept; please retry." },
      503,
    );
  }
}
