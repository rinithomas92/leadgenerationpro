import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, sameOrigin } from "@/lib/server-store";
import { loadWorkspace, saveSchema, saveWorkspace } from "@/lib/workspace-store";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in to load your workspace." }, 401);
  try {
    return json(await loadWorkspace(database(), user.userId));
  } catch (e) {
    console.error("Workspace load failed", e);
    return json({ error: "Your workspace could not be loaded. Please retry." }, 503);
  }
}
// Saves carry the workspace document plus only the leads that changed.
export async function PUT(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in to save your workspace." }, 401);
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 60_000_000)
      return json({ error: "This change is too large to save at once." }, 413);
    const parsed = saveSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return json({ error: "Some fields are invalid or exceed the workspace limits." }, 400);
    if (JSON.stringify({ ...parsed.data.state, leads: [] }).length > 1_500_000)
      return json({ error: "Workspace settings are too large. Remove old drafts or templates." }, 413);
    const result = await saveWorkspace(database(), user.userId, parsed.data);
    if ("error" in result) return json({ error: result.error }, result.status);
    return json(result);
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON request." }, 400);
    console.error("Workspace save failed", e);
    return json({ error: "Could not save. Your input has been kept; please retry." }, 503);
  }
}
