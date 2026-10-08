"use client";

import { useState } from "react";
import { CalendarClock, Check } from "lucide-react";
import { getFollowUps, type Lead, type Workspace } from "@/lib/leadgen";
import { Blank, Choice, formatDate } from "./ui";

type Props = {
  state: Workspace;
  save: (state: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  outreach: (lead: Lead) => void;
};

export function FollowUps({ state, save, busy, outreach }: Props) {
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
                    {item.label} ·{" "}
                    {
                      state.campaigns.find((c) => c.id === item.lead.campaignId)
                        ?.name
                    }
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => outreach(item.lead)}
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
    </>
  );
}
