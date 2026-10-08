"use client";

import { useState } from "react";
import {
  Plus,
  ScanSearch,
  CalendarClock,
  Target,
  FileText,
} from "lucide-react";
import {
  getFollowUps,
  presets,
  type Campaign,
  type Workspace,
} from "@/lib/leadgen";
import { CampaignTable } from "./campaigns";
import { Mark, Stats, formatDate } from "./ui";

type Props = {
  state: Workspace;
  start: (theme?: number, description?: string) => void;
  go: (page: string) => void;
  open: (campaign: Campaign) => void;
  sample: () => void;
  busy: boolean;
};

export function Dashboard({ state, start, go, open, sample, busy }: Props) {
  const [description, setDescription] = useState("");
  const followUps = getFollowUps(state);
  const active = state.campaigns.filter(
    (c) => c.status === "Active" && !c.demo,
  );
  const shortlisted = state.leads.filter(
    (l) => !l.demo && l.stage === "Shortlisted",
  ).length;
  const drafts = state.drafts.filter((d) =>
    state.leads.some((l) => l.id === d.leadId && !l.demo),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE OVERVIEW</p>
          <h1>Your growth, in focus.</h1>
          <p className="muted">
            Welcome back, {state.profile.name}. Here’s where your pipeline
            stands.
          </p>
        </div>
        <button className="primary" onClick={() => start()}>
          <Plus size={17} /> New campaign
        </button>
      </div>
      <Stats leads={state.leads} />
      <div className="dashboard-grid operations-grid">
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Active campaigns</h2>
              <p className="muted">
                {active.length} active · Track your markets and qualified leads
              </p>
            </div>
            <button className="text-button" onClick={() => go("Campaigns")}>
              View all
            </button>
          </div>
          <CampaignTable
            campaigns={active.slice(0, 5)}
            state={state}
            open={open}
            start={start}
          />
        </section>
        <section className="panel next-actions">
          <div className="section-title">
            <div>
              <h2>Next steps</h2>
              <p className="muted">Keep promising conversations moving</p>
            </div>
          </div>
          {state.profile.notifications && (
            <button className="action-row" onClick={() => go("Inbox")}>
              <CalendarClock size={19} />
              <span>
                <b>Follow-ups due</b>
                <small>Lead and draft reminders</small>
              </span>
              <strong>{followUps.filter((f) => f.due).length}</strong>
            </button>
          )}
          <button className="action-row" onClick={() => go("Leads")}>
            <Target size={19} />
            <span>
              <b>Shortlisted leads</b>
              <small>Ready for a closer look</small>
            </span>
            <strong>{shortlisted}</strong>
          </button>
          <button className="action-row" onClick={() => go("Outreach")}>
            <FileText size={19} />
            <span>
              <b>Saved drafts</b>
              <small>Review before sending</small>
            </span>
            <strong>{drafts.length}</strong>
          </button>
          <p className="muted action-note">
            Outreach is always reviewed and sent by you.
          </p>
        </section>
      </div>
      <section className="finder compact-finder">
        <div className="finder-copy">
          <span className="eyebrow">MARKET DISCOVERY</span>
          <h2>Find the right market for your offer.</h2>
          <p>Describe your product or service to start a campaign.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (description.trim()) start(5, description.trim());
          }}
        >
          <ScanSearch size={20} />
          <input
            aria-label="What are you trying to sell?"
            placeholder="e.g. Custom artwork for independent cafés in Pune"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={2000}
          />
          <button className="primary">Find my market</button>
        </form>
      </section>
      <div className="section-title">
        <div>
          <h2>Campaign templates</h2>
          <p className="muted">
            Start with a business you know, then refine your audience.
          </p>
        </div>
        {!state.campaigns.length && (
          <button className="text-button" disabled={busy} onClick={sample}>
            Explore sample data
          </button>
        )}
      </div>
      <div className="template-grid">
        {presets.map((p, i) => (
          <button
            className="template-card"
            key={p.name}
            onClick={() => start(i)}
          >
            <Mark theme={i} />
            <div>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
            </div>
          </button>
        ))}
      </div>
      {state.profile.notifications && followUps.length > 0 && (
        <p className="muted next-reminder">
          Next reminder: {followUps[0].lead.name} ·{" "}
          {formatDate(followUps[0].date)}
        </p>
      )}
    </>
  );
}
