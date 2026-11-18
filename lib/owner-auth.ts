import { createHmac, timingSafeEqual } from "node:crypto";
export const ownerCookie = "leadgen_owner_session";
export const ownerId = "leadgen-owner";
export function equalSecret(a: string, b: string) {
  const hash = (s: string) => createHmac("sha256", "leadgen-compare").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
function signature(payload: string) {
  const key = process.env.LEADGEN_SESSION_SECRET;
  if (!key || key.length < 32) throw new Error("Sign-in is not configured.");
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function ownerSession() {
  const payload = String(Date.now() + 7 * 86400000);
  return `${payload}.${signature(payload)}`;
}
export function validOwnerSession(value: string) {
  if (!process.env.LEADGEN_SESSION_SECRET) return false;
  const [payload, mac, extra] = value.split(".");
  return !extra && !!mac && /^\d+$/.test(payload) && Number(payload) > Date.now() && equalSecret(mac, signature(payload));
}
