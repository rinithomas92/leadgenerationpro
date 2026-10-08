"use client";
import { useState, useRef } from "react";
import {
  Search,
  Download,
  Upload,
  ArrowRight,
  ExternalLink,
  Plus,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  stages,
  now,
  uid,
  wellnessTerms,
  matchesLeadSearch,
  updateStage,
  assessFit,
  safeUrl,
  toCSV,
  parseCSV,
  deduplicate,
  type Workspace,
  type Lead,
} from "@/lib/leadgen";
import { Choice, Field, Blank, download, formatDate } from "./ui";
type Props = {
  state: Workspace;
  save: (s: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  campaignFilter: string;
  setCampaignFilter: (s: string) => void;
  outreach: (l: Lead) => void;
};
export function Leads({
  state,
  save,
  busy,
  campaignFilter,
  setCampaignFilter,
  outreach,
}: Props) {
  const latest = useRef(state);
  latest.current = state;
  const [discovering, setDiscovering] = useState(false);
  const [sourceView, setSourceView] = useState("real");
  const [discoveryMessage, setDiscoveryMessage] = useState("");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("All stages");
  const [industry, setIndustry] = useState("All industries");
  const [location, setLocation] = useState("");
  const [score, setScore] = useState("Any score");
  const [contact, setContact] = useState("Any contact");
  const [view, setView] = useState("table");
  const [selection, setSelection] = useState<string[]>([]);
  const [detail, setDetail] = useState<Lead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCSV] = useState("");
  const [target, setTarget] = useState(
    campaignFilter !== "all"
      ? campaignFilter
      : state.campaigns[0]?.id || "none",
  );
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const filtered = state.leads.filter(
    (l) =>
      (sourceView === "all" || !l.demo) &&
      (campaignFilter === "all" || l.campaignId === campaignFilter) &&
      (stage === "All stages" || l.stage === stage) &&
      (industry === "All industries" || l.industry === industry) &&
      l.location.toLowerCase().includes(location.toLowerCase()) &&
      (score === "Any score" || l.score >= Number(score)) &&
      (contact === "Any contact" ||
        (contact === "Has email"
          ? !!l.email
          : contact === "Has phone"
            ? !!l.phone
            : !l.email && !l.phone)) &&
      matchesLeadSearch(l, q),
  );
  const visibleSelection = selection.filter((id) =>
    filtered.some((l) => l.id === id),
  );
  async function discover() {
    const active = state.campaigns.filter(
      (c) => c.status === "Active" && !c.demo,
    );
    const c =
      active.find((c) => c.id === campaignFilter) ||
      (wellnessTerms.test(q)
        ? active.find((c) => wellnessTerms.test(c.name + " " + c.description))
        : active.length === 1
          ? active[0]
          : undefined);
    if (!c) {
      toast.error("Select the campaign you want to discover businesses for.");
      return;
    }
    setDiscovering(true);
    try {
      const r = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: q.trim()
            ? {
                ...c,
                markets: [
                  {
                    name: q.trim(),
                    reason: "User search",
                    needs: "",
                    positioning: "",
                    search: q.trim(),
                    score: 0,
                  },
                ],
              }
            : c,
          mode: "directory",
        }),
      });
      const d = (await r.json()) as {
        error?: string;
        leads: Lead[];
        message: string;
      };
      if (!r.ok) throw new Error(d.error);
      setDiscoveryMessage(d.message);
      setQ("");
      setStage("All stages");
      setIndustry("All industries");
      setScore("Any score");
      setContact("Any contact");
      setLocation("");
      setSelection([]);
      setCampaignFilter(c.id);
      const current = latest.current;
      const unique = deduplicate(current.leads, d.leads);
      if (!unique.length) {
        toast.info(
          d.leads.length
            ? "Matching real businesses are already saved."
            : "No listings found. Try a broader city or market.",
        );
        return;
      }
      if (
        await save(
          { ...current, leads: [...current.leads, ...unique] },
          `${unique.length} real businesses added`,
        )
      ) {
        setCampaignFilter(c.id);
        setSourceView("real");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }
  async function bulk(next: string) {
    const leads = state.leads.map((l) =>
      visibleSelection.includes(l.id)
        ? updateStage(l, next as Lead["stage"])
        : l,
    );
    if (await save({ ...state, leads }, "Lead stages updated"))
      setSelection([]);
  }
  async function importCSV() {
    try {
      const records = parseCSV(csv);
      if (!records.length) throw new Error("Add at least one lead row.");
      if (records.length > 500)
        throw new Error("Import up to 500 leads at a time.");
      if (!state.campaigns.some((c) => c.id === target))
        throw new Error("Select a campaign first.");
      const incoming = records.map((r, i): Lead => {
        if (!r.name?.trim())
          throw new Error(`Row ${i + 2} needs a business name.`);
        if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
          throw new Error(`Row ${i + 2} has an invalid email address.`);
        if (r.website && !safeUrl(r.website))
          throw new Error(
            `Row ${i + 2} needs a full http or https website address.`,
          );
        return {
          id: uid(),
          campaignId: target,
          name: r.name,
          industry: r.industry || "Uncategorized",
          location: r.location || "",
          website: r.website || "",
          email: r.email || "",
          phone: r.phone || "",
          source: safeUrl(r.source || ""),
          sourceLabel: "User CSV import · not independently verified",
          discoveredAt: now(),
          score: 0,
          reason:
            "Not scored. Review this imported business against your selected market before assigning a fit score.",
          missing:
            "Buying intent, budget, business details and public contact source need review.",
          stage: "New",
          notes: "",
          tags: r.tags || "",
          followUp: "",
          contactedAt: "",
          demo: r.demo?.toLowerCase() === "true",
          history: [{ at: now(), event: "Imported from CSV" }],
        };
      });
      const unique = deduplicate(state.leads, incoming);
      if (!unique.length)
        throw new Error("All these leads already exist in your workspace.");
      if (
        await save(
          { ...state, leads: [...state.leads, ...unique] },
          `${unique.length} leads imported; ${incoming.length - unique.length} duplicates skipped`,
        )
      ) {
        setImportOpen(false);
        setCSV("");
        setCampaignFilter(target);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import CSV.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LEAD MANAGEMENT</p>
          <h1>Your leads</h1>
          <p className="muted">
            Qualify businesses, manage your pipeline and plan your next
            conversation.
          </p>
        </div>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() =>
              download(
                "leadgen-leads.csv",
                toCSV(filtered),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            className="primary"
            disabled={
              discovering ||
              busy ||
              !state.campaigns.some((c) => c.status === "Active" && !c.demo)
            }
            onClick={discover}
          >
            <Search size={16} />
            {discovering
              ? "Searching public directory…"
              : q.trim()
                ? "Search directory"
                : "Find real businesses"}
          </button>
          <button
            className="secondary"
            disabled={!state.campaigns.length}
            onClick={() => {
              setTarget(
                campaignFilter !== "all"
                  ? campaignFilter
                  : state.campaigns[0]?.id || "none",
              );
              setImportOpen(true);
            }}
          >
            <Upload size={16} /> Import leads
          </button>
        </div>
      </div>
      <p className="notice">
        Real businesses with source links. Public directory results may have
        missing or outdated contacts; buying intent is not verified. Sample
        leads are hidden by default.
      </p>
      {discoveryMessage && (
        <p className="notice" role="status">
          {discoveryMessage}
        </p>
      )}
      <section className="panel">
        <div className="toolbar">
          <Choice
            label="Data source"
            value={sourceView}
            onChange={setSourceView}
            options={[
              { value: "real", label: "Real businesses only" },
              { value: "all", label: "Include sample records" },
            ]}
          />
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search leads"
              placeholder="Search saved leads, e.g. mental wellness…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Choice
            label="Filter campaign"
            value={campaignFilter}
            onChange={setCampaignFilter}
            options={[
              { value: "all", label: "All campaigns" },
              ...state.campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="toolbar filters">
          <Choice
            label="Lead stage"
            value={stage}
            onChange={setStage}
            options={["All stages", ...stages]}
          />
          <Choice
            label="Industry"
            value={industry}
            onChange={setIndustry}
            options={[
              "All industries",
              ...new Set(state.leads.map((l) => l.industry)),
            ]}
          />
          <input
            className="input"
            aria-label="Filter location"
            placeholder="Location…"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Choice
            label="Minimum fit score"
            value={score}
            onChange={setScore}
            options={[
              "Any score",
              { value: "80", label: "Fit: 80+" },
              { value: "60", label: "Fit: 60+" },
            ]}
          />
          <Choice
            label="Contact availability"
            value={contact}
            onChange={setContact}
            options={["Any contact", "Has email", "Has phone", "No contact"]}
          />
          <button
            className="text-button"
            onClick={() => {
              setQ("");
              setStage("All stages");
              setIndustry("All industries");
              setLocation("");
              setScore("Any score");
              setContact("Any contact");
              setCampaignFilter("all");
              setSelection([]);
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="section-title">
          <p className="muted">
            {filtered.length} leads · {filtered.filter((l) => l.demo).length}{" "}
            demo records
          </p>
          {visibleSelection.length > 0 && (
            <div className="button-row">
              <span className="muted">{visibleSelection.length} selected</span>
              <Choice
                label="Change selected lead stages"
                value="none"
                disabled={busy}
                onChange={bulk}
                options={[
                  { value: "none", label: "Move selected to…" },
                  ...stages,
                ]}
              />
              <button className="text-button" onClick={() => setSelection([])}>
                Clear selection
              </button>
            </div>
          )}
        </div>
        {filtered.length === 0 ? (
          <Blank
            title="Your next connection is waiting."
            description={
              state.leads.length
                ? "No saved leads match. Choose a campaign and use Search directory to find new businesses."
                : "Select a campaign and click Find real businesses, or import your own CSV."
            }
          />
        ) : view === "table" ? (
          <Table className="data-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label="Select all filtered leads"
                    checked={
                      filtered.every((l) => selection.includes(l.id))
                        ? true
                        : visibleSelection.length
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) =>
                      setSelection(v ? filtered.map((l) => l.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Fit</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead>Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={"Select " + l.name}
                      checked={selection.includes(l.id)}
                      onCheckedChange={(v) =>
                        setSelection(
                          v
                            ? [...selection, l.id]
                            : selection.filter((id) => id !== l.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      className="lead-link"
                      onClick={() => setDetail({ ...l })}
                    >
                      <b>{l.name}</b>
                      <small>{l.industry}</small>
                    </button>
                    <span className={"mini-label " + (l.demo ? "" : "neutral")}>
                      {l.demo
                        ? "Demo"
                        : l.sourceLabel.startsWith("Business website")
                          ? "Business website"
                          : l.sourceLabel.startsWith("OpenStreetMap")
                            ? "Public directory"
                            : "Imported · unverified"}
                    </span>
                  </TableCell>
                  <TableCell>{l.location || "Not provided"}</TableCell>
                  <TableCell>
                    <span className="score">{l.score || "—"}</span>
                  </TableCell>
                  <TableCell>
                    <Choice
                      label={"Stage for " + l.name}
                      disabled={busy}
                      value={l.stage}
                      options={[...stages]}
                      onChange={(v) =>
                        save(
                          {
                            ...state,
                            leads: state.leads.map((x) =>
                              x.id === l.id
                                ? updateStage(x, v as Lead["stage"])
                                : x,
                            ),
                          },
                          "Stage updated",
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {l.followUp ? formatDate(l.followUp) : "—"}
                  </TableCell>
                  <TableCell>
                    {l.demo
                      ? "Sample only"
                      : l.email || l.phone || "Not published"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="pipeline">
            {stages.map((s) => (
              <section className="pipeline-column" key={s}>
                <h3>
                  {s}{" "}
                  <span>{filtered.filter((l) => l.stage === s).length}</span>
                </h3>
                {filtered
                  .filter((l) => l.stage === s)
                  .map((l) => (
                    <button
                      className="pipeline-card"
                      key={l.id}
                      onClick={() => setDetail({ ...l })}
                    >
                      <strong>{l.name}</strong>
                      <small>{l.industry}</small>
                      <span>{l.location}</span>
                      <div>
                        <span className="score">
                          {l.score ? `${l.score} fit` : "Not scored"}
                        </span>
                        {l.demo && <span className="mini-label">Demo</span>}
                      </div>
                    </button>
                  ))}
              </section>
            ))}
          </div>
        )}
      </section>
      <p className="muted mt-4">
        Public directory data ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap contributors
        </a>{" "}
        · ODbL. Business website records retain their original source links.
      </p>
      <Sheet
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        <SheetContent className="detail-sheet sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detail?.name}</SheetTitle>
            <SheetDescription>
              Lead context, fit and next steps.
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="detail-body">
              <div className="button-row">
                <span className="demo-tag">
                  {detail.demo
                    ? "Fictional sample lead"
                    : detail.sourceLabel.startsWith("Business website")
                      ? "Business website source"
                      : detail.sourceLabel.startsWith("OpenStreetMap")
                        ? "Public directory source"
                        : "Imported · unverified"}
                </span>
                <span className="score">
                  {detail.score ? `${detail.score}/100 fit` : "Not scored"}
                </span>
              </div>
              <div className="details-grid">
                <span>
                  Industry<strong>{detail.industry}</strong>
                </span>
                <span>
                  Location<strong>{detail.location || "Unknown"}</strong>
                </span>
                <span>
                  Campaign
                  <strong>
                    {
                      state.campaigns.find((c) => c.id === detail.campaignId)
                        ?.name
                    }
                  </strong>
                </span>
                <span>
                  Discovered<strong>{formatDate(detail.discoveredAt)}</strong>
                </span>
              </div>
              <div className="contact-list">
                {detail.website &&
                  (detail.demo ? (
                    <p>{detail.website} · sample address</p>
                  ) : (
                    safeUrl(detail.website) && (
                      <a
                        href={safeUrl(detail.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Visit website <ExternalLink size={14} />
                      </a>
                    )
                  ))}
                <p>
                  Email: {detail.email || "Not available"}
                  {detail.demo && detail.email ? " · sample only" : ""}
                </p>
                <p>Phone: {detail.phone || "Not available"}</p>
                <p>Source: {detail.sourceLabel}</p>
                {safeUrl(detail.source) && (
                  <a
                    href={safeUrl(detail.source)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review source <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <section className="fit-panel">
                <h3>Why this lead could fit</h3>
                <p>{detail.reason}</p>
                <p>
                  <b>Missing information:</b> {detail.missing}
                </p>
                <small>
                  Fit is a relevance assessment, not a probability of
                  conversion.
                </small>
                {!detail.demo && (
                  <button
                    className="secondary mt-3"
                    onClick={() => {
                      const campaign = state.campaigns.find(
                        (c) => c.id === detail.campaignId,
                      );
                      if (campaign)
                        setDetail({
                          ...detail,
                          ...assessFit(detail, campaign),
                        });
                    }}
                  >
                    Assess fit from provided details
                  </button>
                )}
              </section>
              <div className="form-grid">
                <Field label="Pipeline stage">
                  <Choice
                    label="Lead pipeline stage"
                    value={detail.stage}
                    onChange={(v) =>
                      setDetail(updateStage(detail, v as Lead["stage"]))
                    }
                    options={[...stages]}
                  />
                </Field>
                <Field label="Follow-up reminder">
                  <input
                    className="input"
                    type="date"
                    value={detail.followUp}
                    onChange={(e) =>
                      setDetail({ ...detail, followUp: e.target.value })
                    }
                  />
                </Field>
                <Field label="Campaign assignment">
                  <Choice
                    label="Lead campaign assignment"
                    value={detail.campaignId}
                    onChange={(v) => setDetail({ ...detail, campaignId: v })}
                    options={state.campaigns.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                </Field>
                <Field label="Tags">
                  <input
                    className="input"
                    maxLength={300}
                    value={detail.tags}
                    onChange={(e) =>
                      setDetail({ ...detail, tags: e.target.value })
                    }
                    placeholder="e.g. priority, local"
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="input"
                  rows={4}
                  maxLength={8000}
                  value={detail.notes}
                  onChange={(e) =>
                    setDetail({ ...detail, notes: e.target.value })
                  }
                  placeholder="Needs, conversation notes, next steps…"
                />
              </Field>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    const updated = {
                      ...detail,
                      history: [
                        ...detail.history,
                        { at: now(), event: "Lead details saved" },
                      ].slice(-500),
                    };
                    if (
                      await save(
                        {
                          ...state,
                          leads: state.leads.map((l) =>
                            l.id === detail.id ? updated : l,
                          ),
                        },
                        "Lead saved",
                      )
                    )
                      setDetail(null);
                  }}
                >
                  {busy ? "Saving…" : "Save lead"}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await save(
                        {
                          ...state,
                          leads: state.leads.map((l) =>
                            l.id === detail.id ? detail : l,
                          ),
                        },
                        "Lead saved",
                      )
                    ) {
                      outreach(detail);
                      setDetail(null);
                    }
                  }}
                >
                  Draft outreach <ArrowRight size={16} />
                </button>
              </div>
              <h3>Activity history</h3>
              <ul className="activity">
                {detail.history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <li key={i}>
                      <small>{formatDate(h.at)}</small>
                      <p>{h.event}</p>
                    </li>
                  ))}
                {state.drafts
                  .filter((d) => d.leadId === detail.id)
                  .map((d) => (
                    <li key={d.id}>
                      <small>{formatDate(d.createdAt)}</small>
                      <p>
                        {d.channel} draft saved: {d.subject}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bring your leads into one place</DialogTitle>
            <DialogDescription>
              Import up to 500 rows. Duplicates are skipped by website or
              business name and location.
            </DialogDescription>
          </DialogHeader>
          <Field label="Assign to campaign">
            <Choice
              label="Import target campaign"
              value={target}
              onChange={setTarget}
              options={
                state.campaigns.length
                  ? state.campaigns.map((c) => ({ value: c.id, label: c.name }))
                  : [{ value: "none", label: "Create a campaign first" }]
              }
            />
          </Field>
          <p className="muted">
            Required column: name. Optional: industry, location, website, email,
            phone, source, tags, demo. Include full website URLs. Imported
            records start as New and unscored.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={reading}
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />{" "}
              {reading ? "Reading file…" : "Choose CSV file"}
            </button>
            <button
              className="text-button"
              onClick={() =>
                download(
                  "leadgen-import-template.csv",
                  "name,industry,location,website,email,phone,source,tags,demo\r\n",
                  "text/csv",
                )
              }
            >
              Download blank template
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 1000000) {
                toast.error("Choose a CSV smaller than 1 MB.");
                return;
              }
              setReading(true);
              try {
                setCSV(await f.text());
              } catch {
                toast.error("Could not read that file.");
              } finally {
                setReading(false);
                e.target.value = "";
              }
            }}
          />
          <Field label="CSV contents">
            <textarea
              className="input"
              rows={7}
              value={csv}
              onChange={(e) => setCSV(e.target.value)}
              placeholder="name,industry,location,website,email,phone,source,tags,demo"
            />
          </Field>
          <button
            className="primary"
            disabled={busy || reading || !csv.trim() || target === "none"}
            onClick={importCSV}
          >
            {busy ? "Importing…" : "Import leads"}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
