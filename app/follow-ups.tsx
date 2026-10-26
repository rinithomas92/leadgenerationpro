"use client";

import { useState } from "react";
import { CalendarClock, Check } from "lucide-react";
import { getFollowUps, type Lead, type Workspace } from "@/lib/leadgen";
import { followUpLabel } from "@/lib/outcomes";
import { Blank, Choice, formatDate } from "./ui";

type Props = {
  state: Workspace;
  save: (state: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  outreach: (lead: Lead) => void;
  // Custom lead projects: open the lead's project, and No-response suggestions.
  projectTools?: {
    open: (lead: Lead) => void;
    noResponse: Lead[];
    markNoResponse: (leads: Lead[]) => Promise<unknown>;
  };
};

export function FollowUps({ state, save, busy, outreach, projectTools }: Props) {
  const [filter, setFilter] = useState("All reminders");
  const reminders = getFollowUps(state);
  const visible = reminders.filter(
    (item) =>
      filter === "All reminders" ||
      (filter === "Due now" ? item.due : !item.due),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONVERSATION MANAGEMENT</p>
          <h1>Follow-ups & replies</h1>
          <p className="muted">
            {reminders.filter((item) => item.due).length} due · Plan the next
            step for each conversation.
          </p>
        </div>
        <Choice
          label="Filter reminders"
          value={filter}
          onChange={setFilter}
          options={["All reminders", "Due now", "Upcoming"]}
        />
      </div>
      <p className="notice">
        Email and WhatsApp syncing are not connected. Track replies in each
        lead’s notes and stage. Reminders below do not send messages.
      </p>
      <section className="panel">
        <div className="section-title">
          <h2>Scheduled follow-ups</h2>
          <CalendarClock size={20} />
        </div>
        {!visible.length ? (
          <Blank
            title="No follow-ups in this view"
            description="Set a reminder date on a lead or outreach draft. Your reminders will appear here."
          />
        ) : (
          <div className="reminder-list">
            {visible.map((item) => (
              <article className="reminder-item" key={item.id}>
                <div>
                  <span
                    className={
                      "status " + (item.due ? "status-paused" : "status-active")
                    }
                  >
                    {item.due ? "Due" : "Upcoming"} · {formatDate(item.date)}
                  </span>
                  <h3>{item.lead.name}</h3>
                  <p className="muted">
                    {followUpLabel(item.lead) || item.label} ·{" "}
                    {
                      state.campaigns.find((c) => c.id === item.lead.campaignId)
                        ?.name
                    }
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => (item.lead.project && projectTools ? projectTools.open(item.lead) : outreach(item.lead))}
                  >
                    Draft follow-up
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      save(
                        item.draftId
                          ? {
                              ...state,
                              drafts: state.drafts.map((d) =>
                                d.id === item.draftId
                                  ? { ...d, scheduledFor: "" }
                                  : d,
                              ),
                            }
                          : {
                              ...state,
                              leads: state.leads.map((l) =>
                                l.id === item.lead.id
                                  ? { ...l, followUp: "" }
                                  : l,
                              ),
                            },
                        "Reminder completed",
                      )
                    }
                  >
                    <Check size={16} /> Complete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {projectTools && projectTools.noResponse.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Suggested: No response</h2>
              <p className="muted">
                Contacted lead-project leads with no reply and no further contact for the
                project&apos;s waiting period after their last follow-up. Nothing changes until you choose.
              </p>
            </div>
            <button className="secondary" disabled={busy} onClick={() => projectTools.markNoResponse(projectTools.noResponse)}>
              Mark all {projectTools.noResponse.length} as No response
            </button>
          </div>
          <div className="reminder-list">
            {projectTools.noResponse.map((l) => (
              <article className="reminder-item" key={l.id}>
                <div>
                  <h3>{l.name}</h3>
                  <p className="muted">
                    Last contacted {formatDate(l.project!.outreach.lastContactedAt)} · {state.campaigns.find((c) => c.id === l.campaignId)?.name}
                  </p>
                </div>
                <div className="button-row">
                  <button className="secondary" disabled={busy} onClick={() => projectTools.markNoResponse([l])}>
                    Mark No response
                  </button>
                  <button className="text-button" onClick={() => projectTools.open(l)}>
                    Open
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
