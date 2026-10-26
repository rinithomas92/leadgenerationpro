import { getChatGPTUser } from "@/app/chatgpt-auth";
import { sameOrigin } from "@/lib/server-store";
import { osmByIds, osmSearch, projectPlan, resolveCountry, subAreas, wikidataPage } from "@/lib/project-net";
import { z } from "zod";

// Discovery for custom lead projects: OpenStreetMap, Wikidata and Nominatim.
// Overture runs in the local sources service, called by the browser directly.
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
});
const osmArea = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("around"), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), m: z.number().min(100).max(100000) }),
  z.object({ kind: z.literal("area"), areaId: z.number().int().positive() }),
]);
const word = z.string().trim().min(1).max(60);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), location: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal("country"), code: z.string().regex(/^[A-Z]{2}$/) }),
  z.object({ action: z.literal("osm-ids"), ids: z.array(z.string().regex(/^(node|way|relation)\/\d{1,15}$/)).min(1).max(300) }),
  z.object({ action: z.literal("subareas"), areaId: z.number().int().positive(), level: z.union([z.literal(4), z.literal(5)]) }),
  z.object({
    action: z.literal("osm"),
    count: z.boolean().default(false),
    query: z.object({
      tags: z.array(z.object({ key: z.string().max(40), values: z.array(z.string().max(60)).min(1).max(20), category: z.string().max(80) })).min(1).max(30),
      include: z.array(word).max(20).default([]),
      exclude: z.array(word).max(20).default([]),
      area: osmArea,
      excludeAreas: z.array(osmArea).max(3).default([]),
    }),
  }),
  z.object({
    action: z.literal("wikidata"),
    occupations: z.array(z.string().regex(/^Q\d+$/)).min(1).max(20),
    countryQid: z.string().regex(/^Q\d+$/),
    scope: z.enum(["city", "state", "country", "global"]),
    geo: geoSchema,
    after: z.number().int().nonnegative().default(0),
  }),
]);
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!(await getChatGPTUser())) return json({ error: "Sign in required." }, 401);
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 40000) return json({ error: "Request is too large." }, 413);
    const parsed = requestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Invalid discovery request." }, 400);
    const b = parsed.data;
    if (b.action === "plan") return json(await projectPlan(b.location));
    if (b.action === "country") return json(await resolveCountry(b.code));
    if (b.action === "subareas") return json({ areas: await subAreas(b.areaId, b.level) });
    if (b.action === "osm") return json(await osmSearch(b.query, b.count));
    if (b.action === "osm-ids") return json({ elements: await osmByIds(b.ids) });
    return json(await wikidataPage(b.occupations, b.countryQid, b.scope, b.geo, b.after));
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON request." }, 400);
    // Source failures are reported to the user, never hidden.
    return json({ error: e instanceof Error ? e.message : "Discovery failed." }, 502);
  }
}
