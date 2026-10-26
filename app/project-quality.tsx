"use client";
// Data quality for a lead project: email and website checks, re-checking
// stale leads, and updating Overture extracts to the newest monthly release.
import { useEffect, useState } from "react";
import { MailCheck, RefreshCw, DatabaseZap } from "lucide-react";
import { SOURCES_URL, type Health } from "@/lib/project-sources";
import { staleLeads, STALE_DAYS } from "@/lib/project-checks";
import type { Lead } from "@/lib/leadgen";
import type { Project } from "./project-details";

type UpdateState = { running: boolean; countries: string[]; startedAt: string; finishedAt: string; exitCode: number | null; log: string[] };
type Props = {
  project: Project;
  leads: Lead[];
  health: Health | null | undefined;
  disabled: boolean;
  onChecks: () => Promise<unknown>;
  onRecheck: () => Promise<unknown>;
  onRefreshHealth: () => void;
};
const get = async <T,>(path: string): Promise<T | null> => {
  try {
    const r = await fetch(SOURCES_URL + path, { signal: AbortSignal.timeout(15000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

export function ProjectQuality({ project, leads, health, disabled, onChecks, onRecheck, onRefreshHealth }: Props) {
  const p = project.custom;
  const unchecked = leads.filter((l) => (l.email && !l.project!.emailCheck) || (l.website && !l.project!.websiteStatus)).length;
  const stale = staleLeads(leads).length;
  const count = (k: "emailCheck" | "websiteStatus", v: string) => leads.filter((l) => l.project![k] === v).length;
  const [latest, setLatest] = useState("");
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const countries = [...new Set([p.base.country?.code || "IN", ...(p.tiers.includes("global") ? p.countries : [])])];
  useEffect(() => {
    if (!health) return;
    void get<{ latest: string }>("/update/latest").then((r) => setLatest(r?.latest ?? ""));
    void get<UpdateState>("/update/status").then(setUpdate);
  }, [health]);
  // While an update runs, its status is read every 5 seconds.
  useEffect(() => {
    if (!update?.running) return;
    const t = setInterval(async () => {
      const s = await get<UpdateState>("/update/status");
      setUpdate(s);
      if (s && !s.running) onRefreshHealth();
    }, 5000);
    return () => clearInterval(t);
  }, [update?.running, onRefreshHealth]);
  const current = (cc: string) => health?.extracts.find((e) => e.country === cc)?.release ?? "";
  const outdated = countries.filter((cc) => !current(cc) || (latest && current(cc) < latest));
  const start = async () => {
    try {
      const r = await fetch(`${SOURCES_URL}/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countries: outdated }) });
      setUpdate(await r.json());
    } catch {
      setUpdate(null);
    }
  };
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Data quality</h2>
          <p className="muted">Checks run through the local sources service. No emails are ever sent to test an address.</p>
        </div>
      </div>
      <div className="quality-grid">
        <div>
          <h3>
            <MailCheck size={16} /> Contact checks
          </h3>
          <p className="muted">
            Emails: {count("emailCheck", "valid domain")} valid domain · {count("emailCheck", "no mail server")} no mail server · {count("emailCheck", "invalid")} invalid.
            <br />
            Websites: {count("websiteStatus", "live")} live · {count("websiteStatus", "redirects")} redirect · {count("websiteStatus", "dead")} dead · {count("websiteStatus", "timeout")} timed out.
          </p>
          <button className="secondary" disabled={disabled || !health || !unchecked} onClick={onChecks}>
            Check {unchecked} unchecked leads
          </button>
        </div>
        <div>
          <h3>
            <RefreshCw size={16} /> Re-check stale leads
          </h3>
          <p className="muted">
            {stale} leads were last confirmed by their source more than {STALE_DAYS} days ago. Re-checking confirms them against the newest data; leads no longer listed are noted, not removed.
          </p>
          <button className="secondary" disabled={disabled || !stale} onClick={onRecheck}>
            Re-check {stale} stale leads
          </button>
        </div>
        <div>
          <h3>
            <DatabaseZap size={16} /> Overture data
          </h3>
          <p className="muted">
            {countries.map((cc) => `${cc}: ${current(cc) || "not downloaded"}`).join(" · ")}
            {latest && ` · newest release ${latest}`}
          </p>
          {update?.running ? (
            <p className="muted" aria-live="polite">
              Updating {update.countries.join(", ")}… {update.log.at(-1)}
            </p>
          ) : (
            <>
              <button className="secondary" disabled={!health || !outdated.length} onClick={start}>
                {outdated.length ? `Update ${outdated.join(", ")} to ${latest || "the newest release"}` : "Up to date"}
              </button>
              {update?.finishedAt && (
                <p className={update.exitCode === 0 ? "muted" : "form-error"}>
                  Last update {update.exitCode === 0 ? "finished" : "failed"}: {update.log.at(-1)}
                </p>
              )}
            </>
          )}
          <small className="muted">Or from a terminal: npm run overture:extract -- {countries.join(" ")}</small>
        </div>
      </div>
    </section>
  );
}
