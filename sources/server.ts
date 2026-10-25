// Local sources service for custom lead projects: Overture Maps Places over
// local extracts, plus (later stages) website enrichment and contact checks.
// Binds to 127.0.0.1 only and answers the LeadGen Pro app's own origins.
//
//   npm run sources
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Overture, extracts, lookupSchema, querySchema, searchSchema } from "./overture.ts";
import { createEnricher } from "./enrich.ts";
import { createChecks, type CheckDeps } from "./checks.ts";
import { createUpdater } from "./update.ts";
import { latestRelease } from "../scripts/overture-extract.mjs";

export const PORT = 5188;
export const defaultOrigins = ["http://127.0.0.1:5187", "http://localhost:5187"];
const root = fileURLToPath(new URL("../", import.meta.url));

type Route = (body: unknown) => Promise<unknown>;
export type Options = { dataDir?: string; fsqDir?: string; origins?: string[]; routes?: Record<string, Route>; checks?: CheckDeps; latest?: () => Promise<string> };

async function readBody(req: IncomingMessage, limit = 2_000_000) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function sourcesServer(options: Options = {}) {
  const dataDir = options.dataDir ?? path.join(root, "data", "overture");
  const origins = new Set(options.origins ?? defaultOrigins);
  const overture = new Overture(dataDir);
  // Foursquare Open Source Places, extracted into the same layout (npm run fsq:extract).
  const fsqDir = options.fsqDir ?? path.join(root, "data", "foursquare");
  const foursquare = new Overture(fsqDir);
  const from = (b: unknown) => ((b as { source?: string } | null)?.source === "foursquare" ? foursquare : overture);
  const checks = createChecks(options.checks);
  const updater = createUpdater(root, options.latest ?? (() => latestRelease()));
  const routes: Record<string, Route> = {
    "/count": (b) => from(b).count(querySchema.parse(b)),
    "/search": (b) => from(b).search(searchSchema.parse(b)),
    "/lookup": (b) => from(b).lookup(lookupSchema.parse(b)),
    "/enrich": createEnricher(),
    "/check-email": checks.emails,
    "/check-website": checks.websites,
    "/update": updater.start,
    ...options.routes,
  };
  const getRoutes: Record<string, () => Promise<unknown>> = {
    "/update/status": updater.status,
    "/update/latest": updater.latest,
  };
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Requests from other web pages are refused; command-line tools send no Origin.
    if (origin && !origins.has(origin)) return send(res, 403, { error: "Origin not allowed." });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/health")
        return send(res, 200, { ok: true, service: "leadgen-sources", extracts: [
            ...extracts(dataDir).map(({ file: _f, ...e }) => ({ source: "overture", ...e })),
            ...extracts(fsqDir).map(({ file: _f, ...e }) => ({ source: "foursquare", ...e })),
          ],
        });
      if (req.method === "GET" && getRoutes[url.pathname]) return send(res, 200, await getRoutes[url.pathname]());
      const route = routes[url.pathname];
      if (req.method !== "POST" || !route) return send(res, 404, { error: "Not found." });
      return send(res, 200, await route(await readBody(req)));
    } catch (e) {
      if (e instanceof z.ZodError) return send(res, 400, { error: "Invalid request.", issues: e.issues.slice(0, 5) });
      if (e instanceof SyntaxError) return send(res, 400, { error: "Invalid JSON request." });
      const status = (e as { status?: number }).status ?? 500;
      return send(res, status, { error: e instanceof Error ? e.message : "Request failed." });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // LEADGEN_ORIGINS adds app origins, e.g. when the app runs on another port.
  const extra = (process.env.LEADGEN_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  const server = sourcesServer({ origins: [...defaultOrigins, ...extra] });
  server.listen(PORT, "127.0.0.1", () => {
    const list = extracts(path.join(root, "data", "overture"));
    console.log(`LeadGen sources service on http://127.0.0.1:${PORT}`);
    console.log(
      list.length
        ? `Overture extracts: ${list.map((e) => `${e.country} (${e.release}, ${e.rows.toLocaleString()} places)`).join(", ")}`
        : "No Overture extracts yet. Run: npm run overture:extract",
    );
  });
}
