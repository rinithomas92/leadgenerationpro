"use client";
import { useState } from "react";
import { Inbox as InboxIcon, Plug, Download, ArrowRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { emptyWorkspace, metrics, stages, type Workspace } from "@/lib/leadgen";
import { Stats, Blank, Field, Choice, download } from "./ui";
export function Analytics({ state }: { state: Workspace }) {
  const [range, setRange] = useState("All time");
  const [campaign, setCampaign] = useState("all");
  const cutoff =
    range === "All time" ? 0 : Date.now() - Number(range) * 86400000;
  const leads = state.leads.filter(
    (l) =>
      !l.demo &&
      new Date(l.discoveredAt).getTime() >= cutoff &&
      (campaign === "all" || l.campaignId === campaign),
  );
  const m = metrics(leads);
  const pct = (n: number, d: number) =>
    d ? `${Math.round((n / d) * 100)}%` : "—";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERFORMANCE OVERVIEW</p>
          <h1>Pipeline analytics</h1>
          <p className="muted">Learn from the conversations you record.</p>
        </div>
        <div className="button-row">
          <Choice
            label="Analytics date range"
            value={range}
            onChange={setRange}
            options={[
              "All time",
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ]}
          />
          <Choice
            label="Analytics campaign"
            value={campaign}
            onChange={setCampaign}
            options={[
              { value: "all", label: "All campaigns" },
              ...state.campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </div>
      <p className="notice">
        Metrics use saved stages for leads discovered in the selected period.
        Sample records are excluded.
      </p>
      <Stats leads={leads} />
      <div className="analytics-grid">
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Your lead pipeline</h2>
              <p className="muted">Current distribution of your saved leads</p>
            </div>
          </div>
          {stages.map((stage) => {
            const count = leads.filter((l) => l.stage === stage).length;
            return (
              <div className="funnel-row" key={stage}>
                <span>{stage}</span>
                <Progress
                  value={leads.length ? (count / leads.length) * 100 : 0}
                  aria-label={`${stage}: ${count} leads`}
                />
                <b>{count}</b>
              </div>
            );
          })}
        </section>
        <section className="panel">
          <h2>Conversation signals</h2>
          <div className="rate">
            <strong>{pct(m.replied, m.contacted)}</strong>
            <span>
              Response rate
              <small>Replied, interested or converted ÷ ever contacted</small>
            </span>
          </div>
          <div className="rate">
            <strong>{pct(m.converted, m.found)}</strong>
            <span>
              Conversion rate<small>Currently converted ÷ all leads</small>
            </span>
          </div>
          <p className="notice">
            {!m.found
              ? "Add leads to start learning from your campaign."
              : !m.contacted
                ? "Shortlist relevant leads, then record your first outreach."
                : m.replied === 0
                  ? "No replies recorded yet. Review your targeting and try a more specific introduction."
                  : "Review the leads that replied and use those patterns to refine your next campaign."}
          </p>
        </section>
      </div>
      <section className="panel">
        <h2>Campaign comparison</h2>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Contacted</TableHead>
              <TableHead>Replies</TableHead>
              <TableHead>Converted</TableHead>
              <TableHead>Response rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.campaigns
              .filter((c) => campaign === "all" || campaign === c.id)
              .map((c) => {
                const x = metrics(leads.filter((l) => l.campaignId === c.id));
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      {c.name}
                      {c.demo && <span className="mini-label">Demo</span>}
                    </TableCell>
                    <TableCell>{x.found}</TableCell>
                    <TableCell>{x.contacted}</TableCell>
                    <TableCell>{x.replied}</TableCell>
                    <TableCell>{x.converted}</TableCell>
                    <TableCell>{pct(x.replied, x.contacted)}</TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </section>
      <details className="metric-definitions">
        <summary>How these numbers are calculated</summary>
        <p>
          Leads found is the total saved records. Contacted counts leads ever
          moved to Contacted, Replied, Interested or Converted. Interested
          includes current Interested and Converted stages. Replies include
          current Replied, Interested and Converted stages. Lost or subsequently
          moved leads no longer count toward current reply and interest totals.
          Stages are manually recorded; no email delivery or opening data is
          inferred.
        </p>
      </details>
    </>
  );
}
export function Inbox({ go }: { go: (p: string) => void }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KEEP THE CONVERSATION GOING</p>
          <h1>Your inbox</h1>
          <p className="muted">
            Replies will belong beside the people and campaigns they’re part of.
          </p>
        </div>
      </div>
      <section className="panel inbox-empty">
        <InboxIcon size={46} />
        <Blank
          title="Your inbox isn’t connected yet."
          description="Email and WhatsApp reply syncing need a provider integration. For now, keep conversation notes on each lead and update its stage when you receive a reply."
        >
          <button className="primary" onClick={() => go("Leads")}>
            Record a reply on a lead <ArrowRight size={16} />
          </button>
          <button className="text-button" onClick={() => go("Settings")}>
            View integration status
          </button>
        </Blank>
      </section>
    </>
  );
}
export function Settings({
  state,
  save,
  busy,
  ai,
  sample,
}: {
  state: Workspace;
  save: (s: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  ai: boolean;
  sample: () => void;
}) {
  const [profile, setProfile] = useState(state.profile);
  const [reset, setReset] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE THIS SPACE YOURS</p>
          <h1>Workspace settings</h1>
          <p className="muted">Your business, preferences and connections.</p>
        </div>
      </div>
      <div className="settings-grid">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ ...state, profile }, "Profile saved");
          }}
        >
          <h2>Your profile</h2>
          <Field label="Your name">
            <input
              className="input"
              required
              maxLength={300}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </Field>
          <Field label="Business name">
            <input
              className="input"
              maxLength={300}
              value={profile.business}
              onChange={(e) =>
                setProfile({ ...profile, business: e.target.value })
              }
            />
          </Field>
          <Field label="Business website">
            <input
              className="input"
              type="url"
              maxLength={300}
              value={profile.website}
              onChange={(e) =>
                setProfile({ ...profile, website: e.target.value })
              }
              placeholder="https://"
            />
          </Field>
          <label className="switch-row">
            <span>
              Show follow-up reminders
              <small>
                Reminders appear in your dashboard while using the app.
              </small>
            </span>
            <Switch
              checked={profile.notifications}
              onCheckedChange={(v) =>
                setProfile({ ...profile, notifications: v })
              }
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
        <section className="panel">
          <h2>Your connections</h2>
          <div className="integration">
            <Plug size={21} />
            <div>
              <b>AI market & outreach assistant</b>
              <span className={"mini-label " + (ai ? "neutral" : "")}>
                {ai ? "Configured" : "Not connected"}
              </span>
              <p>
                {ai
                  ? "AI generation is available. Suggestions still require your review."
                  : "Editable starter markets and message templates are available now."}
              </p>
              <details>
                <summary>Connection setup</summary>
                <p>
                  A developer can configure the server’s OPENAI_API_KEY and
                  OPENAI_MODEL in Sites environment settings. Keys are never
                  entered into or exposed by this page.
                </p>
              </details>
            </div>
          </div>
          <div className="integration">
            <Plug size={21} />
            <div>
              <b>Live lead discovery</b>
              <span className="mini-label neutral">Public directory</span>
              <p>
                Public OpenStreetMap directory search is available.
                Source-linked Pune hotel and interior-design research is also
                included. Email and phone coverage varies.
              </p>
            </div>
          </div>
          <div className="integration">
            <Plug size={21} />
            <div>
              <b>Email & WhatsApp</b>
              <span className="mini-label">Not connected</span>
              <p>
                Copy or download drafts. Sending, reply syncing and scheduled
                delivery need a provider integration.
              </p>
            </div>
          </div>
        </section>
      </div>
      <section className="panel data-controls">
        <h2>Your data</h2>
        <p className="muted">
          Records are saved to your signed-in workspace. Exports include
          campaigns, leads, drafts, templates and preferences.
        </p>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() =>
              download(
                "leadgen-workspace.json",
                JSON.stringify(state, null, 2),
                "application/json",
              )
            }
          >
            <Download size={16} /> Export workspace
          </button>
          <button
            className="secondary"
            disabled={busy || state.campaigns.some((c) => c.demo)}
            onClick={sample}
          >
            Add sample workspace
          </button>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => setReset(true)}
          >
            Clear all workspace data
          </button>
        </div>
      </section>
      <AlertDialog open={reset} onOpenChange={setReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear your workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes all campaigns, leads, drafts and
              templates, and resets preferences. Export your workspace first if
              you need a copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my data</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                const next = emptyWorkspace();
                if (await save(next, "Workspace cleared")) {
                  setProfile(next.profile);
                  setReset(false);
                }
              }}
            >
              {busy ? "Clearing…" : "Clear workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
