"use client";
// Outcomes for a custom lead project: funnel, rates and breakdowns by tier,
// segment, channel, template, batch and source, with rule-based hints.
import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { hints, insights, rate, MIN_GROUP, type Group } from "@/lib/outcomes";
import { tierLabel } from "@/lib/allocation";
import { homeLabel } from "@/lib/ledger";
import type { ContactEvent } from "@/lib/project-schema";
import type { Workspace } from "@/lib/leadgen";
import type { Project } from "./project-details";

function Breakdown({ title, groups, showBad }: { title: string; groups: Group[]; showBad?: boolean }) {
  if (!groups.length) return null;
  return (
    <section className="panel">
      <h3>{title}</h3>
      <Table className="data-table">
        <TableHeader>
          <TableRow>
            <TableHead>{title.replace(/^By (\w)/, (_, c: string) => c.toUpperCase())}</TableHead>
            <TableHead>Given</TableHead>
            <TableHead>Contacted</TableHead>
            <TableHead>Replied</TableHead>
            <TableHead>Interested</TableHead>
            <TableHead>Won</TableHead>
            <TableHead>Reply rate</TableHead>
            {showBad && <TableHead>Bad contact</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={g.key}>
              <TableCell>{g.label}</TableCell>
              <TableCell>{g.given}</TableCell>
              <TableCell>
                {g.contacted} <small className="muted">({rate(g.contacted, g.given)}%)</small>
              </TableCell>
              <TableCell>{g.replied}</TableCell>
              <TableCell>{g.interested}</TableCell>
              <TableCell>{g.won}</TableCell>
              <TableCell>{rate(g.replied, g.contacted)}%</TableCell>
              {showBad && <TableCell>{rate(g.bad, g.contacted)}%</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export function projectInsights(project: Project, state: Workspace, events: ContactEvent[]) {
  const p = project.custom;
  return insights(
    state.leads.filter((l) => l.campaignId === project.id),
    events.filter((e) => e.campaignId === project.id),
    {
      tier: (t) => tierLabel(t as never, homeLabel(p)),
      segment: (s) => p.segments.find((x) => x.id === s)?.label ?? "Removed segment",
      template: (id, v) => `${p.templates.find((t) => t.id === id)?.name ?? (id.startsWith("starter-") ? `Starter · ${id.slice(8)}` : id)} v${v}`,
    },
  );
}

export function ProjectOutcomes({ project, state, events }: { project: Project; state: Workspace; events: ContactEvent[] }) {
  const data = useMemo(() => projectInsights(project, state, events), [project, state, events]);
  const top = data.funnel[0]?.count || 0;
  const t = data.totals;
  const tips = [...hints(data.byTier, "tier"), ...hints(data.bySegment, "segment"), ...hints(data.byChannel, "channel"), ...hints(data.byTemplate, "template")];
  return (
    <div className="form-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Funnel</h2>
            <p className="muted">Statuses are recorded by you. Replies are logged by hand; no inbox is connected.</p>
          </div>
        </div>
        {data.funnel.map((s) => (
          <div className="funnel-row funnel-wide" key={s.key}>
            <span>{s.label}</span>
            <Progress value={top ? (100 * s.count) / top : 0} aria-label={`${s.label}: ${s.count} leads`} />
            <b>{s.count}</b>
          </div>
        ))}
        <div className="details-grid">
          <span>
            Contact rate<strong>{t.contactRate}%</strong>
          </span>
          <span>
            Reply rate<strong>{t.replyRate}%</strong>
          </span>
          <span>
            Interested rate<strong>{t.interestedRate}%</strong>
          </span>
          <span>
            Win rate<strong>{t.winRate}%</strong>
          </span>
          <span>
            Median time to first reply<strong>{t.medianHoursToReply === null ? "No replies yet" : t.medianHoursToReply < 48 ? `${Math.round(t.medianHoursToReply)} h` : `${Math.round(t.medianHoursToReply / 24)} days`}</strong>
          </span>
        </div>
        {tips.length ? (
          <ul className="notes">
            {tips.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Hints appear once every group being compared has at least {MIN_GROUP} contacted leads. They never change settings.</p>
        )}
      </section>
      <Breakdown title="By tier" groups={data.byTier} />
      <Breakdown title="By segment" groups={data.bySegment} />
      <Breakdown title="By channel" groups={data.byChannel} />
      <Breakdown title="By template" groups={data.byTemplate} />
      <Breakdown title="By batch" groups={data.byBatch} />
      <Breakdown title="By source" groups={data.bySource} showBad />
    </div>
  );
}
