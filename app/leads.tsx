"use client";
import { useState, useRef, type ReactNode } from "react";
import { anyProjectFilter, matchesProjectFilter, outreachLabels, type ProjectFilter } from "@/lib/lead-filters";
import { tierLabel } from "@/lib/allocation";
import { tiers as projectTiers } from "@/lib/project-schema";
import {
  Search,
  Download,
  Upload,
  ArrowRight,
  ExternalLink,
  FileSpreadsheet,
  UserPlus,
  BadgeCheck,
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
  safeUrl,
  toCSV,
  parseCSV,
  deduplicate,
  type Workspace,
  type Lead,
  type Campaign,
  type Market,
} from "@/lib/leadgen";
import type { Progress } from "@/lib/discovery-run";
import { DiscoveryPanel } from "./discovery-panel";
import {
  creatorCSV,
  creatorFromRecord,
  creatorImportColumns,
  creatorRows,
  displayHandle,
  exportWidths,
  followerBand,
  followerBands,
  formatFollowers,
  isGloss,
  scoreLead,
  stageLabel,
} from "@/lib/gloss";
import { xlsx, xlsxType } from "@/lib/xlsx";
import { Choice, Field, Blank, download, formatDate } from "./ui";
import {
  AddCreatorDialog,
  CreatorAvatar,
  CreatorFields,
  OpenSearch,
  ProfileButton,
  ProfileLinks,
  creatorFormFromLead,
  creatorFromForm,
  verifyCreator,
  type CreatorForm,
} from "./creators";
type Props = {
  state: Workspace;
  save: (s: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  campaignFilter: string;
  setCampaignFilter: (s: string) => void;
  outreach: (l: Lead) => void;
  discover: (c: Campaign, options?: { markets?: Market[] }) => Promise<boolean>;
  discovering: { campaignId: string; progress?: Progress } | null;
  // Custom lead projects: outreach status in table rows and outcome tracking in lead details.
  projectRow?: (lead: Lead) => ReactNode;
  projectPanel?: (lead: Lead) => ReactNode;
};
const PAGE_SIZE = 100;
const PIPELINE_CARDS = 60;
export function Leads({
  state,
  save,
  busy,
  campaignFilter,
  setCampaignFilter,
  outreach,
  discover,
  discovering: discoveryState,
  projectRow,
  projectPanel,
}: Props) {
  const [kind, setKind] = useState<Lead["kind"]>(
    state.campaigns.find((c) => c.id === campaignFilter)?.audience ===
      "Creator Partners"
      ? "creator"
      : "business",
  );
  const [platform, setPlatform] = useState("Any platform");
  const [band, setBand] = useState("Any followers");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<CreatorForm | null>(null);
  const creators = kind === "creator";
  const discovering = !!discoveryState;
  const [sourceView, setSourceView] = useState("real");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("All stages");
  const [industry, setIndustry] = useState("All industries");
  const [location, setLocation] = useState("");
  const [score, setScore] = useState("Any score");
  const [contact, setContact] = useState("Any contact");
  // Custom lead project filters; shown only when such leads exist.
  const [pf, setPf] = useState<ProjectFilter>(anyProjectFilter);
  const projectCampaigns = state.campaigns.filter((c) => c.custom);
  const hasProjectLeads = projectCampaigns.length > 0 && state.leads.some((l) => l.project);
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
      l.kind === kind &&
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
            : contact === "Has Instagram"
              ? !!l.creator?.instagram
              : !l.email && !l.phone && !l.creator?.instagram)) &&
      (!creators ||
        ((platform === "Any platform" || l.creator?.platform === platform) &&
          (band === "Any followers" ||
            followerBand(l.creator?.followers) === band))) &&
      matchesProjectFilter(l, pf) &&
      (matchesLeadSearch(l, q) ||
        (!!l.creator?.instagram &&
          displayHandle(l.creator.instagram).includes(
            q.trim().toLowerCase(),
          ))),
  );
  const glossCampaigns = state.campaigns.filter(
    (c) => isGloss(c) && !c.demo && c.status !== "Archived",
  );
  const searchCampaign =
    glossCampaigns.find((c) => c.id === campaignFilter) || glossCampaigns[0];
  const campaignFor = (l: Lead) =>
    state.campaigns.find((c) => c.id === l.campaignId);
  function openDetail(l: Lead) {
    setDetail({ ...l });
    setForm(l.kind === "creator" ? creatorFormFromLead(l) : null);
  }
  // Large campaigns are paged so the table stays fast.
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageLeads = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const visibleSelection = selection.filter((id) =>
    filtered.some((l) => l.id === id),
  );
  const selectedCampaign = state.campaigns.find((c) => c.id === campaignFilter);
  async function runDiscovery() {
    const active = state.campaigns.filter((c) => c.status === "Active" && !c.demo);
    const c =
      active.find((c) => c.id === campaignFilter) ||
      (wellnessTerms.test(q)
        ? active.find((c) => wellnessTerms.test(c.name + " " + c.description))
        : active.length === 1
          ? active[0]
          : undefined);
    if (!c) {
      toast.error("Select the campaign you want to run discovery for.");
      return;
    }
    // A search term narrows a general campaign's directory search.
    const markets =
      q.trim() && !isGloss(c)
        ? [{ name: q.trim(), reason: "User search", needs: "", positioning: "", search: q.trim(), score: 0 }]
        : undefined;
    setCampaignFilter(c.id);
    if (await discover(c, { markets })) {
      setQ("");
      setStage("All stages");
      setIndustry("All industries");
      setScore("Any score");
      setContact("Any contact");
      setLocation("");
      setSelection([]);
      setSourceView("real");
      if (c.audience === "Creator Partners") setKind("creator");
    }
  }
  /** Applies the creator profile form, if any, and validates the result. */
  function buildDetail(): Lead | null {
    if (!detail) return null;
    if (detail.kind !== "creator" || !form) return detail;
    try {
      const campaign = campaignFor(detail);
      if (!campaign) throw new Error("Choose a campaign for this creator.");
      return creatorFromForm(
        { ...form, notes: detail.notes, tags: detail.tags },
        campaign,
        detail,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the profile details.");
      return null;
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
      const targetCampaign = state.campaigns.find((c) => c.id === target);
      if (!targetCampaign) throw new Error("Select a campaign first.");
      if (creators && !isGloss(targetCampaign))
        throw new Error("Choose a Gloss creator or professional campaign.");
      if (!creators && targetCampaign.audience === "Creator Partners")
        throw new Error(
          "Creator partner campaigns only accept creators. Switch to Creators to import them.",
        );
      const incoming = records.map((r, i): Lead => {
        if (creators) return creatorFromRecord(r, targetCampaign, i + 2);
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
          kind: "business",
          checkedAt: "",
          sourceVerifiedAt: "",
          scope: "",
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
            {creators
              ? "Qualify Gloss creators and professionals from public profiles you have checked."
              : "Qualify businesses, manage your pipeline and plan your next conversation."}
          </p>
        </div>
        {creators ? (
          <div className="button-row">
            <button
              className="secondary"
              disabled={!filtered.length}
              onClick={() =>
                download(
                  "gloss-creators.xlsx",
                  xlsx("Gloss creators", creatorRows(filtered), exportWidths),
                  xlsxType,
                )
              }
            >
              <FileSpreadsheet size={16} /> Export Excel
            </button>
            <button
              className="secondary"
              disabled={!filtered.length}
              onClick={() =>
                download(
                  "gloss-creators.csv",
                  "\uFEFF" + creatorCSV(filtered),
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={16} /> Export CSV
            </button>
            <button
              className="secondary"
              disabled={!glossCampaigns.length}
              onClick={() => {
                setTarget(searchCampaign?.id || "none");
                setImportOpen(true);
              }}
            >
              <Upload size={16} /> Import creators
            </button>
            <button
              className="primary"
              disabled={!glossCampaigns.length || busy}
              onClick={() => setAddOpen(true)}
            >
              <UserPlus size={16} /> Add creator
            </button>
          </div>
        ) : (
        <div className="button-row">
          <button
            className="secondary"
            disabled={!filtered.length}
            onClick={() =>
              download(
                "leadgen-leads.xlsx",
                xlsx("Leads", creatorRows(filtered), exportWidths),
                xlsxType,
              )
            }
          >
            <FileSpreadsheet size={16} /> Export Excel
          </button>
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
            onClick={runDiscovery}
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
        )}
      </div>
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as Lead["kind"]);
          setSelection([]);
          setIndustry("All industries");
          setContact("Any contact");
        }}
      >
        <TabsList aria-label="Lead type" className="kind-switch">
          <TabsTrigger value="business">Businesses</TabsTrigger>
          <TabsTrigger value="creator">Creators</TabsTrigger>
        </TabsList>
      </Tabs>
      {creators ? (
        <>
          <p className="notice">
            Run discovery finds creators with public identifiers on Wikidata
            and, when configured, YouTube. Instagram, TikTok, LinkedIn and
            Facebook are never scraped; use Open Search and Add creator for
            profiles you check yourself. Outreach is drafted here and sent by
            you.
          </p>
          {glossCampaigns.length === 0 ? (
            <p className="notice">
              Create a Gloss creator or professional campaign from the
              Dashboard to start adding creators.
            </p>
          ) : (
            searchCampaign && (
              <OpenSearch key={searchCampaign.id} campaign={searchCampaign} />
            )
          )}
        </>
      ) : (
      <p className="notice">
        Real businesses with source links. Public directory results may have
        missing or outdated contacts; buying intent is not verified. Sample
        leads are hidden by default.
      </p>
      )}
      {selectedCampaign && !selectedCampaign.demo ? (
        <DiscoveryPanel
          campaign={selectedCampaign}
          running={discoveryState?.campaignId === selectedCampaign.id}
          progress={discoveryState?.progress}
          busy={busy || (discovering && discoveryState?.campaignId !== selectedCampaign.id)}
          onRun={runDiscovery}
        />
      ) : (
        <p className="notice">
          Choose a campaign in the campaign filter below to run discovery and
          see its source report.
        </p>
      )}
      <section className="panel">
        <div className="toolbar">
          <Choice
            label="Data source"
            value={sourceView}
            onChange={setSourceView}
            options={[
              {
                value: "real",
                label: creators ? "Real records only" : "Real businesses only",
              },
              { value: "all", label: "Include sample records" },
            ]}
          />
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search leads"
              placeholder={
                creators
                  ? "Search name, profession or @handle…"
                  : "Search saved leads, e.g. mental wellness…"
              }
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
            label={creators ? "Profession" : "Industry"}
            value={industry}
            onChange={setIndustry}
            options={[
              {
                value: "All industries",
                label: creators ? "All professions" : "All industries",
              },
              ...new Set(
                state.leads.filter((l) => l.kind === kind).map((l) => l.industry),
              ),
            ]}
          />
          {creators && (
            <>
              <Choice
                label="Platform"
                value={platform}
                onChange={setPlatform}
                options={[
                  "Any platform",
                  "Instagram",
                  "YouTube",
                  "TikTok",
                  "LinkedIn",
                  "Facebook",
                  "Website",
                ]}
              />
              <Choice
                label="Followers"
                value={band}
                onChange={setBand}
                options={["Any followers", ...followerBands]}
              />
            </>
          )}
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
            options={
              creators
                ? ["Any contact", "Has Instagram", "Has email", "Has phone", "No contact"]
                : ["Any contact", "Has email", "Has phone", "No contact"]
            }
          />
          {hasProjectLeads && !creators && (
            <>
              <Choice
                label="Tier"
                value={pf.tier || "any"}
                onChange={(v) => setPf({ ...pf, tier: v === "any" ? "" : v })}
                options={[{ value: "any", label: "Any tier" }, ...projectTiers.map((t) => ({ value: t, label: tierLabel(t, "India") }))]}
              />
              <Choice
                label="Segment"
                value={pf.segment || "any"}
                onChange={(v) => setPf({ ...pf, segment: v === "any" ? "" : v })}
                options={[
                  { value: "any", label: "Any segment" },
                  ...projectCampaigns
                    .filter((c) => campaignFilter === "all" || c.id === campaignFilter)
                    .flatMap((c) => c.custom!.segments.map((s) => ({ value: s.id, label: projectCampaigns.length > 1 ? `${s.label} (${c.name})` : s.label }))),
                ]}
              />
              <Choice
                label="Delivery status"
                value={pf.delivery || "any"}
                onChange={(v) => setPf({ ...pf, delivery: v === "any" ? "" : (v as ProjectFilter["delivery"]) })}
                options={[{ value: "any", label: "Available or given" }, { value: "available", label: "Available" }, { value: "given", label: "Given" }]}
              />
              <Choice
                label="Outreach status"
                value={pf.outreach || "any"}
                onChange={(v) => setPf({ ...pf, outreach: v === "any" ? "" : v })}
                options={[{ value: "any", label: "Any outreach" }, ...Object.entries(outreachLabels).map(([value, label]) => ({ value, label }))]}
              />
              <Choice
                label="Batch"
                value={pf.batch || "any"}
                onChange={(v) => setPf({ ...pf, batch: v === "any" ? "" : v })}
                options={[
                  { value: "any", label: "Any batch" },
                  ...[...new Map(state.leads.filter((l) => l.project?.delivery.id && (campaignFilter === "all" || l.campaignId === campaignFilter)).map((l) => [l.project!.delivery.id, l])).values()]
                    .sort((a, b) => a.project!.delivery.batch - b.project!.delivery.batch)
                    .map((l) => ({ value: l.project!.delivery.id, label: `Batch ${l.project!.delivery.batch}${projectCampaigns.length > 1 ? ` · ${projectCampaigns.find((c) => c.id === l.campaignId)?.name}` : ""}` })),
                ]}
              />
            </>
          )}
          <button
            className="text-button"
            onClick={() => {
              setPf(anyProjectFilter());
              setQ("");
              setStage("All stages");
              setIndustry("All industries");
              setLocation("");
              setScore("Any score");
              setContact("Any contact");
              setPlatform("Any platform");
              setBand("Any followers");
              setCampaignFilter("all");
              setSelection([]);
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="section-title">
          <p className="muted">
            {creators
              ? `${filtered.length} creator${filtered.length === 1 ? "" : "s"}`
              : `${filtered.length} leads · ${filtered.filter((l) => l.demo).length} demo records`}
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
                  ...stages.map((s) => ({
                    value: s,
                    label:
                      creators && s === "Converted" ? "Partnered / Signed up" : s,
                  })),
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
              creators
                ? "No creators match. Use Open Search to find public profiles, then Add creator or import a CSV."
                : state.leads.length
                  ? "No saved leads match. Choose a campaign and use Search directory to find new businesses."
                  : "Select a campaign and click Find real businesses, or import your own CSV."
            }
          />
        ) : view === "table" && creators ? (
          <Table className="data-table creator-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label="Select all filtered creators"
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
                <TableHead>Creator</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Fit</TableHead>
                <TableHead>Outreach status</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead>Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageLeads.map((l) => (
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
                      className="lead-link creator-cell"
                      onClick={() => openDetail(l)}
                    >
                      <CreatorAvatar lead={l} />
                      <span>
                        <b>{l.name}</b>
                        <small>{l.creator?.profession || l.industry}</small>
                      </span>
                    </button>
                    <span className="mini-label neutral">
                      {l.creator?.partnership}
                      {l.creator?.verifiedAt ? " · verified" : ""}
                    </span>
                  </TableCell>
                  <TableCell>{l.location || "Not provided"}</TableCell>
                  <TableCell>
                    {l.creator?.platform}
                    {l.creator?.instagram && (
                      <small className="handle">
                        {displayHandle(l.creator.instagram)}
                      </small>
                    )}
                  </TableCell>
                  <TableCell>{formatFollowers(l.creator?.followers)}</TableCell>
                  <TableCell>
                    <span className="score">{l.score || "—"}</span>
                  </TableCell>
                  <TableCell>
                    <Choice
                      label={"Outreach status for " + l.name}
                      disabled={busy}
                      value={l.stage}
                      options={stages.map((s) => ({
                        value: s,
                        label: stageLabel(l, s),
                      }))}
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
                          "Status updated",
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {l.followUp ? formatDate(l.followUp) : "—"}
                  </TableCell>
                  <TableCell>
                    <ProfileButton lead={l} compact />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              {pageLeads.map((l) => (
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
                      onClick={() => openDetail(l)}
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
                    {l.project && projectRow ? (
                      projectRow(l)
                    ) : (
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
                    )}
                  </TableCell>
                  <TableCell>
                    {l.followUp ? formatDate(l.followUp) : "—"}
                  </TableCell>
                  <TableCell>
                    {l.demo
                      ? "Sample only"
                      : l.email ||
                        l.phone ||
                        displayHandle(l.creator?.instagram || "") ||
                        "Not published"}
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
                  {creators && s === "Converted" ? "Partnered / Signed up" : s}{" "}
                  <span>{filtered.filter((l) => l.stage === s).length}</span>
                </h3>
                {filtered
                  .filter((l) => l.stage === s)
                  .slice(0, PIPELINE_CARDS)
                  .map((l) => (
                    <button
                      className="pipeline-card"
                      key={l.id}
                      onClick={() => openDetail(l)}
                    >
                      <strong>{l.name}</strong>
                      <small>{l.industry}</small>
                      <span>{l.location}</span>
                      {l.creator?.instagram && (
                        <span>
                          {displayHandle(l.creator.instagram)} ·{" "}
                          {formatFollowers(l.creator.followers)}
                        </span>
                      )}
                      <div>
                        <span className="score">
                          {l.score ? `${l.score} fit` : "Not scored"}
                        </span>
                        {l.demo && <span className="mini-label">Demo</span>}
                      </div>
                    </button>
                  ))}
                {filtered.filter((l) => l.stage === s).length > PIPELINE_CARDS && (
                  <p className="muted pipeline-more">
                    +{filtered.filter((l) => l.stage === s).length - PIPELINE_CARDS}{" "}
                    more. Use filters or the table to see them.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
        {view === "table" && pages > 1 && (
          <nav className="button-row pager" aria-label="Lead pages">
            <button className="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <span className="muted">
              Showing {current * PAGE_SIZE + 1}–{Math.min(filtered.length, (current + 1) * PAGE_SIZE)} of{" "}
              {filtered.length}
            </span>
            <button className="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </nav>
        )}
      </section>
      {!creators && (
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
      )}
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
              {detail.project && projectPanel?.(detail)}
              {detail.kind === "creator" && detail.creator && (
                <>
                  <section className="creator-hero">
                    <CreatorAvatar lead={detail} />
                    <span>
                      <b>{detail.creator.profession || "Creator"}</b>
                      <small>
                        {[
                          displayHandle(detail.creator.instagram),
                          `${formatFollowers(detail.creator.followers)} followers`,
                          detail.creator.engagement &&
                            `${detail.creator.engagement} engagement`,
                          detail.creator.partnership,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <ProfileButton lead={detail} />
                  </section>
                  <ProfileLinks lead={detail} />
                </>
              )}
              <div className="button-row">
                <span className="demo-tag">
                  {detail.kind === "creator"
                    ? detail.creator?.verifiedAt
                      ? `Profile verified ${formatDate(detail.creator.verifiedAt)}`
                      : "Public profile · not yet verified"
                    : detail.demo
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
                  {detail.kind === "creator" ? "Profession" : "Industry"}
                  <strong>{detail.industry}</strong>
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
                  <div className="button-row mt-3">
                    <button
                      className="secondary"
                      onClick={() => {
                        const campaign = campaignFor(detail);
                        if (campaign)
                          setDetail({
                            ...detail,
                            ...scoreLead(detail, campaign),
                          });
                      }}
                    >
                      Assess fit from provided details
                    </button>
                    {detail.kind === "creator" && (
                      <button
                        className="secondary"
                        onClick={() => {
                          const campaign = campaignFor(detail);
                          const verified = verifyCreator(detail);
                          setDetail(
                            campaign
                              ? { ...verified, ...scoreLead(verified, campaign) }
                              : verified,
                          );
                        }}
                      >
                        <BadgeCheck size={16} /> I checked this public profile
                        today
                      </button>
                    )}
                  </div>
                )}
              </section>
              {detail.kind === "creator" && form && (
                <details className="creator-edit">
                  <summary>Edit profile details</summary>
                  <CreatorFields
                    value={form}
                    onChange={setForm}
                    campaign={campaignFor(detail)}
                    compact
                  />
                </details>
              )}
              <div className="form-grid">
                <Field label="Pipeline stage">
                  <Choice
                    label="Lead pipeline stage"
                    value={detail.stage}
                    onChange={(v) =>
                      setDetail(updateStage(detail, v as Lead["stage"]))
                    }
                    options={stages.map((s) => ({
                      value: s,
                      label: stageLabel(detail, s),
                    }))}
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
                    options={state.campaigns
                      .filter((c) =>
                        detail.kind === "creator"
                          ? isGloss(c)
                          : c.audience !== "Creator Partners",
                      )
                      .map((c) => ({
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
                    const built = buildDetail();
                    if (!built) return;
                    const updated = {
                      ...built,
                      history: [
                        ...built.history,
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
                    const built = buildDetail();
                    if (!built) return;
                    if (
                      await save(
                        {
                          ...state,
                          leads: state.leads.map((l) =>
                            l.id === built.id ? built : l,
                          ),
                        },
                        "Lead saved",
                      )
                    ) {
                      outreach(built);
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
            <DialogTitle>
              {creators
                ? "Import creators from public profiles"
                : "Bring your leads into one place"}
            </DialogTitle>
            <DialogDescription>
              {creators
                ? "Import any number of rows. Duplicates are skipped by Instagram handle or profile URL. Every row needs at least one public profile link or handle."
                : "Import any number of rows. Duplicates are skipped by website or business name and location."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Assign to campaign">
            <Choice
              label="Import target campaign"
              value={target}
              onChange={setTarget}
              options={
                (creators ? glossCampaigns : state.campaigns).length
                  ? (creators ? glossCampaigns : state.campaigns).map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))
                  : [{ value: "none", label: "Create a campaign first" }]
              }
            />
          </Field>
          {creators ? (
            <p className="muted">
              Required: name and an Instagram handle or a public profile URL.
              Optional: profession, location, platform, TikTok, YouTube,
              LinkedIn and Facebook URLs, website, email, phone, followers,
              engagement, partnership type, source URL, photo URL, tags, notes.
              Gloss Excel exports can be re-imported. Imported creators start
              as New with a rule-based fit score.
            </p>
          ) : (
          <p className="muted">
            Required column: name. Optional: industry, location, website, email,
            phone, source, tags, demo. Include full website URLs. Imported
            records start as New and unscored.
          </p>
          )}
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
                creators
                  ? download(
                      "gloss-creator-import-template.csv",
                      creatorImportColumns + "\r\n",
                      "text/csv",
                    )
                  : download(
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
              if (f.size > 50_000_000) {
                toast.error("Choose a CSV smaller than 50 MB.");
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
              placeholder={
                creators
                  ? creatorImportColumns
                  : "name,industry,location,website,email,phone,source,tags,demo"
              }
            />
          </Field>
          <button
            className="primary"
            disabled={busy || reading || !csv.trim() || target === "none"}
            onClick={importCSV}
          >
            {busy ? "Importing…" : creators ? "Import creators" : "Import leads"}
          </button>
        </DialogContent>
      </Dialog>
      {addOpen && (
        <AddCreatorDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          state={state}
          save={save}
          busy={busy}
          initialCampaign={campaignFilter}
          onAdded={(id) => {
            setCampaignFilter(id);
            setSourceView("real");
          }}
        />
      )}
    </>
  );
}
