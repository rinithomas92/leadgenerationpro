"use client";
// Outreach for a custom lead project: sender profile, templates with
// placeholders, and a preview against a real lead. Drafts only; nothing is sent.
import { useMemo, useState } from "react";
import { Copy as Duplicate, Save, Trash2 } from "lucide-react";
import { Field, Choice } from "./ui";
import { LeadActions, type SentInfo } from "./lead-actions";
import { duplicateTemplate, lintTemplate, pickTemplate, placeholders, reviseTemplate, starterTemplate } from "@/lib/templates";
import { templateChannels, type ProjectTemplate, type Sender, type TemplateChannel } from "@/lib/project-schema";
import { uid, type Lead, type Workspace } from "@/lib/leadgen";
import type { Project } from "./project-details";

type Props = {
  project: Project;
  state: Workspace;
  busy: boolean;
  onSave: (c: Project, message?: string) => Promise<boolean>;
  onSaveWorkspaceTemplates: (t: ProjectTemplate[]) => Promise<boolean>;
  onSent?: (lead: Lead, info: SentInfo) => Promise<unknown>;
  onReply?: (lead: Lead) => void;
};
const withSubject = (c: TemplateChannel) => c === "Email" || c.startsWith("Follow-up");

function SenderProfile({ project, busy, onSave }: Pick<Props, "project" | "busy" | "onSave">) {
  const [s, setS] = useState<Sender>(project.custom.sender);
  const set = (k: keyof Sender) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const changed = JSON.stringify(s) !== JSON.stringify(project.custom.sender);
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Sender profile</h2>
          <p className="muted">Fills {"{my_name}"}, {"{my_business}"}, {"{my_pitch}"}, {"{offer}"}, {"{cta}"} and the other “my” placeholders.</p>
        </div>
        <button className="secondary" disabled={!changed || busy} onClick={() => onSave({ ...project, custom: { ...project.custom, sender: s } }, "Sender profile saved")}>
          <Save size={15} /> Save
        </button>
      </div>
      <div className="form-grid">
        <Field label="My name">
          <input value={s.name} maxLength={120} onChange={set("name")} />
        </Field>
        <Field label="My business name">
          <input value={s.business} maxLength={120} onChange={set("business")} />
        </Field>
        <Field label="One-line pitch" hint="Pre-filled from the first sentence of the business description.">
          <input value={s.pitch} maxLength={300} onChange={set("pitch")} />
        </Field>
        <Field label="Website">
          <input value={s.website} maxLength={300} onChange={set("website")} />
        </Field>
        <Field label="Phone">
          <input value={s.phone} maxLength={40} onChange={set("phone")} />
        </Field>
        <Field label="Offer (optional)" hint="Shown only where a template uses {offer}. Describe it; don't promise results.">
          <input value={s.offer} maxLength={300} onChange={set("offer")} />
        </Field>
        <Field label="Call to action">
          <input value={s.cta} maxLength={300} onChange={set("cta")} />
        </Field>
      </div>
    </section>
  );
}

export function ProjectOutreach(props: Props) {
  const { project, state, busy } = props;
  const p = project.custom;
  const workspace = state.customTemplates ?? [];
  const [channel, setChannel] = useState<TemplateChannel>("WhatsApp");
  const [segmentId, setSegmentId] = useState("");
  const saved = segmentId ? p.templates.find((t) => t.channel === channel && t.segmentId === segmentId) : p.templates.find((t) => t.channel === channel && !t.segmentId);
  const effective = saved ?? (segmentId ? pickTemplate(channel, segmentId, p, workspace) : workspace.find((t) => t.channel === channel) ?? starterTemplate(channel));
  const [edit, setEdit] = useState<ProjectTemplate>(effective);
  const [editKey, setEditKey] = useState(`${channel}|${segmentId}`);
  if (editKey !== `${channel}|${segmentId}`) {
    setEditKey(`${channel}|${segmentId}`);
    setEdit(effective);
  }
  const lint = useMemo(() => {
    const a = lintTemplate(edit.body), b = lintTemplate(edit.subject);
    return { unknown: [...new Set([...a.unknown, ...b.unknown])], errors: [...a.errors, ...b.errors] };
  }, [edit.body, edit.subject]);
  const leads = state.leads.filter((l) => l.campaignId === project.id && l.project);
  const sample = leads.filter((l) => l.project!.delivery.status === "given").concat(leads).slice(0, 300);
  const [leadId, setLeadId] = useState(sample[0]?.id ?? "");
  const lead = leads.find((l) => l.id === leadId) ?? sample[0];
  const origin = saved ? "This project" : effective.id.startsWith("starter-") ? "Built-in starter" : segmentId ? "Inherited" : "Workspace default";
  const dirty = edit.body !== effective.body || edit.subject !== effective.subject || edit.name !== effective.name;
  const saveProject = () => {
    const next = reviseTemplate(saved, { id: saved?.id ?? uid(), name: edit.name.trim() || `${channel} template`, channel, segmentId, subject: withSubject(channel) ? edit.subject : "", body: edit.body });
    const templates = saved ? p.templates.map((t) => (t.id === saved.id ? next : t)) : [...p.templates, next];
    return props.onSave({ ...project, custom: { ...p, templates } }, `Template saved (v${next.version})`);
  };
  const freeSegment = p.segments.find((s) => s.id !== segmentId && !p.templates.some((t) => t.channel === channel && t.segmentId === s.id));
  const insert = (name: string) => setEdit({ ...edit, body: `${edit.body}{${name}}` });
  return (
    <div className="form-stack">
      <SenderProfile key={JSON.stringify(p.sender)} project={project} busy={busy} onSave={props.onSave} />
      <div className="dashboard-grid operations-grid">
        <section className="panel form-stack">
          <div className="section-title">
            <div>
              <h2>Templates</h2>
              <p className="muted">Used in order: segment template → project default → workspace default → built-in starter.</p>
            </div>
          </div>
          <div className="button-row">
            <Choice label="Channel" value={channel} onChange={(v) => setChannel(v as TemplateChannel)} options={[...templateChannels]} />
            <Choice label="Segment" value={segmentId || "all"} onChange={(v) => setSegmentId(v === "all" ? "" : v)} options={[{ value: "all", label: "Project default (all segments)" }, ...p.segments.map((s) => ({ value: s.id, label: `Only ${s.label}` }))]} />
          </div>
          <small className="muted">
            Showing: {origin}
            {saved && ` · version ${saved.version}`}
          </small>
          <Field label="Template name">
            <input value={edit.name} maxLength={120} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          {withSubject(channel) && (
            <Field label="Subject">
              <input value={edit.subject} maxLength={300} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
            </Field>
          )}
          <Field label="Message" hint="Placeholders: {name} or {name|fallback}. Write {{ and }} for literal braces.">
            <textarea rows={10} value={edit.body} maxLength={10000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </Field>
          {(lint.unknown.length > 0 || lint.errors.length > 0) && (
            <p className="form-error" role="alert">
              {lint.unknown.length > 0 && `Unknown placeholder ${lint.unknown.map((u) => `{${u}}`).join(", ")}. `}
              {lint.errors.join(" ")}
            </p>
          )}
          <div className="chips">
            {Object.entries(placeholders).map(([name, help]) => (
              <button key={name} className="chip chip-soft" title={help} onClick={() => insert(name)}>
                {`{${name}}`}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button className="primary" disabled={busy || !dirty || lint.unknown.length > 0 || lint.errors.length > 0} onClick={saveProject}>
              <Save size={15} /> Save for this project
            </button>
            <button
              className="secondary"
              disabled={busy || lint.unknown.length > 0 || lint.errors.length > 0 || segmentId !== ""}
              title="Use this as the default for every lead project"
              onClick={() => {
                const old = workspace.find((t) => t.channel === channel);
                const next = reviseTemplate(old, { id: old?.id ?? uid(), name: edit.name, channel, segmentId: "", subject: withSubject(channel) ? edit.subject : "", body: edit.body });
                return props.onSaveWorkspaceTemplates([...workspace.filter((t) => t.channel !== channel), next]);
              }}
            >
              Save as workspace default
            </button>
            {saved && (
              <>
                <button
                  className="text-button"
                  disabled={busy || !freeSegment}
                  title={freeSegment ? `Copy to “${freeSegment.label}”` : "Every segment already has its own template for this channel"}
                  onClick={async () => {
                    if (!freeSegment) return;
                    if (await props.onSave({ ...project, custom: { ...p, templates: [...p.templates, { ...duplicateTemplate(saved), segmentId: freeSegment.id }] } }, `Copied to ${freeSegment.label}`))
                      setSegmentId(freeSegment.id);
                  }}
                >
                  <Duplicate size={14} /> Duplicate for {freeSegment?.label ?? "a segment"}
                </button>
                <button className="text-button" disabled={busy} onClick={() => props.onSave({ ...project, custom: { ...p, templates: p.templates.filter((t) => t.id !== saved.id) } }, "Template deleted")}>
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
          {p.templates.length > 0 && (
            <div>
              <small className="muted">Saved for this project</small>
              <ul className="notes">
                {p.templates.map((t) => (
                  <li key={t.id}>
                    {t.name} · {t.channel}
                    {t.segmentId ? ` · ${p.segments.find((s) => s.id === t.segmentId)?.label ?? "removed segment"}` : " · all segments"} · v{t.version}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="panel form-stack">
          <div className="section-title">
            <div>
              <h2>Preview</h2>
              <p className="muted">The draft filled in for a real lead. Copy and Open stay disabled until every placeholder has a value.</p>
            </div>
          </div>
          {lead ? (
            <>
              <Choice
                label="Lead"
                value={lead.id}
                onChange={setLeadId}
                options={sample.map((l) => ({ value: l.id, label: `${l.name}${l.project!.delivery.batch ? ` · batch ${l.project!.delivery.batch}` : ""}` }))}
              />
              <LeadActions
                lead={lead}
                project={p}
                workspaceTemplates={workspace}
                draftTemplate={{ ...edit, channel, segmentId }}
                channel={channel}
                onChannel={setChannel}
                busy={busy}
                onSent={props.onSent ? (info) => props.onSent!(lead, info) : undefined}
                onReply={props.onReply ? () => props.onReply!(lead) : undefined}
              />
            </>
          ) : (
            <p className="muted">Run discovery to preview drafts against real leads.</p>
          )}
        </section>
      </div>
    </div>
  );
}
