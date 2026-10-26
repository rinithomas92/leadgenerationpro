// Overture freshness: runs the extract script for the newest monthly release
// as a child process and reports its progress. One update at a time.
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

export const updateSchema = z.object({ countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(20) });
export type UpdateState = { running: boolean; countries: string[]; startedAt: string; finishedAt: string; exitCode: number | null; log: string[] };

export function createUpdater(root: string, latest: () => Promise<string>) {
  const state: UpdateState = { running: false, countries: [], startedAt: "", finishedAt: "", exitCode: null, log: [] };
  const add = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) state.log.push(line.trim());
    state.log = state.log.slice(-40);
  };
  return {
    status: async () => state,
    latest: async () => ({ latest: await latest() }),
    start: async (body: unknown) => {
      const { countries } = updateSchema.parse(body);
      if (state.running) throw Object.assign(new Error("An update is already running."), { status: 409 });
      Object.assign(state, { running: true, countries, startedAt: new Date().toISOString(), finishedAt: "", exitCode: null, log: [] });
      const child = spawn(process.execPath, [path.join(root, "scripts", "overture-extract.mjs"), ...countries], { cwd: root });
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      child.on("close", (code) => Object.assign(state, { running: false, exitCode: code, finishedAt: new Date().toISOString() }));
      child.on("error", (e) => Object.assign(state, { running: false, exitCode: -1, finishedAt: new Date().toISOString(), log: [...state.log, e.message] }));
      return state;
    },
  };
}
