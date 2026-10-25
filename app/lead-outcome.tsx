"use client";
// Outcome tracking controls for one custom-project lead: one-click statuses,
// Mark as sent / Log reply (via the template actions) and its contact history.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeadActions, type SentInfo } from "./lead-actions";
import { Choice, Field, formatDate } from "./ui";
import { outreachLabels } from "@/lib/lead-filters";
import { outreachStatuses, templateChannels, type ContactEvent, type CustomProject, type OutreachStatus, type ProjectTemplate } from "@/lib/project-schema";
import type { Lead } from "@/lib/leadgen";

export type OutcomeHandlers = {
  onSent: (lead: Lead, info: SentInfo) => Promise<unknown>;
  onReply: (lead: Lead) => void;
  onStatus: (lead: Lead, status: OutreachStatus) => Promise<unknown>;
};

/** One-click status chips. Do not contact also adds the lead to the do-not-contact list. */
export function StatusChips({ lead, busy, onStatus }: { lead: Lead; busy: boolean; onStatus: OutcomeHandlers["onStatus"] }) {
  const current = lead.project?.outreach.status ?? "not_contacted";
  return (
    <div className="chips" role="group" aria-label="Outreach status">
      {outreachStatuses.map((s) => (
        <button key={s} className={"chip" + (s === current ? " chip-on" : "")} aria-pressed={s === current} disabled={busy || s === current} onClick={() => onStatus(lead, s)}>
          {outreachLabels[s]}
        </button>
      ))}
    </div>
  );
}
/** Compact status picker for table rows. */
export function StatusSelect({ lead, busy, onStatus }: { lead: Lead; busy: boolean; onStatus: OutcomeHandlers["onStatus"] }) {
  return (
    <Choice
      label={`Outreach status for ${lead.name}`}
      disabled={busy}
      value={lead.project?.outreach.status ?? "not_contacted"}
      options={outreachStatuses.map((s) => ({ value: s, label: outreachLabels[s] }))}
      onChange={(v) => onStatus(lead, v as OutreachStatus)}
    />
  );
}

export function LeadOutcomePanel({
  lead,
  project,
  events,
  workspaceTemplates,
  busy,
  handlers,
}: {
  lead: Lead;
  project: CustomProject;
  events: ContactEvent[];
  workspaceTemplates: ProjectTemplate[];
  busy: boolean;
  handlers: OutcomeHandlers;
}) {
  const mine = events.filter((e) => e.leadId === lead.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const p = lead.project!;
  return (
    <section className="outcome-panel">
      <h3>Outreach</h3>
      <p className="muted">
        {outreachLabels[p.outreach.status]}
        {p.delivery.batch ? ` · Batch ${p.delivery.batch}` : " · in the pool (not given yet)"}
        {p.outreach.lastContactedAt && ` · last contacted ${formatDate(p.outreach.lastContactedAt)}`}
        {lead.followUp && ` · ${p.outreach.followUpStep ? `Follow-up ${p.outreach.followUpStep}` : "Reminder"} due ${formatDate(lead.followUp)}`}
      </p>
      <StatusChips lead={lead} busy={busy} onStatus={handlers.onStatus} />
      <LeadActions lead={lead} project={project} workspaceTemplates={workspaceTemplates} busy={busy} onSent={(info) => handlers.onSent(lead, info)} onReply={() => handlers.onReply(lead)} />
      {mine.length > 0 && (
        <ul className="notes">
          {mine.map((e) => (
            <li key={e.id}>
              {formatDate(e.createdAt)} · {e.direction === "reply" ? "Reply" : "Sent"} · {e.channel}
              {e.templateId && ` · template v${e.templateVersion}`}
              {e.note && ` · ${e.note}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Log reply: channel and an optional note. */
export function ReplyDialog({ lead, busy, onClose, onSave }: { lead: Lead | null; busy: boolean; onClose: () => void; onSave: (lead: Lead, channel: string, note: string) => Promise<unknown> }) {
  const [channel, setChannel] = useState<string>("WhatsApp");
  const [note, setNote] = useState("");
  return (
    <Dialog open={!!lead} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log reply · {lead?.name}</DialogTitle>
          <DialogDescription>Replies are recorded by hand; no inbox is connected.</DialogDescription>
        </DialogHeader>
        <Choice label="Channel" value={channel} onChange={setChannel} options={templateChannels.filter((c) => !c.startsWith("Follow-up")).map((c) => (c === "Call script" ? "Phone" : c))} />
        <Field label="Note (optional)">
          <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say?" />
        </Field>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || !lead}
            onClick={async () => {
              if (!lead) return;
              await onSave(lead, channel, note.trim());
              setNote("");
            }}
          >
            Save reply
          </button>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
