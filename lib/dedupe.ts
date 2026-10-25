// Dedupe and merge for custom lead projects. One place found by several
// sources (Overture, OpenStreetMap, Wikidata) becomes one lead that keeps every
// source link; branches of a chain stay separate.
import { distanceKm } from "./discovery-engine.ts";
import { normalizeHandle, now, safeUrl, type Lead } from "./leadgen.ts";

// Hosts shared by unrelated businesses, so they never identify one lead.
export const genericHosts = [
  "linktr.ee", "wa.me", "whatsapp.com", "facebook.com", "fb.com", "instagram.com", "google.com",
  "goo.gl", "g.page", "business.site", "justdial.com", "indiamart.com", "sites.google.com",
  "blogspot.com", "wordpress.com", "wixsite.com", "youtube.com", "linkedin.com", "twitter.com",
  "x.com", "tiktok.com", "bit.ly", "sulekha.com", "zomato.com", "swiggy.com", "practo.com",
  "tripadvisor.com", "booking.com", "magicbricks.com", "99acres.com", "housing.com",
];
// Two-part public suffixes common in the data; enough to find a registrable domain.
const secondLevel = new Set([
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "edu.in", "res.in", "firm.in", "gen.in", "ind.in",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.za",
  "com.sg", "com.my", "com.br", "com.mx", "com.ar", "com.tr", "com.cn", "com.hk", "com.tw",
  "co.id", "co.kr", "com.pk", "com.bd", "com.np", "com.lk", "co.ae", "com.sa", "com.qa", "com.eg",
]);
export function registrableDomain(url: string) {
  const safe = safeUrl(url.trim()) || safeUrl("https://" + url.trim().replace(/^\/+/, ""));
  if (!safe) return "";
  const host = new URL(safe).hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
  const parts = host.split(".");
  const two = parts.slice(-2).join(".");
  const domain = secondLevel.has(two) && parts.length > 2 ? parts.slice(-3).join(".") : two;
  return genericHosts.some((g) => host === g || host.endsWith("." + g) || domain === g) ? "" : domain;
}

// ---------- Geohash ----------
const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat: number, lon: number, precision = 7) {
  let [latLo, latHi, lonLo, lonHi] = [-90, 90, -180, 180];
  let hash = "", bits = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonLo = mid; } else { ch <<= 1; lonHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; } else { ch <<= 1; latHi = mid; }
    }
    even = !even;
    if (++bits === 5) {
      hash += base32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}
/** The cell and its 8 neighbours (precision 7 cells are about 150 m wide). */
export function geohashArea(lat: number, lon: number, precision = 7) {
  const lonBits = Math.ceil((precision * 5) / 2), latBits = Math.floor((precision * 5) / 2);
  const dLat = 180 / 2 ** latBits, dLon = 360 / 2 ** lonBits;
  const cells = new Set<string>();
  for (const a of [-1, 0, 1])
    for (const b of [-1, 0, 1])
      cells.add(geohash(Math.max(-90, Math.min(90, lat + a * dLat)), ((lon + b * dLon + 540) % 360) - 180, precision));
  return [...cells];
}

export function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\b(the|pvt|private|ltd|limited|llp|inc|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Keys ----------
export type Keys = { strong: string[]; weak: string[]; near: string[] };
/**
 * Strong keys (source record ids) always identify the same lead. Weak keys
 * (phone, website domain, Instagram handle) match only nearby records, so
 * branches of a chain sharing one number or website stay separate. Near keys
 * are the normalised name in the surrounding ~100 m geohash cells.
 */
export function leadKeys(l: Lead): Keys {
  const p = l.project;
  const strong = [...(p?.sourceIds ?? [])];
  const weak: string[] = [];
  if (p?.phoneE164) weak.push("ph:" + p.phoneE164);
  const dom = registrableDomain(l.website);
  if (dom) weak.push("dom:" + dom);
  const ig = normalizeHandle(l.creator?.instagram || l.creator?.instagramUrl || "");
  if (ig) weak.push("ig:" + ig);
  const near: string[] = [];
  const name = normalizeName(l.name);
  if (name && p?.lat != null && p?.lon != null) for (const cell of geohashArea(p.lat, p.lon)) near.push(`ng:${name}|${cell}`);
  return { strong, weak, near };
}
const ownCell = (l: Lead) =>
  l.project?.lat != null && l.project?.lon != null ? `ng:${normalizeName(l.name)}|${geohash(l.project.lat, l.project.lon)}` : "";
const CHAIN_RADIUS_KM = 0.25;
function close(a: Lead, b: Lead) {
  const pa = a.project, pb = b.project;
  if (pa?.lat == null || pa?.lon == null || pb?.lat == null || pb?.lon == null) return true;
  return distanceKm({ lat: pa.lat, lon: pa.lon }, { lat: pb.lat, lon: pb.lon }) <= CHAIN_RADIUS_KM;
}

/**
 * Re-confirms an existing lead from a newly found record: the check date
 * moves forward, empty contact fields are filled and source links are added.
 * Delivery state, outreach status, stage, notes and user edits never change.
 */
export function refreshLead(old: Lead, l: Lead): Lead {
  const po = old.project!, pn = l.project!;
  const creator =
    old.creator || l.creator
      ? (Object.fromEntries(
          Object.entries({ ...(l.creator ?? {}), ...(old.creator ?? {}) }).map(([k, v]) => [
            k,
            v === "" || v == null ? ((l.creator as Record<string, unknown> | undefined)?.[k] ?? v) : v,
          ]),
        ) as Lead["creator"])
      : undefined;
  const ids = [...new Set([...po.sourceIds, ...pn.sourceIds])].slice(0, 50);
  const sources = [...po.sources, ...pn.sources.filter((s) => !po.sources.some((x) => x.id === s.id))].slice(0, 50);
  const newSource = ids.length > po.sourceIds.length;
  return {
    ...old,
    email: old.email || l.email,
    phone: old.phone || l.phone,
    website: old.website || l.website,
    creator,
    checkedAt: l.checkedAt > old.checkedAt ? l.checkedAt : old.checkedAt,
    sourceVerifiedAt: [l.sourceVerifiedAt, old.sourceVerifiedAt].sort().at(-1) || "",
    history:
      old.checkedAt === l.checkedAt && !newSource
        ? old.history
        : [...old.history, { at: now(), event: `Re-confirmed by ${l.sourceLabel.split(" ·")[0]}` }].slice(-500),
    project: {
      ...po,
      sourceIds: ids,
      sources,
      categories: po.categories.length ? po.categories : pn.categories,
      address: po.address || pn.address,
      locality: po.locality || pn.locality,
      city: po.city || pn.city,
      region: po.region || pn.region,
      country: po.country || pn.country,
      lat: po.lat ?? pn.lat,
      lon: po.lon ?? pn.lon,
      distanceKm: po.distanceKm ?? pn.distanceKm,
      confidence: Math.max(po.confidence ?? -1, pn.confidence ?? -1) < 0 ? null : Math.max(po.confidence ?? 0, pn.confidence ?? 0),
      phoneE164: po.phoneE164 || pn.phoneE164,
      phoneType: po.phoneType || pn.phoneType,
      provenance: { ...pn.provenance, ...po.provenance },
    },
  };
}

/**
 * Merges newly discovered records into a project's leads. Records matching an
 * existing lead refresh it (a Given lead stays Given); the rest are added.
 */
export function mergeProjectLeads(existing: Lead[], incoming: Lead[]) {
  const leads = existing.slice();
  const strong = new Map<string, number>();
  const weak = new Map<string, number[]>();
  const index = (i: number) => {
    const l = leads[i];
    if (!l.project) return;
    const k = leadKeys(l);
    for (const s of k.strong) strong.set(`${l.campaignId}|${s}`, i);
    const cell = ownCell(l);
    for (const w of [...k.weak, ...(cell ? [cell] : [])]) {
      const key = `${l.campaignId}|${w}`;
      const list = weak.get(key) ?? [];
      if (!list.includes(i)) list.push(i);
      weak.set(key, list);
    }
  };
  leads.forEach((_, i) => index(i));
  const added: Lead[] = [];
  let refreshed = 0;
  for (const l of incoming) {
    if (!l.project) continue;
    const k = leadKeys(l);
    const c = l.campaignId;
    let match = k.strong.map((s) => strong.get(`${c}|${s}`)).find((i) => i !== undefined);
    // Same name within ~100 m.
    if (match === undefined) match = k.near.flatMap((n) => weak.get(`${c}|${n}`) ?? [])[0];
    // Shared phone, website or handle, only when the two records are close.
    if (match === undefined) match = k.weak.flatMap((w) => weak.get(`${c}|${w}`) ?? []).find((i) => close(leads[i], l));
    if (match !== undefined) {
      leads[match] = refreshLead(leads[match], l);
      index(match);
      refreshed++;
      continue;
    }
    leads.push(l);
    added.push(l);
    index(leads.length - 1);
  }
  return { leads, added, refreshed };
}
