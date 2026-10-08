import { env } from "cloudflare:workers";
export function database() {
  if (!env.DB) throw new Error("Database is unavailable.");
  return env.DB;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}
