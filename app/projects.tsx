"use client";
// Lead projects: custom lead generation for any kind of business.
import { Plus, FolderSearch } from "lucide-react";
import { ProjectWizard } from "./project-wizard";
import { ProjectDetails, type Project, type ProjectTab } from "./project-details";
import { Blank, formatDate } from "./ui";
import { isCustom, homeLabel } from "@/lib/ledger";
import { tierLabel } from "@/lib/allocation";
import type { Campaign, Workspace } from "@/lib/leadgen";
import type { Delivery, TemplateChannel } from "@/lib/project-schema";
import type { Availability, Progress } from "@/lib/project-run";
import type { Health } from "@/lib/project-sources";

type Props = {
  state: Workspace;
  deliveries: Delivery[];
  health: Health | null | undefined;
  busy: boolean;
  running: { campaignId: string; progress?: Progress } | null;
  view: "list" | "new" | string;
  setView: (v: "list" | "new" | string) => void;
  discover: (body: unknown) => Promise<unknown>;
  preview: (c: Campaign, options?: { osm?: boolean }) => Promise<{ rows: Availability[] }>;
  progress?: Progress;
  create: (c: Campaign) => Promise<boolean>;
  saveProject: (c: Project, message?: string) => Promise<boolean>;
  runDiscovery: (c: Project, options: { fetchAll?: boolean; size?: number }) => Promise<unknown>;
  generate: (c: Project, size: number) => Promise<unknown>;
  undo: (c: Project, d: Delivery) => Promise<unknown>;
  refreshHealth: () => void;
  prepareDrafts?: (c: Project, d: Delivery, channels: TemplateChannel[]) => Promise<unknown>;
  checks?: (c: Project) => Promise<unknown>;
  recheck?: (c: Project) => Promise<unknown>;
  tabs?: (c: Project) => ProjectTab[];
};

export function Projects(props: Props) {
  const { state, view, setView } = props;
  const projects = state.campaigns.filter(isCustom).filter((c) => !c.demo);
  if (view === "new")
    return (
      <ProjectWizard
        discover={props.discover}
        preview={props.preview}
        progress={props.progress}
        onSave={props.create}
        onCancel={() => setView("list")}
        busy={props.busy}
        sender={{ name: state.profile.name, business: state.profile.business, website: state.profile.website }}
      />
    );
  const open = projects.find((c) => c.id === view);
  if (open)
    return (
      <ProjectDetails
        key={open.id}
        project={open}
        state={state}
        deliveries={props.deliveries}
        health={props.health}
        busy={props.busy}
        running={!!props.running}
        progress={props.running?.campaignId === open.id ? props.running.progress : undefined}
        onBack={() => setView("list")}
        onDiscover={(o) => props.runDiscovery(open, o)}
        onGenerate={(size) => props.generate(open, size)}
        onUndo={(d) => props.undo(open, d)}
        onSave={props.saveProject}
        onPreview={props.preview}
        onRefreshHealth={props.refreshHealth}
        onPrepareDrafts={props.prepareDrafts ? (d, ch) => props.prepareDrafts!(open, d, ch) : undefined}
        onChecks={props.checks ? () => props.checks!(open) : undefined}
        onRecheck={props.recheck ? () => props.recheck!(open) : undefined}
        tabs={props.tabs?.(open)}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LEAD PROJECTS</p>
          <h1>Leads for any kind of business.</h1>
          <p className="muted">
            Describe the business, list the kinds of leads you want, pick a location and reach, and get leads in batches from open public data.
          </p>
        </div>
        <button className="primary" onClick={() => setView("new")}>
          <Plus size={17} /> New lead project
        </button>
      </div>
      {projects.length ? (
        <div className="project-grid">
          {projects.map((c) => {
            const leads = state.leads.filter((l) => l.campaignId === c.id && l.project);
            const given = leads.filter((l) => l.project!.delivery.status === "given").length;
            const batches = props.deliveries.filter((d) => d.campaignId === c.id).length;
            return (
              <button key={c.id} className="panel project-card" onClick={() => setView(c.id)}>
                <FolderSearch size={20} />
                <h3>{c.name}</h3>
                <p className="muted">
                  {c.location} · {c.custom.tiers.map((t) => tierLabel(t, homeLabel(c.custom))).join(" → ")}
                </p>
                <p>
                  {c.custom.segments.map((s) => s.label).join(", ")}
                </p>
                <p className="muted">
                  {leads.length - given} available · {given} given · {batches} batch{batches === 1 ? "" : "es"}
                  {c.custom.lastRunAt && ` · discovery ${formatDate(c.custom.lastRunAt)}`}
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <Blank title="No lead projects yet" description="Start one for any business: a studio, a clinic, a coaching institute, a shop.">
          <button className="primary" onClick={() => setView("new")}>
            <Plus size={16} /> New lead project
          </button>
        </Blank>
      )}
    </>
  );
}
