"use client";
// Project details: brief, pool, batches (the Given ledger), split,
// availability, discovery and the source report.
import { useState, type ReactNode } from "react";
import { ArrowLeft, Download, PackageCheck, RefreshCw, Undo2, Server, ServerOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AvailabilityTable, PoolTable, ReportTable, SplitEditor } from "./project-parts";
import { ProjectQuality } from "./project-quality";
import { Choice, formatDate } from "./ui";
import { batchSizes, type CustomProject, type Delivery, type TemplateChannel } from "@/lib/project-schema";
import { tierLabel } from "@/lib/allocation";
import { homeLabel } from "@/lib/ledger";
import { splitErrors } from "@/lib/project";
import { categoryLabel } from "@/lib/categories";
import type { Campaign, Workspace } from "@/lib/leadgen";
import type { Availability, Progress } from "@/lib/project-run";
import type { Health } from "@/lib/project-sources";

export type Project = Campaign & { custom: CustomProject };
export type ProjectTab = { id: string; label: string; render: () => ReactNode };
type Props = {
  project: Project;
  state: Workspace;
  deliveries: Delivery[];
  health: Health | null | undefined;
  progress?: Progress;
  busy: boolean;
  running: boolean;
  onBack: () => void;
  onDiscover: (options: { fetchAll?: boolean; size?: number }) => Promise<unknown>;
  onGenerate: (size: number) => Promise<unknown>;
  onUndo: (d: Delivery) => Promise<unknown>;
  onSave: (c: Project, message?: string) => Promise<boolean>;
  onPreview: (c: Project) => Promise<{ rows: Availability[] }>;
  onRefreshHealth: () => void;
  onPrepareDrafts?: (d: Delivery, channels: TemplateChannel[]) => Promise<unknown>;
  onChecks?: () => Promise<unknown>;
  onRecheck?: () => Promise<unknown>;
  tabs?: ProjectTab[];
};
const draftChannels: TemplateChannel[] = ["WhatsApp", "Email", "Instagram DM"];

function BatchDrafts({ deliveries, busy, onPrepare }: { deliveries: Delivery[]; busy: boolean; onPrepare: (d: Delivery, c: TemplateChannel[]) => Promise<unknown> }) {
  const [id, setId] = useState(deliveries[0]?.id ?? "");
  const [channels, setChannels] = useState<TemplateChannel[]>(["WhatsApp"]);
  const d = deliveries.find((x) => x.id === id) ?? deliveries[0];
  if (!d) return null;
  return (
    <div className="batch-drafts">
      <b>Prepare drafts for a batch</b>
      <Choice label="Batch" value={d.id} onChange={setId} options={deliveries.map((x) => ({ value: x.id, label: `Batch ${x.seq}` }))} />
      {draftChannels.map((c) => (
        <label key={c} className="inline-check">
          <input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} /> {c}
        </label>
      ))}
      <button className="secondary" disabled={busy || !channels.length} onClick={() => onPrepare(d, channels)}>
        Prepare drafts
      </button>
      <small className="muted">Fills the templates for every lead in the batch and adds draft columns to its workbook. Drafts are text only; nothing is sent.</small>
    </div>
  );
}
export const batchExcelUrl = (campaignId: string, deliveryId?: string) =>
  `/api/project-export?campaign=${encodeURIComponent(campaignId)}${deliveryId ? `&delivery=${encodeURIComponent(deliveryId)}` : ""}`;

export function ProjectDetails(props: Props) {
  const { project, state, deliveries, health, busy, running, progress } = props;
  const p = project.custom;
  const home = homeLabel(p);
  const leads = state.leads.filter((l) => l.campaignId === project.id && l.project);
  const available = leads.filter((l) => l.project!.delivery.status === "available").length;
  const [size, setSize] = useState("250");
  const [split, setSplit] = useState(p.split);
  const [mode, setMode] = useState(p.mode);
  const [rows, setRows] = useState<Availability[] | null>(null);
  const [counting, setCounting] = useState(false);
  const [tab, setTab] = useState("overview");
  const ours = deliveries.filter((d) => d.campaignId === project.id).sort((a, b) => b.seq - a.seq);
  const splitChanged = mode !== p.mode || split.join() !== p.split.join();
  const splitError = mode === "split" ? splitErrors(split, p.tiers.length) : "";
  const disabled = busy || running || project.status !== "Active";
  const tabs: ProjectTab[] = [{ id: "overview", label: "Overview", render: () => null }, ...(props.tabs ?? [])];
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="text-button" onClick={props.onBack}>
            <ArrowLeft size={15} /> All lead projects
          </button>
          <p className="eyebrow">LEAD PROJECT · {project.location.toUpperCase()}</p>
          <h1>{project.name}</h1>
          <p className="muted">{project.description}</p>
        </div>
        <div className="button-row">
          <button className="secondary" disabled={disabled} onClick={() => props.onDiscover({ size: Number(size) })}>
            <RefreshCw size={16} /> {p.lastRunAt ? "Refresh discovery" : "Run discovery"}
          </button>
          <a className="secondary" href={batchExcelUrl(project.id)} download>
            <Download size={16} /> Master workbook
          </a>
        </div>
      </div>
      <div className={"service-status " + (health ? "ok" : "off")} role="status">
        {health ? <Server size={16} /> : <ServerOff size={16} />}
        {health === undefined
          ? "Checking the local sources service…"
          : health
            ? `Sources service running · ${health.extracts.length ? health.extracts.map((e) => `${e.source === "foursquare" ? "Foursquare " : ""}${e.country} ${e.release} (${e.rows.toLocaleString()} places)`).join(", ") : "no Overture extracts yet (npm run overture:extract)"}`
            : "Sources service offline: discovery uses OpenStreetMap and Wikidata only. Start it with npm run sources."}
        <button className="text-button" onClick={props.onRefreshHealth}>
          Check again
        </button>
      </div>
      {running && progress && (
        <p className="muted" aria-live="polite">
          {progress.label}
          {progress.total ? ` (${progress.done + 1} of ${progress.total})` : ""}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Project sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab !== "overview" ? (
        tabs.find((t) => t.id === tab)?.render()
      ) : (
        <>
          <div className="dashboard-grid operations-grid">
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Generate a batch</h2>
                  <p className="muted">
                    {available.toLocaleString()} available in the pool · {(leads.length - available).toLocaleString()} given. Delivered leads are marked Given and never delivered again.
                  </p>
                </div>
              </div>
              <div className="button-row">
                <Choice label="Batch size" value={size} onChange={setSize} options={batchSizes.map((n) => ({ value: String(n), label: `${n.toLocaleString()} leads` }))} />
                <button className="primary" disabled={disabled} onClick={() => props.onGenerate(Number(size))}>
                  <PackageCheck size={16} /> Generate batch
                </button>
              </div>
              <p className="muted">If the pool is short, discovery runs first for the tiers and segments that still have places.</p>
            </section>
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Brief</h2>
                  <p className="muted">
                    {p.tiers.map((t) => tierLabel(t, home)).join(" → ")}
                    {p.tiers.includes("global") && ` (${p.countries.join(", ")})`}
                  </p>
                </div>
              </div>
              {p.segments.map((s) => (
                <p key={s.id}>
                  <b>{s.label}</b>
                  <span className="muted"> · {s.categories.map(categoryLabel).join(", ")}</span>
                  {s.include.length > 0 && <span className="muted"> · also names with “{s.include.join("”, “")}”</span>}
                  {s.exclude.length > 0 && <span className="muted"> · not “{s.exclude.join("”, “")}”</span>}
                </p>
              ))}
            </section>
          </div>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Pool</h2>
                <p className="muted">Leads found so far, per tier and segment.</p>
              </div>
              <button className="text-button" disabled={disabled} onClick={() => props.onDiscover({ fetchAll: true })}>
                Fetch everything
              </button>
            </div>
            <PoolTable leads={leads} segments={p.segments} tiers={p.tiers} home={home} />
          </section>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Batches</h2>
                <p className="muted">Each batch has its own workbook. Only the latest batch can be undone, before any of its leads is contacted.</p>
              </div>
            </div>
            {ours.length ? (
              <Table className="data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>By tier (planned → actual)</TableHead>
                    <TableHead />
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ours.map((d, i) => (
                    <TableRow key={d.id}>
                      <TableCell>Batch {d.seq}</TableCell>
                      <TableCell>{formatDate(d.createdAt)}</TableCell>
                      <TableCell>
                        {d.delivered} of {d.requested}
                      </TableCell>
                      <TableCell>
                        {p.tiers.map((t) => `${tierLabel(t, home)} ${d.planned[t] ?? 0}→${d.actual.tiers[t] ?? 0}`).join(" · ")}
                      </TableCell>
                      <TableCell>
                        <div className="button-row">
                          <a className="secondary" href={batchExcelUrl(project.id, d.id)} download>
                            <Download size={14} /> Excel
                          </a>
                          {i === 0 && (
                            <button className="text-button" disabled={disabled} onClick={() => props.onUndo(d)}>
                              <Undo2 size={14} /> Undo
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="report-message">{d.notes.join(" ") || "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="muted">No batches yet.</p>
            )}
            {ours.length > 0 && props.onPrepareDrafts && <BatchDrafts deliveries={ours} busy={disabled} onPrepare={props.onPrepareDrafts} />}
          </section>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Tier split</h2>
                <p className="muted">Applies to the next batch.</p>
              </div>
              <button
                className="secondary"
                disabled={!splitChanged || !!splitError || busy}
                onClick={() => props.onSave({ ...project, custom: { ...p, split: mode === "nearest" ? p.tiers.map(() => 0) : split, mode } }, "Split saved")}
              >
                Save split
              </button>
            </div>
            <SplitEditor tiers={p.tiers} split={split} onChange={setSplit} mode={mode} onMode={setMode} home={home} />
          </section>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Availability</h2>
                <p className="muted">Estimated places per tier and segment, before dedupe and the channel rule.</p>
              </div>
              <button
                className="secondary"
                disabled={counting || running}
                onClick={async () => {
                  setCounting(true);
                  try {
                    setRows((await props.onPreview(project)).rows);
                  } finally {
                    setCounting(false);
                  }
                }}
              >
                {counting ? "Counting…" : "Count"}
              </button>
            </div>
            {rows && <AvailabilityTable rows={rows} segments={p.segments} />}
          </section>
          {props.onChecks && props.onRecheck && (
            <ProjectQuality project={project} leads={leads} health={health} disabled={disabled} onChecks={props.onChecks} onRecheck={props.onRecheck} onRefreshHealth={props.onRefreshHealth} />
          )}
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Source report</h2>
                <p className="muted">{p.lastRunAt ? `Last run ${formatDate(p.lastRunAt)}` : "Not run yet"}. Every source and area searched, including failures.</p>
              </div>
            </div>
            <ReportTable reports={p.lastReport} />
          </section>
        </>
      )}
    </>
  );
}
