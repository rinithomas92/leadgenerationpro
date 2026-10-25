"use client";
import { useState } from "react";
import {
  Copy,
  Download,
  Sparkles,
  Save,
  Mail,
  ArrowRight,
  AtSign,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  channels,
  uid,
  now,
  type Workspace,
  type Lead,
  type Draft,
} from "@/lib/leadgen";
import { displayHandle, outreachDraft } from "@/lib/gloss";
import { Blank, Field, Choice, download, formatDate } from "./ui";
import { ProfileButton } from "./creators";
type Props = {
  state: Workspace;
  save: (s: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  initialLead: string;
  ai: boolean;
};
const LEAD_OPTIONS = 200;
export function Outreach({ state, save, busy, initialLead, ai }: Props) {
  const [leadId, setLeadId] = useState(
    initialLead || state.leads.find((lead) => !lead.demo)?.id || state.leads[0]?.id || "none",
  );
  const [channel, setChannel] = useState<Draft["channel"]>(() =>
    state.leads.find((l) => l.id === initialLead)?.creator?.instagram
      ? "Instagram DM"
      : "Email",
  );
  const [tone, setTone] = useState("Warm");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState("");
  const [tab, setTab] = useState("drafts");
  const [templateName, setTemplateName] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const lead = state.leads.find((l) => l.id === leadId);
  // The picker lists at most LEAD_OPTIONS matches so large campaigns stay fast.
  const [leadQuery, setLeadQuery] = useState("");
  const q = leadQuery.trim().toLowerCase();
  const matches = q
    ? state.leads.filter((l) =>
        `${l.name} ${l.location} ${l.creator?.instagram ?? ""}`.toLowerCase().includes(q),
      )
    : state.leads;
  const leadOptions = [
    ...(lead && !matches.slice(0, LEAD_OPTIONS).includes(lead) ? [lead] : []),
    ...matches.slice(0, LEAD_OPTIONS),
  ];
  const campaign = state.campaigns.find((c) => c.id === lead?.campaignId);
  async function generate() {
    if (!lead || !campaign) return;
    setGenerating(true);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "draft",
          campaign,
          lead,
          channel,
          tone,
          sender: state.profile.name,
        }),
      });
      const d = (await r.json()) as {
        error: string;
        subject: string;
        body: string;
        mode: string;
      };
      if (!r.ok) throw new Error(d.error);
      setSubject(d.subject);
      setBody(d.body);
      setMode(d.mode);
      setDraftId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate draft.");
    } finally {
      setGenerating(false);
    }
  }
  function starter() {
    if (!lead || !campaign) return;
    const d = outreachDraft(lead, campaign, channel, tone, state.profile.name);
    setSubject(d.subject);
    setBody(d.body);
    setMode("template");
    setDraftId("");
  }
  async function saveDraft() {
    if (!lead || !body.trim()) return;
    const id = draftId || uid();
    const existing = state.drafts.find((d) => d.id === id);
    const d: Draft = {
      id,
      leadId,
      channel,
      tone,
      subject,
      body,
      createdAt: existing?.createdAt || now(),
      scheduledFor,
    };
    if (
      await save(
        {
          ...state,
          drafts: existing
            ? state.drafts.map((x) => (x.id === id ? d : x))
            : [...state.drafts, d],
        },
        "Outreach draft saved",
      )
    )
      setDraftId(id);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        (channel === "Email" ? subject + "\n\n" : "") + body,
      );
      toast.success("Draft copied");
    } catch {
      toast.error(
        "Clipboard is unavailable. Select the text or download the draft.",
      );
    }
  }
  function load(d: Draft) {
    setLeadId(d.leadId);
    setChannel(d.channel);
    setTone(d.tone);
    setSubject(d.subject);
    setBody(d.body);
    setDraftId(d.id);
    setScheduledFor(d.scheduledFor);
    setMode("saved");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DRAFTS & TEMPLATES</p>
          <h1>Outreach studio</h1>
          <p className="muted">
            Write, review and save a relevant introduction for each lead.
          </p>
        </div>
      </div>
      <p className="notice">
        Review and send drafts through your own email or messaging account.
        Reminder dates appear under Follow-ups; delivery is not automated.
      </p>
      {!state.leads.length ? (
        <section className="panel">
          <Blank
            title="Start with someone worth connecting with."
            description="Add leads to a campaign, then come back to draft a relevant introduction."
          />
        </section>
      ) : (
        <div className="outreach-grid">
          <section className="panel">
            <div className="form-grid">
              <Field label="Lead">
                <Choice
                  disabled={generating}
                  label="Outreach lead"
                  value={leadId}
                  onChange={(v) => {
                    setLeadId(v);
                    setDraftId("");
                    setSubject("");
                    setBody("");
                    setScheduledFor("");
                    setMode("");
                    setTemplateId("none");
                  }}
                  options={leadOptions.map((l) => ({
                    value: l.id,
                    label: l.creator?.instagram
                      ? `${l.name} (${displayHandle(l.creator.instagram)})`
                      : l.name,
                  }))}
                />
              </Field>
              <Field
                label="Find a lead"
                hint={`${matches.length} match${matches.length === 1 ? "" : "es"}${matches.length > LEAD_OPTIONS ? `; showing the first ${LEAD_OPTIONS}` : ""}`}
              >
                <input
                  className="input"
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                  placeholder="Name, location or @handle"
                />
              </Field>
              <Field label="Channel">
                <Choice
                  disabled={generating}
                  label="Outreach channel"
                  value={channel}
                  onChange={(v) => {
                    setChannel(v as Draft["channel"]);
                    setDraftId("");
                    setBody("");
                    setSubject("");
                    setScheduledFor("");
                    setMode("");
                    setTemplateId("none");
                  }}
                  options={[...channels]}
                />
              </Field>
              <Field label="Tone">
                <Choice
                  disabled={generating}
                  label="Outreach tone"
                  value={tone}
                  onChange={setTone}
                  options={["Warm", "Formal", "Concise"]}
                />
              </Field>
              <Field label="Saved template">
                <Choice
                  disabled={generating}
                  label="Saved outreach template"
                  value={templateId}
                  onChange={(v) => {
                    setTemplateId(v);
                    const t = state.templates.find((t) => t.id === v);
                    if (t) {
                      setSubject(t.subject);
                      setBody(t.body);
                      setDraftId("");
                      setMode("template");
                    }
                  }}
                  options={[
                    { value: "none", label: "Choose a template" },
                    ...state.templates.map((t) => ({
                      value: t.id,
                      label: t.name,
                    })),
                  ]}
                />
              </Field>
            </div>
            {lead && (
              <p className="context-line">
                {campaign?.name} · {lead.industry} · {lead.location}
                {lead.kind === "creator"
                  ? ` · ${lead.creator?.partnership}`
                  : ""}
                {lead.demo ? " · Fictional sample lead" : ""}
              </p>
            )}
            {channel === "Instagram DM" && (
              <p className="notice">
                Instagram DMs are drafts only. Copy the message, open the
                profile and send it yourself from your own account.
              </p>
            )}
            <div className="button-row">
              <button
                className="primary"
                disabled={generating || !lead || !campaign}
                onClick={generate}
              >
                <Sparkles size={16} />
                {generating
                  ? "Writing your draft…"
                  : ai
                    ? "Generate AI draft"
                    : "Generate template draft"}
              </button>
              {ai && (
                <button className="text-button" onClick={starter}>
                  Use a template instead
                </button>
              )}
            </div>
            {mode && (
              <p className="muted mode-label">
                {mode === "ai"
                  ? "AI-generated draft. Review every detail before use."
                  : mode === "saved"
                    ? "Saved draft. Changes require saving."
                    : "Template-based draft · no live AI generation."}
              </p>
            )}
            <div className="draft-editor">
              <Field label="Subject / script title">
                <input
                  className="input"
                  maxLength={300}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Your opening line…"
                />
              </Field>
              <Field label="Message">
                <textarea
                  className="input message-input"
                  rows={13}
                  maxLength={10000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Generate a draft or write your own introduction…"
                />
              </Field>
              <Field label="Follow-up reminder (optional)">
                <input
                  className="input"
                  type="date"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </Field>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !body.trim()}
                  onClick={saveDraft}
                >
                  <Save size={16} />
                  {busy ? "Saving…" : "Save draft"}
                </button>
                <button
                  className="secondary"
                  disabled={!body.trim()}
                  onClick={copy}
                >
                  <Copy size={16} /> Copy
                </button>
                <button
                  className="secondary"
                  disabled={!body.trim()}
                  onClick={() =>
                    download("leadgen-outreach.txt", subject + "\n\n" + body)
                  }
                >
                  <Download size={16} /> Download
                </button>
              </div>
            </div>
            <details className="template-save">
              <summary>Save this wording as a reusable template</summary>
              <div className="toolbar">
                <input
                  className="input"
                  aria-label="Template name"
                  maxLength={300}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                />
                <button
                  className="secondary"
                  disabled={busy || !body.trim() || !templateName.trim()}
                  onClick={async () => {
                    if (
                      await save(
                        {
                          ...state,
                          templates: [
                            ...state.templates,
                            {
                              id: uid(),
                              name: templateName.trim(),
                              subject,
                              body,
                            },
                          ],
                        },
                        "Template saved",
                      )
                    )
                      setTemplateName("");
                  }}
                >
                  Save template
                </button>
              </div>
            </details>
          </section>
          <aside>
            <section className="panel preview-panel">
              <span className="eyebrow">MESSAGE PREVIEW</span>
              <div className="preview-address">
                {channel === "Instagram DM" ? (
                  <AtSign size={19} />
                ) : (
                  <Mail size={19} />
                )}
                <span>
                  To: {lead?.name || "Select a lead"}
                  <small>
                    {lead?.demo
                      ? "Sample recipient — not deliverable"
                      : channel === "Instagram DM"
                        ? displayHandle(lead?.creator?.instagram || "") ||
                          "No Instagram handle saved"
                        : channel === "WhatsApp" || channel === "Phone"
                          ? lead?.phone || "No phone available"
                          : lead?.email || "No email available"}
                  </small>
                </span>
              </div>
              {lead?.kind === "creator" && (
                <div className="button-row">
                  <ProfileButton lead={lead} />
                </div>
              )}
              <h3>{subject || "Your introduction goes here"}</h3>
              <p className="message-preview">
                {body || "Your draft will appear here as you write."}
              </p>
            </section>
            <section className="panel saved-drafts">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="drafts">
                    Drafts ({state.drafts.length})
                  </TabsTrigger>
                  <TabsTrigger value="sequence">Follow-ups</TabsTrigger>
                </TabsList>
              </Tabs>
              {(tab === "sequence"
                ? state.drafts
                    .filter((d) => d.scheduledFor)
                    .sort((a, b) =>
                      a.scheduledFor.localeCompare(b.scheduledFor),
                    )
                : state.drafts.slice().reverse()
              ).map((d) => (
                <button
                  className="draft-list-item"
                  key={d.id}
                  onClick={() => load(d)}
                >
                  <b>{d.subject || d.channel + " draft"}</b>
                  <small>
                    {state.leads.find((l) => l.id === d.leadId)?.name}
                  </small>
                  <span>
                    {d.channel} ·{" "}
                    {tab === "sequence"
                      ? formatDate(d.scheduledFor)
                      : formatDate(d.createdAt)}
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {(tab === "sequence"
                ? !state.drafts.some((d) => d.scheduledFor)
                : !state.drafts.length) && (
                <p className="muted py-5">
                  {tab === "sequence"
                    ? "Add a reminder date to a draft to plan your follow-up sequence."
                    : "Your saved drafts will appear here."}
                </p>
              )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
