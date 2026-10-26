"use client";
import { RefreshCw, Search } from "lucide-react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { Campaign } from "@/lib/leadgen";
import type { Progress } from "@/lib/discovery-run";
import { scopeNames } from "@/lib/discovery-engine";
import { campaignExcelUrl, formatDate } from "./ui";

const statusText: Record<string, string> = {
  ok: "Complete",
  partial: "Partial",
  empty: "No matches",
  failed: "Failed",
  skipped: "Not available",
  "not-configured": "Not configured",
};
export function DiscoveryPanel({
  campaign,
  running,
  progress,
  busy,
  onRun,
}: {
  campaign: Campaign;
  running: boolean;
  progress?: Progress;
  busy: boolean;
  onRun: () => void;
}) {
  const d = campaign.discovery;
  const report = d?.lastReport ?? [];
  const failed = report.filter((r) => r.status === "failed").length;
  return (
    <section className="panel discovery-panel" aria-live="polite">
      <div className="section-title">
        <div>
          <h2>Discovery · {campaign.name}</h2>
          <p className="muted">
            {campaign.audience === "General"
              ? `Searches public sources in ${campaign.location}.`
              : `Searches ${campaign.location} first, then the rest of the state. Every result with at least one reach-out channel is kept.`}{" "}
            {d?.lastRunAt
              ? `Last run ${formatDate(d.lastRunAt)}.`
              : "Not run yet."}{" "}
            {d?.autoRefreshDays
              ? `Refreshes automatically every ${d.autoRefreshDays} days when you open the workspace.`
              : "Automatic refresh is off."}
          </p>
        </div>
        <div className="button-row">
        <a className="secondary" href={campaignExcelUrl(campaign.id)} download>
          Download Excel
        </a>
        <button
          className="primary"
          disabled={busy || running || campaign.status !== "Active" || campaign.demo}
          onClick={onRun}
        >
          {running ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : d?.lastRunAt ? (
            <RefreshCw size={16} />
          ) : (
            <Search size={16} />
          )}
          {running
            ? progress && progress.total
              ? `Searching ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : progress?.label.startsWith("Retrying")
                ? `${progress.label}…`
                : "Resolving location…"
            : d?.lastRunAt
              ? "Refresh discovery"
              : "Run discovery"}
        </button>
        </div>
      </div>
      {failed > 0 && !running && (
        <p className="notice" role="alert">
          {failed} search{failed === 1 ? "" : "es"} failed in the last run.
          Results from the other sources were kept; run discovery again to
          retry.
        </p>
      )}
      {report.length > 0 && (
        <details open={failed > 0}>
          <summary>Source report ({report.length} entries)</summary>
          <Table className="data-table report-table">
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Found</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Re-confirmed</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.source}</TableCell>
                  <TableCell>
                    {r.area ||
                      (r.scope in scopeNames
                        ? scopeNames[r.scope as keyof typeof scopeNames]
                        : "All")}
                  </TableCell>
                  <TableCell>
                    <span className={"status status-" + r.status}>
                      {statusText[r.status] || r.status}
                    </span>
                  </TableCell>
                  <TableCell>{r.found}</TableCell>
                  <TableCell>{r.added}</TableCell>
                  <TableCell>{r.refreshed}</TableCell>
                  <TableCell className="report-note">{r.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      )}
    </section>
  );
}
