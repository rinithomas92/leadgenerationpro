import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { equalSecret, ownerCookie, ownerSession } from "@/lib/owner-auth";
import { postgresPool } from "@/lib/postgres-d1";
export async function POST(request: Request) {
  if (process.env.LEADGEN_HOSTING !== "vercel") return new Response("Unavailable", { status: 404 });
  const origin = request.headers.get("origin");
  let validOrigin = false;
  try { validOrigin = !!origin && new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); } catch {}
  if (!validOrigin) return new Response("Invalid request origin", { status: 403 });
  if (!process.env.LEADGEN_LOGIN_PASSWORD || !process.env.LEADGEN_SESSION_SECRET) return new Response("Sign-in unavailable", { status: 503 });
  const text = await request.text();
  if (text.length > 2000) return new Response("Request too large", { status: 413 });
  const password = new URLSearchParams(text).get("password") ?? "";
  const ip = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown";
  const key = createHmac("sha256", process.env.LEADGEN_SESSION_SECRET).update(ip).digest("hex");
  const result = await postgresPool().query(`INSERT INTO leadgen.login_attempts(key,attempts,expires) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.expires<now() THEN 1 ELSE login_attempts.attempts+1 END,
    expires=CASE WHEN login_attempts.expires<now() THEN now()+interval '15 minutes' ELSE login_attempts.expires END RETURNING attempts`, [key]);
  if (result.rows[0].attempts > 10) return new Response("Too many sign-in attempts. Please try again in 15 minutes.", { status: 429 });
  if (!equalSecret(password, process.env.LEADGEN_LOGIN_PASSWORD)) return new Response("Incorrect workspace password. Go back and try again.", { status: 401 });
  await postgresPool().query("DELETE FROM leadgen.login_attempts WHERE key=$1 OR expires<now()", [key]);
  const response = NextResponse.redirect(new URL("/", origin!), 303);
  response.cookies.set(ownerCookie, ownerSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  return response;
}
