import { z } from "zod";
import { PlacesError, type PlaceEnv } from "./places-providers.ts";
import { audit } from "./places-store.ts";

const words = z.string().trim().max(120).regex(/^[\p{L}\p{N}\p{M}\s.,'’&+#-]*$/u, "Use ordinary keywords, not URLs or search operators.");
export const instagramKeywordSchema = z.object({ id: z.string().uuid(), keywords: words.refine(v => /[\p{L}\p{N}]/u.test(v), "Enter a keyword."), location: words.default("") });
export type InstagramAccountMatch = { username: string; profileUrl: string; title: string; snippet: string };
export type InstagramKeywordResults = { accounts: InstagramAccountMatch[]; checkedAt: string; reviewed: number; excluded: number; keywords: string; location: string };
export function keywordConfig(env: PlaceEnv) {
  const enabled = env.PLACES_DISABLED !== "true" && env.INSTAGRAM_KEYWORD_ENABLED === "true" && !!env.BRAVE_SEARCH_API_KEY;
  const cap = Math.floor(Math.max(0, Math.min(100, Number(env.INSTAGRAM_KEYWORD_DAILY_CAP || 20) || 0)));
  return { enabled, cap, period: new Date().toISOString().slice(0, 10), reason: env.PLACES_DISABLED === "true" ? "Places Discovery is disabled." : !env.BRAVE_SEARCH_API_KEY ? "Connect a Brave Search API key to show keyword matches here. You can still open an external web search below." : !enabled ? "Keyword search is configured but disabled. Enable it after reviewing your search plan and request cap." : "Search publicly indexed Instagram profiles through Brave Search. Coverage and freshness depend on the web index." };
}
export async function keywordStatus(db: D1Database, env: PlaceEnv) {
  const config = keywordConfig(env);
  const row = await db.prepare("SELECT used FROM places_quota WHERE meter='instagram-keyword' AND period=?").bind(config.period).first<{ used: number }>();
  return { ...config, used: row?.used || 0 };
}
export function instagramProfileURL(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
    const path = url.pathname.match(/^\/([a-zA-Z0-9_][a-zA-Z0-9_.]{0,29})\/?$/);
    if (!path || path[1].endsWith(".") || path[1].includes("..")) return null;
    const username = path[1].toLowerCase();
    if (["p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "about", "developer", "developers", "legal", "privacy", "terms", "web", "api", "challenge", "emails", "directory", "press", "download"].includes(username)) return null;
    return { username, profileUrl: `https://www.instagram.com/${username}/` };
  } catch { return null; }
}
export function instagramWebQuery(keywords: string, location: string) {
  return `site:instagram.com ${keywords.trim()} ${location.trim()} -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/`.replace(/\s+/g, " ").trim();
}
const responseSchema = z.object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string().optional(), description: z.string().optional() })).max(100).optional() }).optional() });
const plain = (value = "", max = 600) => value.replace(/<[^>]*>/g, "").slice(0, max);
export async function fetchInstagramKeywords(input: z.infer<typeof instagramKeywordSchema>, env: PlaceEnv, fetcher: typeof fetch = fetch): Promise<InstagramKeywordResults> {
  const config = keywordConfig(env); if (!config.enabled) throw new PlacesError(config.reason, 403);
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", instagramWebQuery(input.keywords, input.location));
  url.searchParams.set("count", "20"); url.searchParams.set("result_filter", "web"); url.searchParams.set("safesearch", "strict"); url.searchParams.set("text_decorations", "false");
  const response = await fetcher(url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY! }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new PlacesError("Search access was denied. Check the Brave API key and subscription.", 403);
    if (response.status === 429) throw new PlacesError("The search provider's request limit was reached. Try again later.", 429);
    throw new PlacesError("The search provider is unavailable. No automatic retry was sent.", 502);
  }
  const reader = response.body?.getReader(); if (!reader) throw new PlacesError("Search returned an empty response.", 502);
  const decoder = new TextDecoder(); let size = 0, body = "";
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 500_000) { await reader.cancel(); throw new PlacesError("Search response exceeded the size limit.", 502); } body += decoder.decode(part.value, { stream: true }); }
  body += decoder.decode();
  let parsed: ReturnType<typeof responseSchema.safeParse>;
  try { parsed = responseSchema.safeParse(JSON.parse(body)); } catch { throw new PlacesError("Search returned an unreadable response.", 502); }
  if (!parsed.success) throw new PlacesError("Search returned an unsupported response.", 502);
  const rows = (parsed.data.web?.results || []).slice(0, 20), accounts: InstagramAccountMatch[] = [], seen = new Set<string>();
  for (const row of rows) {
    const profile = instagramProfileURL(row.url); if (!profile || seen.has(profile.username)) continue;
    seen.add(profile.username); accounts.push({ ...profile, title: plain(row.title, 250) || `@${profile.username}`, snippet: plain(row.description) });
  }
  return { accounts, checkedAt: new Date().toISOString(), reviewed: rows.length, excluded: rows.length - accounts.length, keywords: input.keywords, location: input.location };
}
export async function searchInstagramKeywords(db: D1Database, owner: string, input: z.infer<typeof instagramKeywordSchema>, env: PlaceEnv, fetcher: typeof fetch = fetch) {
  const config = keywordConfig(env); if (!config.enabled) throw new PlacesError(config.reason, 403);
  const claimed = await db.prepare("INSERT OR IGNORE INTO places_requests(owner,id,meter,period,at,operation) VALUES(?,?,'instagram-keyword',?,?,'Public profile keyword search')").bind(owner, input.id, config.period, new Date().toISOString()).run();
  if (!claimed.meta.changes) throw new PlacesError("This search was already attempted. Start a new search to refresh.", 409);
  await db.prepare("INSERT OR IGNORE INTO places_quota(meter,period,used) VALUES('instagram-keyword',?,0)").bind(config.period).run();
  const reserved = await db.prepare("UPDATE places_quota SET used=used+1 WHERE meter='instagram-keyword' AND period=? AND used<? RETURNING used").bind(config.period, config.cap).first();
  if (!reserved) throw new PlacesError("Daily keyword-search cap reached. No search was sent.", 429);
  await audit(db, owner, "instagram_keyword_dispatched", input.id);
  try { const results = await fetchInstagramKeywords(input, env, fetcher); await audit(db, owner, "instagram_keyword_completed", input.id); return results; }
  catch (error) { await audit(db, owner, "instagram_keyword_failed", input.id); throw error; }
}
