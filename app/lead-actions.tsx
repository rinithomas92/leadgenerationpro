"use client";
// Draft preview and the app-opening actions for one custom-project lead:
// Copy, Open WhatsApp, Open email, Open Instagram, Call. The user always
// presses send in their own app. Used by the Outreach tab, lead rows and the map.
import { useMemo, useState } from "react";
import { Copy, Mail, MessageCircle, Phone, Camera, Send, Reply } from "lucide-react";
import { toast } from "sonner";
import { Choice } from "./ui";
import {
  callLink,
  canSend,
  contextFor,
  instagramProfile,
  mailtoLink,
  messageWarnings,
  pickTemplate,
  render,
  whatsappLink,
} from "@/lib/templates";
import { templateChannels, type CustomProject, type ProjectTemplate, type TemplateChannel } from "@/lib/project-schema";
import type { Lead } from "@/lib/leadgen";

export type SentInfo = { channel: TemplateChannel; template: ProjectTemplate };
type Props = {
  lead: Lead;
  project: CustomProject;
  workspaceTemplates?: ProjectTemplate[];
  // A template being edited, previewed instead of the saved one.
  draftTemplate?: ProjectTemplate;
  channel?: TemplateChannel;
  onChannel?: (c: TemplateChannel) => void;
  compact?: boolean;
  onSent?: (info: SentInfo) => void;
  onReply?: () => void;
  busy?: boolean;
};

/** Highlights unfilled placeholders, which the renderer shows as [name]. */
function Highlighted({ text, missing }: { text: string; missing: string[] }) {
  if (!missing.length) return <>{text}</>;
  // split() with one capture group puts the matches at odd positions.
  const re = new RegExp(`(\\[(?:${missing.map((m) => m.replace(/[^a-z_]/g, "")).join("|")})\\])`);
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="missing-mark">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function LeadActions({ lead, project, workspaceTemplates = [], draftTemplate, channel: fixed, onChannel, compact, onSent, onReply, busy }: Props) {
  const [own, setOwn] = useState<TemplateChannel>(lead.project?.phoneE164 ? "WhatsApp" : lead.email ? "Email" : lead.creator?.instagramUrl ? "Instagram DM" : "Call script");
  const channel = fixed ?? own;
  const setChannel = onChannel ?? setOwn;
  const template = draftTemplate && draftTemplate.channel === channel ? draftTemplate : pickTemplate(channel, lead.project?.segmentId ?? "", project, workspaceTemplates);
  const ctx = useMemo(() => contextFor(lead, project), [lead, project]);
  const body = render(template.body, ctx);
  const subject = render(template.subject, ctx);
  const ready = canSend(body) && (!template.subject || canSend(subject));
  const problems = [...new Set([...body.missing, ...subject.missing])];
  const unknown = [...new Set([...body.unknown, ...subject.unknown])];
  const wa = whatsappLink(lead, body.text);
  const mail = lead.email ? mailtoLink(lead.email, subject.text, body.text) : undefined;
  const ig = instagramProfile(lead);
  const tel = callLink(lead);
  const copy = async (text = channel === "Email" ? `Subject: ${subject.text}\n\n${body.text}` : body.text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied");
      return true;
    } catch {
      toast.error("Copy failed; select the text and copy it instead.");
      return false;
    }
  };
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <div className={"lead-actions" + (compact ? " compact" : "")}>
      {!fixed && (
        <Choice label="Channel" value={channel} onChange={(v) => setChannel(v as TemplateChannel)} options={[...templateChannels]} />
      )}
      {!compact && (
        <>
          <small className="muted">
            Template: {template.name}
            {template.id.startsWith("starter-") ? "" : ` · v${template.version}`}
          </small>
          {template.subject && (
            <p className="draft-subject">
              <b>Subject:</b> <Highlighted text={subject.text} missing={subject.missing} />
            </p>
          )}
          <pre className="draft-preview">
            <Highlighted text={body.text} missing={body.missing} />
          </pre>
          <small className="muted">
            {body.text.length} characters
            {messageWarnings(channel, body.text).map((w) => ` · ${w}`)}
          </small>
        </>
      )}
      {(problems.length > 0 || unknown.length > 0 || body.errors.length > 0) && (
        <p className="form-error" role="alert">
          {problems.length > 0 && `No value for ${problems.map((p) => `{${p}}`).join(", ")}: add it to the sender profile or give it a fallback such as {${problems[0]}|…}. `}
          {unknown.length > 0 && `Unknown placeholder ${unknown.map((u) => `{${u}}`).join(", ")} (a typo?). `}
          {body.errors.join(" ")}
        </p>
      )}
      <div className="button-row">
        <button className="secondary" disabled={!ready} onClick={() => copy()}>
          <Copy size={14} /> Copy
        </button>
        {channel !== "Call script" && wa && (
          <button className="secondary" disabled={!ready} onClick={() => open(wa)}>
            <MessageCircle size={14} /> Open WhatsApp
          </button>
        )}
        {mail && (
          <button
            className="secondary"
            disabled={!ready}
            onClick={() => (mail.tooLong ? (toast.info("This email is too long for a mail link; it was copied instead."), copy()) : (window.location.href = mail.href))}
            title={mail.tooLong ? "Too long for a mail link; Copy is used instead" : ""}
          >
            <Mail size={14} /> Open email
          </button>
        )}
        {ig && (
          <button
            className="secondary"
            disabled={!ready}
            onClick={async () => {
              await copy(body.text);
              open(ig);
            }}
          >
            <Camera size={14} /> Open Instagram
          </button>
        )}
        {tel && (
          <a className="secondary" href={tel} onClick={() => channel !== "Call script" && setChannel("Call script")}>
            <Phone size={14} /> Call
          </a>
        )}
        {onSent && (
          <button className="primary" disabled={busy || !ready} onClick={() => onSent({ channel, template })}>
            <Send size={14} /> Mark as sent
          </button>
        )}
        {onReply && (
          <button className="secondary" disabled={busy} onClick={onReply}>
            <Reply size={14} /> Log reply
          </button>
        )}
      </div>
      {!wa && lead.project?.phoneE164 && channel === "WhatsApp" && <small className="muted">WhatsApp is offered only for mobile numbers; this one looks like a landline.</small>}
    </div>
  );
}
