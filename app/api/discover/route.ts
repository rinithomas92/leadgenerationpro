import { getChatGPTUser } from "@/app/chatgpt-auth";
import { sameOrigin } from "@/lib/server-store";
import { campaignSchema, reportSchema, scopes } from "@/lib/leadgen";
import { plan } from "@/lib/discovery-engine";
import { loadRegions, resolveGeo, runStep } from "@/lib/discovery-net";
import { z } from "zod";

const place = z.object({
  name: z.string().max(200),
  areaId: z.number().int().optional(),
  wikidata: z.string().regex(/^Q\d+$/).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  code: z.string().max(10).optional(),
});
const geoSchema = z.object({
  input: z.string().max(300),
  locality: place.optional(),
  city: place.optional(),
  state: place.optional(),
  country: place.optional(),
  regions: z.array(z.object({ name: z.string().max(200), areaId: z.number().int() })).max(80).optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), campaign: campaignSchema }),
  z.object({ action: z.literal("regions"), geo: geoSchema }),
  z.object({
    action: z.literal("step"),
    campaign: campaignSchema,
    geo: geoSchema,
    step: z.object({
      source: z.enum(["osm", "wikidata", "research"]),
      scope: z.enum(scopes),
      region: z.object({ name: z.string().max(200), areaId: z.number().int() }).optional(),
      cursor: z.number().int().nonnegative().optional(),
    }),
  }),
]);
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!(await getChatGPTUser())) return json({ error: "Sign in required." }, 401);
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 40000) return json({ error: "Campaign is too large." }, 413);
    const parsed = requestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Select a valid campaign." }, 400);
    const body = parsed.data;
    if (body.action === "plan") {
      const resolved = await resolveGeo(body.campaign.location);
      const { steps, skipped } = plan(body.campaign, resolved.geo);
      return json({
        geo: resolved.geo,
        steps,
        skipped: z.array(reportSchema).parse(skipped),
        report: resolved.report,
      });
    }
    if (body.action === "regions") return json({ regions: await loadRegions(body.geo) });
    const result = await runStep(body.campaign, body.geo, body.step);
    return json(result);
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON request." }, 400);
    // Location resolution failures are reported to the user, never hidden.
    return json({ error: e instanceof Error ? e.message : "Discovery failed." }, 502);
  }
}
