// Phone cleanup for custom lead projects: E.164 numbers, mobile vs landline,
// and WhatsApp / call links. Uses libphonenumber-js full metadata, which is
// needed to tell mobile numbers from landlines.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneType = "mobile" | "landline" | "either" | "unknown";
export type Phone = { e164: string; display: string; type: PhoneType };

/** Every valid number in a raw field (sources often list several, separated by ; , or /). */
export function parsePhones(raw: string, country = "IN"): Phone[] {
  const out: Phone[] = [];
  for (const part of raw.split(/[;,/|]|\s{2,}/)) {
    const s = part.trim();
    if (!/\d{5}/.test(s.replace(/\D/g, ""))) continue;
    const n = parsePhoneNumberFromString(s, (country || "IN") as CountryCode);
    if (!n || !n.isValid()) continue;
    if (out.some((p) => p.e164 === n.number)) continue;
    const t = n.getType();
    out.push({
      e164: n.number,
      display: n.formatInternational(),
      type: t === "MOBILE" ? "mobile" : t === "FIXED_LINE" ? "landline" : t === "FIXED_LINE_OR_MOBILE" ? "either" : "unknown",
    });
  }
  return out;
}
/** The best number to contact: a mobile when one is listed, else the first valid one. */
export function normalizePhone(raw: string, country = "IN"): Phone | undefined {
  const all = parsePhones(raw, country);
  return all.find((p) => p.type === "mobile") ?? all[0];
}
/** WhatsApp is offered only for numbers that can be mobiles. */
export const canWhatsApp = (type: string) => type === "mobile" || type === "either";
export function waLink(e164: string, text = "") {
  const digits = e164.replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export const telLink = (e164: string) => (e164 ? `tel:${e164.replace(/[^\d+]/g, "")}` : "");
