import { env } from "cloudflare:workers";
export function database() {
  if (!env.DB) throw new Error("Database is unavailable.");
  return env.DB;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get("host") || new URL(req.url).host); }
  catch { return false; }
}
