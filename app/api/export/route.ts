import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/server-store";
import { loadDocument, loadLeads } from "@/lib/workspace-store";
import { campaignWorkbook } from "@/lib/campaign-export";
export const dynamic = "force-dynamic";

/** GET /api/export?campaign=<id> — the campaign's complete lead workbook. */
export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("campaign") || "";
  try {
    const db = database();
    const state = await loadDocument(db, user.userId);
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const { body, filename } = campaignWorkbook(campaign, await loadLeads(db, user.userId, id));
    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Export failed", e);
    return Response.json({ error: "The export could not be created. Please retry." }, { status: 503 });
  }
}
