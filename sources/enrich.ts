// Website enrichment: reads a lead's homepage and one obvious contact page,
// and extracts only mailto: emails, tel: numbers and links to public social
// profiles. Respects robots.txt, waits at least 1 second between requests to
// one domain, times out after 10 seconds and never fetches private addresses.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

export const AGENT = "LeadGenPro/1.0 (personal lead research; contact-page reader)";
export const enrichSchema = z.object({
  items: z.array(z.object({ id: z.string().max(300), url: z.string().url().max(2000) })).min(1).max(200),
  concurrency: z.number().int().min(1).max(6).default(4),
});
export type EnrichResult = {
  id: string;
  status: "ok" | "blocked" | "failed" | "skipped";
  emails: { value: string; page: string }[];
  phones: { value: string; page: string }[];
  socials: { value: string; page: string }[];
  note: string;
};
type Fetch = typeof fetch;
export type Deps = { fetch?: Fetch; wait?: (ms: number) => Promise<void>; resolve?: (host: string) => Promise<string[]> };

// ---------- Safety ----------
export function privateAddress(ip: string) {
  if (isIP(ip) === 6) return /^(::1|::|f[cd]|fe[89ab]|::ffff:(127|10|192\.168|169\.254)\.)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}
/** True when the host resolves only to public addresses (never local or private networks). */
export async function isPublicHost(host: string, resolve: (h: string) => Promise<string[]> = defaultResolve) {
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => []);
  return ips.length > 0 && ips.every((ip) => !privateAddress(ip));
}
const defaultResolve = async (h: string) => (await lookup(h, { all: true })).map((r) => r.address);

// ---------- robots.txt ----------
/** Whether `path` may be fetched under the robots.txt rules for our agent (or *). */
export function robotsAllows(robots: string, path: string, agent = "leadgenpro") {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value || key === "allow") current.rules.push({ allow: key === "allow", path: value });
    } else lastWasAgent = false;
  }
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const matches = (rule: string) => {
    const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path);
  };
  const hit = group.rules.filter((r) => r.path && matches(r.path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  return hit ? hit.allow : true;
}

// ---------- Extraction ----------
const socialHost = /^(?:www\.|m\.)?(instagram\.com|facebook\.com|fb\.com|linkedin\.com|youtube\.com|tiktok\.com)$/i;
const notProfile = /\/(sharer|share|intent|dialog|plugins|login|tr|hashtag|explore|watch|embed)(\/|\.php|$|\?)/i;
export function extractContacts(html: string, page: string) {
  const emails = new Set<string>(), phones = new Set<string>(), socials = new Set<string>();
  let contact = "";
  const base = new URL(page);
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1].trim().replace(/&amp;/g, "&");
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    if (/^mailto:/i.test(href)) {
      const v = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) emails.add(v);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const v = decodeURIComponent(href.slice(4)).replace(/[^\d+]/g, "");
      if (v.replace(/\D/g, "").length >= 6) phones.add(v);
      continue;
    }
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (socialHost.test(u.hostname) && u.pathname.length > 1 && !notProfile.test(u.pathname)) {
      socials.add(`https://${u.hostname.replace(/^m\./, "www.")}${u.pathname.replace(/\/+$/, "")}`);
      continue;
    }
    if (!contact && u.hostname === base.hostname && (/contact/i.test(u.pathname) || /^contact/i.test(text))) contact = u.href.split("#")[0];
  }
  return { emails: [...emails], phones: [...phones], socials: [...socials], contact };
}

// ---------- Fetching ----------
async function readCapped(r: Response, cap = 1_000_000) {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, cap));
}

export function createEnricher(deps: Deps = {}) {
  const f = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const resolve = deps.resolve ?? defaultResolve;
  const lastHit = new Map<string, number>();
  const robots = new Map<string, Promise<string>>();
  // At most one request per second per domain, across all workers.
  // Each request reserves the next free one-second slot for its domain.
  const polite = async (host: string) => {
    const now = Date.now();
    const at = Math.max(now, (lastHit.get(host) ?? -Infinity) + 1000);
    lastHit.set(host, at);
    if (at > now) await wait(at - now);
  };
  // Redirects are followed by hand so every hop is checked for a private address.
  const get = async (url: string) => {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol) || !(await isPublicHost(u.hostname, resolve))) throw new Error("private or unresolvable address");
      await polite(u.hostname);
      const r = await f(current, { headers: { "User-Agent": AGENT, Accept: "text/html,*/*;q=0.5" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
      const to = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!to) return Object.assign(r, { finalUrl: current });
      current = new URL(to, current).href;
    }
    throw new Error("too many redirects");
  };
  const robotsFor = (origin: string) => {
    if (!robots.has(origin))
      robots.set(
        origin,
        get(`${origin}/robots.txt`)
          .then(async (r) => (r.ok ? (await readCapped(r, 200_000)) : ""))
          .catch(() => ""),
      );
    return robots.get(origin)!;
  };
  const page = async (url: string) => {
    const u = new URL(url);
    if (!robotsAllows(await robotsFor(u.origin), u.pathname)) return { blocked: true as const };
    const r = await get(url);
    if (!r.ok || !/html/i.test(r.headers.get("content-type") || "html")) return { status: r.status };
    return { html: await readCapped(r), url: r.finalUrl };
  };
  async function one(item: { id: string; url: string }): Promise<EnrichResult> {
    const out: EnrichResult = { id: item.id, status: "ok", emails: [], phones: [], socials: [], note: "" };
    const add = (list: EnrichResult["emails"], values: string[], at: string) => {
      for (const value of values) if (!list.some((x) => x.value === value)) list.push({ value, page: at });
    };
    try {
      const home = await page(item.url);
      if ("blocked" in home) return { ...out, status: "blocked", note: "robots.txt does not allow reading this site." };
      if (!("html" in home)) return { ...out, status: "failed", note: `Homepage returned HTTP ${home.status}.` };
      const found = extractContacts(home.html!, home.url!);
      add(out.emails, found.emails, home.url!);
      add(out.phones, found.phones, home.url!);
      add(out.socials, found.socials, home.url!);
      // One contact page: the linked one, else /contact, else /contact-us.
      const origin = new URL(home.url!).origin;
      for (const candidate of found.contact ? [found.contact] : [`${origin}/contact`, `${origin}/contact-us`]) {
        const c = await page(candidate);
        if ("html" in c) {
          const more = extractContacts(c.html!, c.url!);
          add(out.emails, more.emails, c.url!);
          add(out.phones, more.phones, c.url!);
          add(out.socials, more.socials, c.url!);
          break;
        }
        if ("blocked" in c) break;
      }
      return out;
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : "failed";
      return { ...out, status: "failed", note: msg };
    }
  }
  return async function enrich(body: unknown) {
    const { items, concurrency } = enrichSchema.parse(body);
    const results: EnrichResult[] = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          results[i] = await one(items[i]);
        }
      }),
    );
    return { results };
  };
}
