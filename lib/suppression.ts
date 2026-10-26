// Workspace-wide do-not-contact list: phones, emails, website domains,
// Instagram handles and business names. Checked during discovery and delivery.
import { normalizeHandle, uid, now, type Lead } from "./leadgen.ts";
import { registrableDomain, normalizeName } from "./dedupe.ts";
import { normalizePhone } from "./phone.ts";
import type { Suppression } from "./project-schema.ts";

type Kind = Suppression["kind"];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canonical form of a value, or "" when it is not valid for the kind. */
export function normalizeEntry(kind: Kind, raw: string) {
  const v = raw.trim();
  if (!v) return "";
  switch (kind) {
    case "phone":
      return normalizePhone(v)?.e164 ?? "";
    case "email":
      return emailRe.test(v) ? v.toLowerCase() : "";
    case "domain":
      return registrableDomain(v.includes("@") ? v.split("@")[1] : v);
    case "handle":
      return normalizeHandle(v);
    case "name":
      return normalizeName(v);
  }
}
/** Guesses what a bare value is, for CSV imports without a kind column. */
export function detectKind(raw: string): Kind {
  const v = raw.trim();
  if (emailRe.test(v)) return "email";
  if (/^@|instagram\.com\//i.test(v)) return "handle";
  if (/^[+\d][\d\s().-]{5,}$/.test(v) && normalizePhone(v)) return "phone";
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(v) && !/\s/.test(v)) return "domain";
  return "name";
}
/** Every suppressible identifier of a lead. */
export function leadEntries(l: Lead): { kind: Kind; value: string }[] {
  const out: { kind: Kind; value: string }[] = [];
  const add = (kind: Kind, raw: string) => {
    const value = normalizeEntry(kind, raw);
    if (value && !out.some((e) => e.kind === kind && e.value === value)) out.push({ kind, value });
  };
  add("phone", l.project?.phoneE164 || l.phone);
  add("email", l.email);
  add("domain", l.website);
  add("handle", l.creator?.instagram || l.creator?.instagramUrl || "");
  return out;
}
export type SuppressionIndex = Set<string>;
export const suppressionIndex = (list: Pick<Suppression, "kind" | "value">[]): SuppressionIndex =>
  new Set(list.map((s) => `${s.kind}:${s.value}`));
export function isSuppressed(l: Lead, index: SuppressionIndex) {
  if (!index.size) return false;
  return [...leadEntries(l), { kind: "name" as Kind, value: normalizeName(l.name) }].some((e) => e.value && index.has(`${e.kind}:${e.value}`));
}
/** Entries added when a lead is marked Do not contact (the name is not added: other outlets may share it). */
export function doNotContactEntries(l: Lead, at = now()): Suppression[] {
  return leadEntries(l).map((e) => ({ id: uid(), ...e, reason: `Do not contact: ${l.name}`.slice(0, 300), origin: "do-not-contact", createdAt: at }));
}

function csvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (quoted && s[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
/**
 * Parses a CSV of entries. Accepted headers: value + optional kind and reason,
 * or one column per kind (phone, email, domain, handle, name). Without a
 * header, each cell's kind is detected.
 */
export function parseSuppressionCSV(input: string, at = now()) {
  const rows = csvRows(input);
  const kinds: Kind[] = ["phone", "email", "domain", "handle", "name"];
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const hasHeader = head.includes("value") || head.some((h) => (kinds as string[]).includes(h));
  const entries: Suppression[] = [];
  const invalid: string[] = [];
  const push = (kind: Kind, raw: string, reason = "") => {
    if (!raw.trim()) return;
    const value = normalizeEntry(kind, raw);
    if (!value) return void invalid.push(raw.trim());
    if (!entries.some((e) => e.kind === kind && e.value === value))
      entries.push({ id: uid(), kind, value, reason: reason.slice(0, 300), origin: "csv", createdAt: at });
  };
  for (const r of hasHeader ? rows.slice(1) : rows) {
    if (!hasHeader) {
      for (const c of r) push(detectKind(c), c);
      continue;
    }
    const get = (h: string) => r[head.indexOf(h)] ?? "";
    const reason = head.includes("reason") ? get("reason") : "";
    if (head.includes("value")) {
      const k = get("kind").trim().toLowerCase();
      push((kinds as string[]).includes(k) ? (k as Kind) : detectKind(get("value")), get("value"), reason);
    }
    for (const k of kinds) if (head.includes(k)) push(k, get(k), reason);
  }
  return { entries, invalid };
}
