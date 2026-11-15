import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, sameOrigin } from "@/lib/server-store";
import { instagramKeywordSchema, keywordStatus, searchInstagramKeywords } from "@/lib/instagram-keyword";
import { PlacesError, type PlaceEnv } from "@/lib/places-providers";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  const user = await getChatGPTUser(); if (!user) return json({ error: "Sign in required." }, 401);
  try { return json(await keywordStatus(database(), env as unknown as PlaceEnv)); }
  catch { return json({ error: "Keyword search status unavailable." }, 503); }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser(); if (!user) return json({ error: "Sign in required." }, 401);
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const text = await request.text(); if (text.length > 2000) return json({ error: "Request too large." }, 413);
    const input = instagramKeywordSchema.safeParse(JSON.parse(text)); if (!input.success) return json({ error: input.error.issues[0]?.message || "Invalid search." }, 400);
    const settings = env as unknown as PlaceEnv;
    const results = await searchInstagramKeywords(database(), user.userId, input.data, settings);
    return json({ results, status: await keywordStatus(database(), settings) });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    if (error instanceof PlacesError) return json({ error: error.message }, error.status);
    return json({ error: "Keyword search could not complete. The attempt may count toward the limit; retry only after checking the connection." }, 503);
  }
}
