"use client";
// Building blocks shared by the project wizard and project details.
import { Minus, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { tierLabel } from "@/lib/allocation";
import { tiers as tierOrder, type ProjectReport, type Segment, type Tier } from "@/lib/project-schema";
import { defaultSplit } from "@/lib/project";
import type { Availability } from "@/lib/project-run";
import type { Lead } from "@/lib/leadgen";

const tierHelp: Record<Tier, string> = {
  locality: "A radius around the locality (default 3 km)",
  city: "The rest of the city (20 km around its centre)",
  state: "The rest of the state",
  country: "The rest of the country",
  global: "Countries you choose, one at a time",
};
export function TierPicker({ selected, onChange, hasLocality, home }: { selected: Tier[]; onChange: (t: Tier[]) => void; hasLocality: boolean; home: string }) {
  return (
    <fieldset className="tier-picker">
      <legend>Reach tiers, nearest first</legend>
      {tierOrder.map((t) => {
        const disabled = t === "locality" && !hasLocality;
        return (
          <label key={t} className={disabled ? "disabled" : ""}>
            <input
              type="checkbox"
              aria-label={tierLabel(t, home)}
              disabled={disabled}
              checked={selected.includes(t)}
              onChange={(e) => onChange(e.target.checked ? [...selected, t] : selected.filter((x) => x !== t))}
            />
            <span>
              <b>{tierLabel(t, home)}</b>
              <small>{disabled ? "Only offered when the location names a locality" : tierHelp[t]}</small>
            </span>
          </label>
        );
      })}
      <small className="muted">Each wider tier leaves out leads already found in a nearer one, so every lead belongs to exactly one tier.</small>
    </fieldset>
  );
}

export function SplitEditor({
  tiers,
  split,
  onChange,
  mode,
  onMode,
  home,
}: {
  tiers: Tier[];
  split: number[];
  onChange: (s: number[]) => void;
  mode: "split" | "nearest";
  onMode: (m: "split" | "nearest") => void;
  home: string;
}) {
  const total = split.reduce((a, b) => a + b, 0);
  const set = (i: number, v: number) => onChange(split.map((x, k) => (k === i ? Math.max(0, Math.min(100, v)) : x)));
  return (
    <div className="split-editor">
      <div className="mode-switch" role="radiogroup" aria-label="How batches are filled">
        <label>
          <input type="radio" checked={mode === "split"} onChange={() => onMode("split")} /> Split by percentage
        </label>
        <label>
          <input type="radio" checked={mode === "nearest"} onChange={() => onMode("nearest")} /> Nearest first (fill tiers in order)
        </label>
      </div>
      {mode === "split" && (
        <>
          {tiers.map((t, i) => (
            <div className="split-row" key={t}>
              <span>{tierLabel(t, home)}</span>
              <button className="icon-button" aria-label={`Decrease ${tierLabel(t, home)}`} onClick={() => set(i, (split[i] ?? 0) - 5)}>
                <Minus size={14} />
              </button>
              <output aria-live="polite">{split[i] ?? 0}%</output>
              <button className="icon-button" aria-label={`Increase ${tierLabel(t, home)}`} onClick={() => set(i, (split[i] ?? 0) + 5)}>
                <Plus size={14} />
              </button>
              <span className="split-bar" style={{ width: `${split[i] ?? 0}%` }} />
            </div>
          ))}
          <p className={total === 100 ? "muted" : "form-error"}>
            Total {total}%{total !== 100 && " · must be 100%"}
            {" · "}
            <button className="text-button" onClick={() => onChange(defaultSplit(tiers.length))}>
              Reset to {defaultSplit(tiers.length).join(" / ")}
            </button>
          </p>
        </>
      )}
      {mode === "nearest" && <p className="muted">Each batch takes Locality first, then City, State, {home} and Global, in that order.</p>}
    </div>
  );
}

export function AvailabilityTable({ rows, segments }: { rows: Availability[]; segments: Segment[] }) {
  const labels = [...new Set(rows.map((r) => r.label))];
  const cell = (seg: string, label: string) => rows.find((r) => r.segmentId === seg && r.label === label);
  const notes = [...new Set(rows.flatMap((r) => r.notes))];
  return (
    <>
      <Table className="data-table">
        <TableHeader>
          <TableRow>
            <TableHead>Segment</TableHead>
            {labels.map((l) => (
              <TableHead key={l}>{l}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.label}</TableCell>
              {labels.map((l) => {
                const c = cell(s.id, l);
                return (
                  <TableCell key={l} title={c?.overture ? `${c.overture.total.toLocaleString()} listed · ${c.overture.closed} closed · ${c.overture.noChannel} without a channel` : ""}>
                    {c?.overture ? `~${c.overture.reachable.toLocaleString()}` : "–"}
                    {c?.osm != null && <small className="muted"> · OSM {c.osm.toLocaleString()}</small>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="muted">Estimates: Overture places with a reach-out channel (hover for details); OpenStreetMap counts are shown where one query covers the tier.</p>
      {notes.length > 0 && (
        <ul className="muted notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function PoolTable({ leads, segments, tiers, home }: { leads: Lead[]; segments: Segment[]; tiers: Tier[]; home: string }) {
  const count = (t: Tier, seg: string, status: "available" | "given") =>
    leads.filter((l) => l.project?.tier === t && l.project.segmentId === seg && l.project.delivery.status === status).length;
  return (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          <TableHead>Segment</TableHead>
          {tiers.map((t) => (
            <TableHead key={t}>{tierLabel(t, home)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {segments.map((s) => (
          <TableRow key={s.id}>
            <TableCell>{s.label}</TableCell>
            {tiers.map((t) => (
              <TableCell key={t}>
                <b>{count(t, s.id, "available")}</b> <small className="muted">available · {count(t, s.id, "given")} given</small>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ReportTable({ reports }: { reports: ProjectReport[] }) {
  if (!reports.length) return <p className="muted">No discovery run yet.</p>;
  return (
    <Table className="data-table report-table">
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Area</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Found</TableHead>
          <TableHead>Added</TableHead>
          <TableHead>Left out</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.source}</TableCell>
            <TableCell>
              {r.area || r.scope}
              {r.segment && <small className="muted"> · {r.segment}</small>}
            </TableCell>
            <TableCell>
              <span className={"report-status status-" + r.status}>{r.status}</span>
            </TableCell>
            <TableCell>{r.found}</TableCell>
            <TableCell>
              {r.added}
              {r.refreshed > 0 && <small className="muted"> +{r.refreshed} re-confirmed</small>}
            </TableCell>
            <TableCell>
              {[r.excluded && `${r.excluded} no channel`, r.closed && `${r.closed} closed`, r.suppressed && `${r.suppressed} do-not-contact`].filter(Boolean).join(" · ") || "–"}
            </TableCell>
            <TableCell className="report-message">{r.message}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
