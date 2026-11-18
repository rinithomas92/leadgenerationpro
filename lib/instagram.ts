import { z } from "zod";
import { publicUrl } from "./places.ts";
import { PlacesError, type PlaceEnv } from "./places-providers.ts";
import { audit } from "./places-store.ts";

export const instagramUsername = z.string().trim().transform(v => v.replace(/^@/, "").toLowerCase())
  .pipe(z.string().min(1).max(30).regex(/^[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])?$/, "Enter an Instagram username, without a URL or spaces."));
export const instagramLookup = z.object({ id: z.string().uuid(), username: instagramUsername });
export type InstagramProfile = { username: string; name: string; biography: string; website: string; followers: number | null; mediaCount: number | null; profileUrl: string; checkedAt: string };
export function instagramConfig(env: PlaceEnv) {
  const configured = !!env.INSTAGRAM_ACCESS_TOKEN && /^\d+$/.test(env.INSTAGRAM_ACCOUNT_ID || "") && /^v\d+\.0$/.test(env.INSTAGRAM_GRAPH_VERSION || "");
  const enabled = env.PLACES_DISABLED !== "true" && env.INSTAGRAM_ENABLED === "true" && configured;
  const cap = Math.floor(Math.max(0, Math.min(200, Number(env.INSTAGRAM_DAILY_CAP || 200) || 0)));
  return { enabled, cap, period: new Date().toISOString().slice(0, 10), reason: env.PLACES_DISABLED === "true" ? "Places Discovery is disabled." : !configured ? "Not connected. Configure a Facebook Login access token, your Instagram professional account ID, and a supported Graph API version." : !enabled ? "Configured but disabled. Enable after checking Meta app permissions and account access." : "Professional-account lookup enabled. Meta permissions and rate limits still apply." };
}
export async function instagramStatus(db: D1Database, env: PlaceEnv) {
  const config = instagramConfig(env);
  const row = await db.prepare("SELECT used FROM places_quota WHERE meter='instagram' AND period=?").bind(config.period).first<{ used: number }>();
  const hour = await db.prepare("SELECT used FROM places_quota WHERE meter='instagram-hour' AND period=?").bind(new Date().toISOString().slice(0, 13)).first<{ used: number }>();
  const pause = await db.prepare("SELECT used FROM places_quota WHERE meter='instagram-pause' AND period='until'").first<{ used: number }>();
  const paused = (pause?.used || 0) > Date.now() / 1000;
  const remaining = paused ? 0 : Math.max(0, Math.min(config.cap - (row?.used || 0), 60 - (hour?.used || 0)));
  const reason = paused ? `Instagram is cooling down after Meta usage feedback. Try after ${new Date(pause!.used * 1000).toISOString()}.` : remaining === 0 ? "Instagram application limit reached. Daily limits reset at 00:00 UTC; hourly limits reset on the next UTC hour." : config.reason;
  return { ...config, reason, used: row?.used || 0, hourlyCap: 60, hourlyUsed: hour?.used || 0, remaining, paused };
}
export async function reserveInstagram(db: D1Database, owner: string, id: string, env: PlaceEnv) {
  const config = instagramConfig(env);
  if (!config.enabled) throw new PlacesError(config.reason, 403);
  const status = await instagramStatus(db, env);
  if (status.paused) throw new PlacesError(status.reason, 429);
  // Claim the request ID before reserving or dispatching. A lost response is not
  // replayed: provider content is deliberately absent from the durable ledger.
  const claim = await db.prepare("INSERT OR IGNORE INTO places_requests(owner,id,meter,period,at,operation) VALUES(?,?,'instagram',?,?,?)")
    .bind(owner, id, config.period, new Date().toISOString(), "Business Discovery attempt").run();
  if (!claim.meta.changes) throw new PlacesError("This lookup was already attempted. Submit a new lookup to refresh; another request may count toward your limit.", 409);
  const hour = new Date().toISOString().slice(0, 13);
  await db.prepare("INSERT OR IGNORE INTO places_quota(meter,period,used) VALUES('instagram-hour',?,0)").bind(hour).run();
  const hourly = await db.prepare("UPDATE places_quota SET used=used+1 WHERE meter='instagram-hour' AND period=? AND used<60 RETURNING used").bind(hour).first();
  if (!hourly) throw new PlacesError("Instagram hourly application limit reached (60). Try after the next UTC hour. No lookup was sent.", 429);
  await db.prepare("INSERT OR IGNORE INTO places_quota(meter,period,used) VALUES('instagram',?,0)").bind(config.period).run();
  const won = await db.prepare("UPDATE places_quota SET used=used+1 WHERE meter='instagram' AND period=? AND used<? RETURNING used").bind(config.period, config.cap).first();
  if (!won) throw new PlacesError("Instagram daily application limit reached. No additional lookup was sent.", 429);
}
const profileSchema = z.object({ business_discovery: z.object({
  username: instagramUsername, name: z.string().max(300).optional(), biography: z.string().max(2500).optional(),
  website: z.string().optional(), followers_count: z.number().int().nonnegative().optional(), media_count: z.number().int().nonnegative().optional(),
}).optional() });
export async function fetchInstagramProfile(username: string, env: PlaceEnv, fetcher: typeof fetch = fetch): Promise<InstagramProfile> {
  const config = instagramConfig(env);
  if (!config.enabled) throw new PlacesError(config.reason, 403);
  const handle = instagramUsername.parse(username);
  const url = new URL(`https://graph.facebook.com/${env.INSTAGRAM_GRAPH_VERSION}/${env.INSTAGRAM_ACCOUNT_ID}`);
  url.searchParams.set("fields", `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count}`);
  if (env.INSTAGRAM_APP_SECRET) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(env.INSTAGRAM_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(env.INSTAGRAM_ACCESS_TOKEN!));
    url.searchParams.set("appsecret_proof", Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join(""));
  }
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) throw new PlacesError("Meta rate limited this lookup. Wait before starting a new request.", 429);
    if ([400, 401, 403].includes(response.status)) throw new PlacesError("Meta denied this lookup. Check token expiry, required permissions, app access level and whether the target is an eligible professional account.", 403);
    throw new PlacesError("Instagram is temporarily unavailable. No automatic retry was sent.", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PlacesError("Instagram returned an empty response.", 502);
  const decoder = new TextDecoder(); let bytes = 0, body = "";
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 100_000) { await reader.cancel(); throw new PlacesError("Instagram response exceeded the size limit.", 502); } body += decoder.decode(chunk.value, { stream: true }); }
  body += decoder.decode();
  let parsed: ReturnType<typeof profileSchema.safeParse>;
  try { parsed = profileSchema.safeParse(JSON.parse(body)); } catch { throw new PlacesError("Instagram returned an unreadable response.", 502); }
  if (!parsed.success) throw new PlacesError("Instagram returned an unsupported profile response.", 502);
  const profile = parsed.data.business_discovery;
  if (!profile) throw new PlacesError("No eligible professional profile was returned. Personal, unavailable or age-restricted accounts may not be accessible.", 404);
  return { username: profile.username, name: profile.name || "", biography: profile.biography || "", website: publicUrl(profile.website || ""), followers: profile.followers_count ?? null, mediaCount: profile.media_count ?? null, profileUrl: `https://www.instagram.com/${profile.username}/`, checkedAt: new Date().toISOString() };
}
export async function lookupInstagram(db: D1Database, owner: string, input: z.infer<typeof instagramLookup>, env: PlaceEnv, fetcher: typeof fetch = fetch) {
  await reserveInstagram(db, owner, input.id, env);
  await audit(db, owner, "instagram_lookup_dispatched", input.id);
  try {
    const profile = await fetchInstagramProfile(input.username, env, async (url, init) => {
      const response = await fetcher(url, init);
      const seconds = await instagramCooldown(response);
      if (seconds) {
        const until = Math.ceil(Date.now() / 1000) + seconds;
        await db.prepare("INSERT INTO places_quota(meter,period,used) VALUES('instagram-pause','until',?) ON CONFLICT(meter,period) DO UPDATE SET used=CASE WHEN excluded.used>places_quota.used THEN excluded.used ELSE places_quota.used END").bind(until).run();
        if (!response.ok) { await response.body?.cancel(); throw new PlacesError("Meta requested a pause. Instagram lookups are temporarily paused; check the connection status for the retry time.", 429); }
      }
      return response;
    });
    await audit(db, owner, "instagram_lookup_completed", input.id);
    return profile;
  } catch (error) { await audit(db, owner, "instagram_lookup_failed", input.id); throw error; }
}

export async function instagramCooldown(response: Response): Promise<number> {
  let pause = response.status === 429, wait = 3600;
  const inspect = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 8) return;
    for (const [key, item] of Object.entries(value)) {
      if (["call_count", "total_cputime", "total_time"].includes(key) && typeof item === "number" && item >= 80) pause = true;
      if (key === "estimated_time_to_regain_access" && typeof item === "number" && Number.isFinite(item) && item > 0) { pause = true; wait = Math.max(wait, Math.ceil(item * 60)); }
      if (typeof item === "object") inspect(item, depth + 1);
    }
  };
  for (const name of ["x-app-usage", "x-business-use-case-usage"]) {
    const value = response.headers.get(name);
    if (value && value.length < 16000) { try { inspect(JSON.parse(value)); } catch {} }
  }
  if (!response.ok) {
    const reader = response.clone().body?.getReader();
    if (reader) {
      let text = "", size = 0;
      const decoder = new TextDecoder();
      try {
        while (size <= 16000) { const part = await reader.read(); if (part.done) break; size += part.value.length; text += decoder.decode(part.value, { stream: true }); }
        if (size <= 16000) { const code = JSON.parse(text)?.error?.code; if ([4, 17, 32, 613, 80002].includes(code)) pause = true; }
      } catch {} finally { void reader.cancel(); }
    }
  }
  const retry = response.headers.get("retry-after");
  if (pause && retry) {
    const delay = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
    if (Number.isFinite(delay)) wait = Math.max(wait, Math.ceil(delay));
  }
  return pause ? wait : 0;
}
