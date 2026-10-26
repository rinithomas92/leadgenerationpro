// Contact checks for the sources service. Free and rule-based:
//   - email: syntax plus an MX lookup on the domain (no probe emails, ever);
//   - website: a HEAD request (GET when HEAD is refused) → live, redirects,
//     dead or timeout.
import { Resolver } from "node:dns/promises";
import { z } from "zod";
import { AGENT, isPublicHost } from "./enrich.ts";

export const emailCheckSchema = z.object({ emails: z.array(z.string().max(300)).min(1).max(500) });
export const websiteCheckSchema = z.object({ urls: z.array(z.string().max(2000)).min(1).max(300) });
type Fetch = typeof fetch;
export type CheckDeps = { mx?: (domain: string) => Promise<{ exchange: string }[]>; fetch?: Fetch; resolve?: (host: string) => Promise<string[]> };

const emailRe = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;
// "unknown" means the DNS lookup itself failed; nothing is concluded or stored.
export type EmailResult = "valid domain" | "no mail server" | "invalid" | "unknown";
// Definite answers that a domain has no mail exchanger.
const NO_MAIL = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);
// Free public resolvers, tried only when the system's DNS refuses or times out.
const FALLBACK_DNS = ["1.1.1.1", "9.9.9.9"];

/**
 * MX lookups. LEADGEN_DNS (comma-separated) chooses the DNS servers; otherwise
 * the system's are used, falling back to public resolvers when they refuse.
 */
export function systemMx(servers = (process.env.LEADGEN_DNS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const primary = new Resolver({ timeout: 5000, tries: 2 });
  if (servers.length) primary.setServers(servers);
  const fallback = new Resolver({ timeout: 5000, tries: 2 });
  fallback.setServers(FALLBACK_DNS);
  let useFallback = false;
  return async (domain: string) => {
    if (useFallback) return fallback.resolveMx(domain);
    try {
      return await primary.resolveMx(domain);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (NO_MAIL.has(code) || servers.length) throw e;
      useFallback = true;
      return fallback.resolveMx(domain);
    }
  };
}

async function pool<T, R>(items: T[], size: number, work: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

export function createChecks(deps: CheckDeps = {}) {
  const mx = deps.mx ?? systemMx();
  const f = deps.fetch ?? fetch;
  const domains = new Map<string, Promise<EmailResult>>();
  const domainResult = (domain: string) => {
    if (!domains.has(domain))
      domains.set(
        domain,
        mx(domain)
          .then((r) => (r.some((x) => x.exchange && x.exchange !== ".") ? "valid domain" : "no mail server") as EmailResult)
          .catch((e) => (NO_MAIL.has((e as { code?: string }).code ?? "") ? "no mail server" : "unknown") as EmailResult)
          // A failed lookup is retried next time rather than remembered.
          .then((r) => (r === "unknown" && domains.delete(domain), r)),
      );
    return domains.get(domain)!;
  };
  async function emails(body: unknown) {
    const { emails } = emailCheckSchema.parse(body);
    const results = await pool(emails, 8, async (raw) => {
      const email = raw.trim();
      const m = emailRe.exec(email);
      return { email: raw, result: m ? await domainResult(m[1].toLowerCase()) : ("invalid" as EmailResult) };
    });
    return { results };
  }
  async function status(url: string): Promise<"live" | "redirects" | "dead" | "timeout"> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return "dead";
    }
    if (!/^https?:$/.test(u.protocol) || !(await isPublicHost(u.hostname, deps.resolve))) return "dead";
    const once = async (method: "HEAD" | "GET") => {
      const r = await f(u.href, { method, redirect: "manual", headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(10000) });
      await r.body?.cancel().catch(() => {});
      return r.status;
    };
    try {
      let code = await once("HEAD");
      if ([403, 405, 501].includes(code)) code = await once("GET");
      // 401/403/429: the site answered but limits automated visitors, so it is live.
      return (code >= 200 && code < 300) || [401, 403, 429].includes(code) ? "live" : code >= 300 && code < 400 ? "redirects" : "dead";
    } catch (e) {
      return e instanceof Error && e.name === "TimeoutError" ? "timeout" : "dead";
    }
  }
  async function websites(body: unknown) {
    const { urls } = websiteCheckSchema.parse(body);
    return { results: await pool(urls, 6, async (url) => ({ url, result: await status(url) })) };
  }
  return { emails, websites };
}
