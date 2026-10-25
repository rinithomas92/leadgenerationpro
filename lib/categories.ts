// Category resolution for custom lead projects, rule-based only (no AI):
// Overture's places taxonomy is the master list, a hand-curated synonym file
// covers common Indian and English terms, and Fuse.js gives typo-tolerant
// search. A crosswalk maps categories to OpenStreetMap tags and Wikidata
// occupations, inheriting from parent categories when not listed.
import Fuse from "fuse.js";
import taxonomy from "./overture-taxonomy.json" with { type: "json" };
import synonymFile from "./category-synonyms.json" with { type: "json" };
import crosswalkFile from "./category-crosswalk.json" with { type: "json" };
import countriesFile from "./countries.json" with { type: "json" };
import type { Segment } from "./project-schema.ts";
import type { TagSet } from "./project-osm.ts";

type Row = [id: string, hierarchy: string[], basic: string, places: number];
const rows = taxonomy.categories as Row[];
export const taxonomyRelease = taxonomy.release;
const byId = new Map(rows.map((r) => [r[0], r]));
const synonyms = synonymFile.terms as Record<string, string[]>;
const crosswalk = crosswalkFile.map as Record<string, { osm?: string[]; wikidata?: string[] }>;

export const readableCategory = (id: string) => id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");
export const categoryLabel = (id: string) => readableCategory(id);
export const categoryExists = (id: string) => byId.has(id);
export const categoryPath = (id: string) => (byId.get(id)?.[1] ?? [id]).map(readableCategory).join(" › ");

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N} &-]/gu, " ").replace(/\s+/g, " ").trim();
// Plurals fold to the singular for matching ("architects" → "architect").
const singular = (s: string) => s.replace(/(ies)$/, "y").replace(/(?<![s])s$/, "");

type Entry = { id: string; text: string; via: "synonym" | "name"; term: string; weight: number };
let fuse: Fuse<Entry> | undefined;
function index() {
  if (fuse) return fuse;
  const entries: Entry[] = [];
  for (const [term, ids] of Object.entries(synonyms))
    for (const id of ids) if (byId.has(id)) entries.push({ id, text: normalize(term), via: "synonym", term, weight: 1 });
  for (const [id, , , places] of rows)
    entries.push({ id, text: normalize(readableCategory(id)), via: "name", term: id, weight: Math.log10(10 + places) });
  fuse = new Fuse(entries, { keys: ["text"], includeScore: true, threshold: 0.34, ignoreLocation: true, minMatchCharLength: 2 });
  return fuse;
}

export type Suggestion = { id: string; label: string; path: string; via: "synonym" | "name"; term: string };
/**
 * Top categories for a segment label or keyword: exact synonym matches first,
 * then typo-tolerant matches over synonyms and category names, with more
 * common categories ranked higher among equally good matches.
 */
export function suggestCategories(text: string, limit = 8, options: { strict?: boolean } = {}): Suggestion[] {
  const q = normalize(text);
  if (q.length < 2) return [];
  const out = new Map<string, Suggestion>();
  const add = (id: string, via: Suggestion["via"], term: string) => {
    if (!out.has(id) && byId.has(id)) out.set(id, { id, label: categoryLabel(id), path: categoryPath(id), via, term });
  };
  for (const key of [q, singular(q)]) for (const id of synonyms[key] ?? []) add(id, "synonym", key);
  const hits = index()
    .search(q, { limit: 60 })
    .map((h) => ({ ...h, rank: (h.score ?? 1) - (h.item.via === "synonym" ? 0.08 : 0) - h.item.weight * 0.01 }))
    .sort((a, b) => a.rank - b.rank);
  const exact = out.size > 0;
  for (const h of hits) {
    if (out.size >= limit) break;
    // Once a synonym matched exactly, only close fuzzy matches are added.
    if ((exact || options.strict) && (h.score ?? 1) > 0.15) continue;
    add(h.item.id, h.item.via, h.item.via === "synonym" ? h.item.term : "");
  }
  return [...out.values()].slice(0, limit);
}

/** Crosswalk entry for a category, inherited from the nearest listed parent. */
export function crosswalkFor(id: string) {
  for (const c of [id, ...[...(byId.get(id)?.[1] ?? [])].reverse()]) if (crosswalk[c]) return { from: c, ...crosswalk[c] };
  return undefined;
}
/** OpenStreetMap tag sets and Wikidata occupations searched for a segment. */
export function segmentSources(segment: Segment) {
  const tags = new Map<string, TagSet>();
  const occupations = new Set<string>();
  const overtureOnly: string[] = [];
  for (const id of segment.categories) {
    const cw = crosswalkFor(id);
    if (!cw?.osm?.length) overtureOnly.push(id);
    // One filter per OSM key; the first category that uses a value labels it.
    for (const kv of cw?.osm ?? []) {
      const [key, value] = kv.split("=");
      if ([...tags.values()].some((t) => t.key === key && t.values.includes(value))) continue;
      const k = `${key}|${id}`;
      const t = tags.get(k) ?? { key, values: [], category: id };
      t.values.push(value);
      tags.set(k, t);
    }
    // Occupations only when the category itself (not a broad parent) lists them.
    if (cw?.from === id) for (const q of cw.wikidata ?? []) occupations.add(q);
  }
  return { tags: [...tags.values()], occupations: [...occupations], overtureOnly };
}

// ---------- Countries (for the Global tier) ----------
type CountryRow = [code: string, name: string, bbox: number[]];
const countryRows = (countriesFile.countries as CountryRow[]).filter(([code]) => /^[A-Z]{2}$/.test(code));
let names: Intl.DisplayNames | undefined;
const englishName = (code: string, fallback: string) => {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) || fallback;
  } catch {
    return fallback;
  }
};
const list = countryRows
  .map(([code, name, bbox]) => ({ code, name: englishName(code, name), bbox: { w: bbox[0], s: bbox[1], e: bbox[2], n: bbox[3] } }))
  .sort((a, b) => a.name.localeCompare(b.name));
export const countryList = () => list;

// ---------- Browsing the full taxonomy ----------
export type BrowseNode = { id: string; label: string; selectable: boolean; count: number };
const childMap = new Map<string, Map<string, string[]>>();
for (const [, hierarchy] of rows) {
  for (let i = 0; i < hierarchy.length; i++) {
    const parent = i === 0 ? "" : hierarchy[i - 1];
    const kids = childMap.get(parent) ?? new Map<string, string[]>();
    if (!kids.has(hierarchy[i])) kids.set(hierarchy[i], []);
    childMap.set(parent, kids);
  }
}
const descendants = new Map<string, Set<string>>();
for (const [id, hierarchy] of rows) for (const h of hierarchy) (descendants.get(h) ?? descendants.set(h, new Set()).get(h)!).add(id);
/** Children of a node ("" = top level), A–Z, with how many categories sit inside each. */
export function browseChildren(parent = ""): BrowseNode[] {
  return [...(childMap.get(parent)?.keys() ?? [])]
    .map((id) => ({ id, label: readableCategory(id), selectable: byId.has(id), count: descendants.get(id)?.size ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
/** Every selectable category at or below a node. */
export const categoriesUnder = (id: string) => [...(descendants.get(id) ?? [])].sort();
export const categoryTotal = rows.length;
