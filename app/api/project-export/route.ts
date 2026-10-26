import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/server-store";
import { loadDocument, loadLeads } from "@/lib/workspace-store";
import { loadDeliveries, loadEvents } from "@/lib/project-store";
import { batchWorkbook, masterWorkbook } from "@/lib/project-export";
import { isCustom } from "@/lib/ledger";
import { xlsxType } from "@/lib/xlsx";
import { insights, outcomesSheet } from "@/lib/outcomes";
import { tierLabel } from "@/lib/allocation";
import { homeLabel } from "@/lib/ledger";
export const dynamic = "force-dynamic";

/**
 * GET /api/project-export?campaign=<id>&delivery=<id> — one batch's workbook.
 * Without `delivery`, the project's master workbook with every lead.
 */
export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("campaign") || "";
  const deliveryId = params.get("delivery") || "";
  try {
    const db = database();
    const state = await loadDocument(db, user.userId);
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!isCustom(campaign)) return Response.json({ error: "Lead project not found." }, { status: 404 });
    const [leads, deliveries] = await Promise.all([loadLeads(db, user.userId, id), loadDeliveries(db, user.userId, id)]);
    let file;
    if (deliveryId) {
      const delivery = deliveries.find((d) => d.id === deliveryId);
      if (!delivery) return Response.json({ error: "Batch not found." }, { status: 404 });
      file = batchWorkbook(campaign, delivery, leads);
    } else {
      const events = await loadEvents(db, user.userId, id);
      const p = campaign.custom;
      const data = insights(leads, events, {
        tier: (t) => tierLabel(t as never, homeLabel(p)),
        segment: (s) => p.segments.find((x) => x.id === s)?.label ?? "Removed segment",
        template: (tid, v) => `${p.templates.find((t) => t.id === tid)?.name ?? tid} v${v}`,
      });
      file = masterWorkbook(campaign, leads, deliveries, events, undefined, outcomesSheet(data));
    }
    return new Response(file.body, {
      headers: {
        "Content-Type": xlsxType,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^\w.-]/g, "_")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Project export failed", e);
    return Response.json({ error: "The workbook could not be created. Please retry." }, { status: 503 });
  }
}
