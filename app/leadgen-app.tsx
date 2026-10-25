"use client";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "sonner";
import {
  Sparkles,
  LayoutDashboard,
  ScanSearch,
  Megaphone,
  FolderSearch,
  Users,
  Send,
  Inbox as InboxIcon,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  RefreshCw,
} from "lucide-react";
import {
  emptyWorkspace,
  newCampaign,
  metrics,
  now,
  discoverySchema,
  type Workspace,
  type Campaign,
  type Market,
  type DiscoveryReport,
  type Lead,
} from "@/lib/leadgen";
import { mergeDiscovered } from "@/lib/discovery-engine";
import { isGloss } from "@/lib/gloss";
import { runDiscovery, type Progress } from "@/lib/discovery-run";
import { campaignExcelUrl } from "./ui";
import { Dashboard } from "./dashboard";
import { FollowUps } from "./follow-ups";
import { Campaigns, CampaignDetails, MarketBuilder } from "./campaigns";
import { Leads } from "./leads";
import { Outreach } from "./outreach";
import { Analytics, Settings } from "./insights";
import { Projects } from "./projects";
import { ProjectOutreach } from "./project-outreach";
import { ProjectOutcomes } from "./project-outcomes";
// The map (Leaflet) loads only when a project's Map tab is opened.
const ProjectMap = lazy(() => import("./project-map"));
import { LeadOutcomePanel, ReplyDialog, StatusSelect } from "./lead-outcome";
import type { SentInfo } from "./lead-actions";
import { logReply, markSent, noResponseSuggestions, setStatus } from "@/lib/outcomes";
import { doNotContactEntries } from "@/lib/suppression";
import { localDate } from "@/lib/leadgen";
import { contactChecks, recheckStale } from "@/lib/project-checks";
import { batchDrafts } from "@/lib/templates";
import type { Project } from "./project-details";
import { availability, topUp, type Progress as ProjectProgress } from "@/lib/project-run";
import { applyDelivery, isCustom, planDelivery } from "@/lib/ledger";
import { mergeProjectLeads } from "@/lib/dedupe";
import { suppressionIndex } from "@/lib/suppression";
import { segmentSources } from "@/lib/categories";
import { sourcesCall, sourcesHealth, type Health } from "@/lib/project-sources";
import type { ContactEvent, Delivery, DeliveryState, OutreachStatus, Suppression, ProjectReport, ProjectTemplate, TemplateChannel } from "@/lib/project-schema";
const names = [
  "Dashboard",
  "Find My Market",
  "Campaigns",
  "Lead Projects",
  "Leads",
  "Outreach",
  "Inbox",
  "Analytics",
  "Settings",
];
const nav = [
  LayoutDashboard,
  ScanSearch,
  Megaphone,
  FolderSearch,
  Users,
  Send,
  InboxIcon,
  ChartNoAxesCombined,
  SettingsIcon,
];
function Navigation({ page, go }: { page: string; go: (p: string) => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <>
      {names.map((n, i) => {
        const Icon = nav[i];
        return (
          <button
            key={n}
            className={"nav-item " + (page === n ? "active" : "")}
            aria-current={page === n ? "page" : undefined}
            onClick={() => {
              go(n);
              setOpenMobile(false);
            }}
          >
            <Icon size={19} />
            {n === "Inbox" ? "Follow-ups" : n}
          </button>
        );
      })}
    </>
  );
}
type Snapshot = { state: Workspace; revision: number };
export default function LeadGenApp() {
  const [state, setState] = useState<Workspace>(emptyWorkspace);
  const [page, setPage] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAI] = useState(false);
  const [builder, setBuilder] = useState<Campaign | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [outreachLead, setOutreachLead] = useState("");
  const [discovering, setDiscovering] = useState<{
    campaignId: string;
    progress?: Progress;
  } | null>(null);
  const discoveryLock = useRef(false);
  // Custom lead projects: ledger records, contact events, do-not-contact list
  // and the local sources service status (undefined while checking).
  const [extras, setExtras] = useState<{ deliveries: Delivery[]; events: ContactEvent[]; suppression: Suppression[] }>({ deliveries: [], events: [], suppression: [] });
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [projectView, setProjectView] = useState<string>("list");
  const [projectRun, setProjectRun] = useState<{ campaignId: string; progress?: ProjectProgress } | null>(null);
  const [replyFor, setReplyFor] = useState<Lead | null>(null);
  const autoRefreshed = useRef(false);
  const revision = useRef(0);
  // Leads as last persisted. Updates are immutable, so an unchanged lead keeps
  // its object identity and only changed leads are sent on save.
  const persisted = useRef(new Map<string, Lead>());
  const initialized = useRef(false);
  const lock = useRef(false);
  const liveState = useRef(state);
  liveState.current = state;
  const go = useCallback((p: string) => {
    if (!names.includes(p)) return;
    setPage(p);
    window.location.hash = p.toLowerCase().replaceAll(" ", "-");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const loadExtras = useCallback(async () => {
    try {
      const r = await fetch("/api/projects");
      if (r.ok) setExtras(await r.json());
    } catch {}
  }, []);
  const refreshHealth = useCallback(() => {
    setHealth(undefined);
    void sourcesHealth().then(setHealth);
  }, []);
  const load = useCallback(async () => {
    if (lock.current) return;
    if (!initialized.current) setLoading(true);
    try {
      const response = await fetch("/api/workspace");
      const data = (await response.json()) as Snapshot & { error: string };
      if (!response.ok) throw new Error(data.error);
      const snap = data as Snapshot;
      setState(snap.state);
      revision.current = snap.revision;
      persisted.current = new Map(snap.state.leads.map((l) => [l.id, l]));
      initialized.current = true;
      void loadExtras();
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load your workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [loadExtras]);
  useEffect(() => {
    void load();
    refreshHealth();
    fetch("/api/generate")
      .then((r) => (r.ok ? (r.json() as Promise<{ ai: boolean }>) : null))
      .then((d) => setAI(!!d?.ai))
      .catch(() => {});
    const route = () => {
      const p = names.find(
        (p) => p.toLowerCase().replaceAll(" ", "-") === location.hash.slice(1),
      );
      if (p) setPage(p);
    };
    route();
    addEventListener("hashchange", route);
    return () => removeEventListener("hashchange", route);
  }, [load, refreshHealth]);
  useEffect(() => {
    type ModelContext = {
      registerTool: (
        t: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        o: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context) return;
    const controller = new AbortController();
    const register = (tool: Parameters<ModelContext["registerTool"]>[0]) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "read_leadgen_summary",
      title: "Read LeadGen workspace summary",
      description:
        "Read counts from the loaded workspace. Includes demo records when present.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        metrics: metrics(liveState.current.leads),
        campaigns: liveState.current.campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          demo: c.demo,
        })),
      }),
    });
    register({
      name: "navigate_leadgen_workspace",
      title: "Open a LeadGen workspace view",
      description:
        "Navigate to an existing workspace view. Does not create records or send messages.",
      inputSchema: {
        type: "object",
        properties: { page: { type: "string", enum: names } },
        required: ["page"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        const p = (input as { page?: unknown })?.page;
        if (typeof p !== "string" || !names.includes(p))
          throw new Error("Unknown page");
        go(p);
        return { opened: p };
      },
    });
    return () => controller.abort();
  }, [go]);
  /**
   * Saves the workspace. `extra` carries custom-project contact events and
   * do-not-contact entries, written in the same batch as the lead changes.
   */
  async function save(next: Workspace, message = "Saved", quiet = false, extra: { events?: ContactEvent[]; suppression?: Suppression[] } = {}) {
    if (!initialized.current) {
      toast.error("Load your saved workspace before making changes.");
      return false;
    }
    if (lock.current) {
      toast.info(
        "A save is already in progress. Please try again when it finishes.",
      );
      return false;
    }
    lock.current = true;
    setBusy(true);
    try {
      const upsert = next.leads.filter((l) => persisted.current.get(l.id) !== l);
      const ids = new Set(next.leads.map((l) => l.id));
      const remove = [...persisted.current.keys()].filter((id) => !ids.has(id));
      const r = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: { ...next, leads: [] },
          revision: revision.current,
          leads: {
            upsert,
            remove,
            ...(extra.events?.length ? { events: { insert: extra.events } } : {}),
            ...(extra.suppression?.length ? { suppression: { add: extra.suppression, remove: [] } } : {}),
          },
        }),
      });
      const d = (await r.json()) as { revision: number; error: string };
      if (!r.ok) throw new Error(d.error);
      setState(next);
      // Work started right after a save (e.g. auto-discovery) sees it at once.
      liveState.current = next;
      revision.current = d.revision;
      persisted.current = new Map(next.leads.map((l) => [l.id, l]));
      if (extra.events?.length || extra.suppression?.length)
        setExtras((x) => ({ ...x, events: [...x.events, ...(extra.events ?? [])], suppression: [...x.suppression, ...(extra.suppression ?? [])] }));
      setError("");
      if (!quiet) toast.success(message);
      return true;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Save failed. Please retry.";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function start(
    theme = 5,
    description = "",
    audience: Campaign["audience"] = "General",
  ) {
    const c = newCampaign(theme, description, audience);
    if (!c.name && state.profile.business) c.name = state.profile.business;
    c.website = state.profile.website;
    setBuilder(c);
    setActiveCampaign(null);
    go("Find My Market");
  }
  async function saveCampaign(c: Campaign) {
    const exists = state.campaigns.some((x) => x.id === c.id);
    const next = {
      ...state,
      campaigns: exists
        ? state.campaigns.map((x) => (x.id === c.id ? c : x))
        : [...state.campaigns, c],
    };
    if (await save(next, exists ? "Campaign updated" : "Campaign created")) {
      setBuilder(null);
      // New Gloss campaigns generate their leads straight away.
      if (!exists && isGloss(c)) {
        setCampaignFilter(c.id);
        go("Leads");
        void discover(c);
      } else {
        setActiveCampaign(c);
        go("Campaigns");
      }
      return true;
    }
    return false;
  }
  /**
   * Runs tiered discovery for a campaign, merges new and re-confirmed leads
   * into the latest workspace and stores the per-source report on the campaign.
   */
  async function discover(
    c: Campaign,
    options: { auto?: boolean; markets?: Market[] } = {},
  ) {
    if (discoveryLock.current) {
      toast.info("Discovery is already running. Please wait for it to finish.");
      return false;
    }
    discoveryLock.current = true;
    setDiscovering({ campaignId: c.id });
    const call = async (body: unknown) => {
      const r = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Discovery request failed.");
      return d;
    };
    let reports: DiscoveryReport[];
    let incoming: Awaited<ReturnType<typeof runDiscovery>>["incoming"] = [];
    try {
      const result = await runDiscovery(
        options.markets ? { ...c, markets: options.markets } : c,
        liveState.current,
        call,
        (progress) => setDiscovering({ campaignId: c.id, progress }),
        undefined,
        // Save progress during long runs so a reload keeps what was found.
        async (found, partial) => {
          const latest = liveState.current;
          const merged = mergeDiscovered(latest.leads, found);
          if (!merged.added.length && !merged.refreshed) return;
          await save(
            {
              ...latest,
              leads: merged.leads,
              campaigns: latest.campaigns.map((x) =>
                x.id === c.id
                  ? {
                      ...x,
                      discovery: {
                        ...(x.discovery ?? discoverySchema.parse({})),
                        lastReport: [
                          ...partial,
                          { source: "Discovery", scope: "all", area: "", status: "partial" as const, found: 0, added: 0, refreshed: 0, message: "Run in progress; results so far are saved." },
                        ].slice(0, 80),
                      },
                    }
                  : x,
              ),
            },
            "Progress saved",
            true,
          );
        },
      );
      reports = result.reports;
      incoming = result.incoming;
    } catch (e) {
      reports = [
        {
          source: "Location",
          scope: "all",
          area: c.location,
          status: "failed",
          found: 0,
          added: 0,
          refreshed: 0,
          message: e instanceof Error ? e.message : "Discovery failed.",
        },
      ];
    }
    try {
      const latest = liveState.current;
      const merged = mergeDiscovered(latest.leads, incoming);
      const failed = reports.filter((r) => r.status === "failed").length;
      const ok = await save(
        {
          ...latest,
          leads: merged.leads,
          campaigns: latest.campaigns.map((x) =>
            x.id === c.id
              ? {
                  ...x,
                  discovery: {
                    ...(x.discovery ?? discoverySchema.parse({})),
                    lastRunAt: now(),
                    lastReport: reports.slice(0, 80),
                  },
                }
              : x,
          ),
        },
        `${c.name}: ${merged.added.length} new leads, ${merged.refreshed} re-confirmed` +
          (failed ? `; ${failed} source searches failed (see report)` : ""),
      );
      if (ok) {
        // Offer the campaign's complete workbook as soon as the run is saved.
        toast(`${c.name}: Excel workbook ready`, {
          description: `${merged.leads.filter((l) => l.campaignId === c.id).length} leads with every detail`,
          action: { label: "Download", onClick: () => window.location.assign(campaignExcelUrl(c.id)) },
          duration: 15000,
        });
        if (!options.auto) {
          setActiveCampaign(null);
          setCampaignFilter(c.id);
        }
      }
      return ok;
    } finally {
      discoveryLock.current = false;
      setDiscovering(null);
    }
  }
  // Automatic refresh: campaigns with a refresh interval are re-run once per
  // session when their last run is older than the interval.
  useEffect(() => {
    if (loading || !initialized.current || autoRefreshed.current) return;
    autoRefreshed.current = true;
    const due = liveState.current.campaigns.filter((c) => {
      const days = c.discovery?.autoRefreshDays ?? 0;
      const last = Date.parse(c.discovery?.lastRunAt || "") || 0;
      return (
        c.status === "Active" &&
        !c.demo &&
        days > 0 &&
        Date.now() - last > days * 86400000
      );
    });
    void (async () => {
      for (const c of due) await discover(c, { auto: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  function openCampaign(c: Campaign | null) {
    if (c && isCustom(c)) {
      setActiveCampaign(null);
      setProjectView(c.id);
      go("Lead Projects");
    } else setActiveCampaign(c);
  }
  // ---------- Custom lead projects ----------
  const discoverCall = async (body: unknown) => {
    const r = await fetch("/api/project-discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(d.error || "Discovery request failed.");
    return d;
  };
  const projectDeps = (c: Campaign) => ({
    discover: discoverCall,
    sources: { health: () => sourcesHealth(), call: <T,>(route: string, body: unknown) => sourcesCall<T>(route, body) },
    sourcesFor: segmentSources,
    suppressed: suppressionIndex(extras.suppression),
    onProgress: (progress: ProjectProgress) => setProjectRun({ campaignId: c.id, progress }),
  });
  /** Merges found leads into the latest workspace and stores the run's report and cursors. */
  const withProjectResults = (latest: Workspace, c: Project, incoming: Lead[], reports: ProjectReport[], pool: Project["custom"]["pool"], done: boolean, geo?: Project["custom"]["geo"]) => {
    const others = latest.leads.filter((l) => l.campaignId !== c.id);
    const merged = mergeProjectLeads(latest.leads.filter((l) => l.campaignId === c.id), incoming);
    return {
      merged,
      next: {
        ...latest,
        leads: [...others, ...merged.leads],
        campaigns: latest.campaigns.map((x) =>
          x.id === c.id && x.custom
            ? { ...x, custom: { ...x.custom, pool, geo: geo ?? x.custom.geo, lastReport: reports.slice(0, 400), lastRunAt: done ? now() : x.custom.lastRunAt } }
            : x,
        ),
      },
    };
  };
  async function runProjectDiscovery(c: Project, options: { fetchAll?: boolean; size?: number } = {}) {
    if (discoveryLock.current) {
      toast.info("Discovery is already running. Please wait for it to finish.");
      return false;
    }
    discoveryLock.current = true;
    setProjectRun({ campaignId: c.id });
    try {
      const fresh = (liveState.current.campaigns.find((x) => x.id === c.id) as Project | undefined) ?? c;
      const deps = {
        ...projectDeps(c),
        // Progress is saved after each tier so a reload keeps what was found.
        checkpoint: async (found: Lead[], reports: ProjectReport[], pool: Project["custom"]["pool"]) => {
          const { merged, next } = withProjectResults(liveState.current, fresh, found, reports, pool, false);
          if (merged.added.length || merged.refreshed) await save(next, "Progress saved", true);
        },
      };
      const result = await topUp(fresh, liveState.current.leads, deps, options);
      const { merged, next } = withProjectResults(liveState.current, fresh, result.incoming, result.reports, result.pool, true, result.geo);
      const failed = result.reports.filter((r) => r.status === "failed").length;
      return await save(next, `${c.name}: ${merged.added.length} new leads, ${merged.refreshed} re-confirmed` + (failed ? `; ${failed} searches failed (see the source report)` : ""));
    } finally {
      discoveryLock.current = false;
      setProjectRun(null);
    }
  }
  /** Applies a server-side ledger change to the loaded leads without re-sending them. */
  function applyLedger(ids: string[], delivery: DeliveryState, nextRevision: number) {
    const next = { ...liveState.current, leads: applyDelivery(liveState.current.leads, ids, delivery) };
    const changed = new Set(ids);
    for (const l of next.leads) if (changed.has(l.id)) persisted.current.set(l.id, l);
    revision.current = nextRevision;
    liveState.current = next;
    setState(next);
  }
  async function ledgerCall(body: unknown) {
    if (lock.current) throw new Error("A save is in progress. Please try again when it finishes.");
    lock.current = true;
    setBusy(true);
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { error?: string; revision: number; delivery: Delivery; ids: string[]; state: DeliveryState };
      if (!r.ok) throw new Error(d.error || "The request failed.");
      applyLedger(d.ids, d.state, d.revision);
      return d;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function generateBatch(c: Project, size: number) {
    try {
      // Top up first when the pool cannot fill the batch.
      const preview = planDelivery(c, liveState.current.leads, size, 1, suppressionIndex(extras.suppression), "preview", now());
      // A tier short of its share (or a short total) is topped up before it spills to other tiers.
      const { planned, actual } = preview.delivery;
      const shortTier = Object.entries(planned).some(([t, n]) => (actual.tiers[t] ?? 0) < n);
      if (preview.ids.length < size || shortTier) {
        toast.info(
          preview.ids.length < size
            ? `The pool has ${preview.ids.length} of ${size} leads; running discovery first.`
            : "Some tiers are short of their share; running discovery for them first.",
        );
        await runProjectDiscovery(c, { size });
      }
      const d = await ledgerCall({ action: "deliver", campaignId: c.id, size, revision: revision.current });
      setExtras((x) => ({ ...x, deliveries: [...x.deliveries, d.delivery] }));
      toast.success(`Batch ${d.delivery.seq}: ${d.delivery.delivered} of ${size} leads delivered`, {
        description: d.delivery.notes.join(" ") || undefined,
        action: { label: "Download", onClick: () => window.location.assign(`/api/project-export?campaign=${encodeURIComponent(c.id)}&delivery=${encodeURIComponent(d.delivery.id)}`) },
        duration: 15000,
      });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The batch could not be generated.");
      return false;
    }
  }
  async function undoBatch(c: Project, d: Delivery) {
    if (!window.confirm(`Undo batch ${d.seq}? Its ${d.delivered} leads return to the pool.`)) return false;
    try {
      const r = await ledgerCall({ action: "undo", campaignId: c.id, deliveryId: d.id, revision: revision.current });
      setExtras((x) => ({ ...x, deliveries: x.deliveries.filter((y) => y.id !== d.id) }));
      toast.success(`Batch ${d.seq} undone; ${r.ids.length} leads are available again`);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The batch could not be undone.");
      return false;
    }
  }
  async function saveProject(c: Project, message = "Project saved") {
    return save({ ...liveState.current, campaigns: liveState.current.campaigns.map((x) => (x.id === c.id ? c : x)) }, message);
  }
  // ---------- Outcome tracking ----------
  const projectOf = (l: Lead) => liveState.current.campaigns.find((c) => c.id === l.campaignId && c.custom) as Project | undefined;
  const latestLead = (l: Lead) => liveState.current.leads.find((x) => x.id === l.id) ?? l;
  const replaceLeads = (changed: Lead[]) => {
    const byId = new Map(changed.map((l) => [l.id, l]));
    return { ...liveState.current, leads: liveState.current.leads.map((l) => byId.get(l.id) ?? l) };
  };
  async function markLeadSent(l: Lead, info: SentInfo) {
    const c = projectOf(l);
    if (!c) return false;
    const { lead, event } = markSent(latestLead(l), { channel: info.channel, templateId: info.template.id, templateVersion: info.template.version }, c.custom.followUpDays, now());
    return save(replaceLeads([lead]), lead.followUp ? `Marked as sent · ${lead.project!.outreach.followUpStep === 2 ? "Follow-up 2" : "Follow-up 1"} reminder on ${lead.followUp}` : "Marked as sent", false, { events: [event] });
  }
  async function logLeadReply(l: Lead, channel: string, note: string) {
    const { lead, event } = logReply(latestLead(l), channel, note, now());
    if (await save(replaceLeads([lead]), "Reply logged", false, { events: [event] })) setReplyFor(null);
  }
  async function setLeadStatus(l: Lead, status: OutreachStatus) {
    const current = latestLead(l);
    const at = now();
    let lead = setStatus(current, status, at);
    // Exits and Won end the follow-up reminders.
    if (!["contacted", "replied", "interested", "meeting"].includes(status)) lead = { ...lead, followUp: "" };
    const suppression = status === "do_not_contact" ? doNotContactEntries(current, at) : [];
    return save(replaceLeads([lead]), status === "do_not_contact" ? `${l.name} will not be contacted again (${suppression.length} entries added to the do-not-contact list)` : "Status updated", false, { suppression });
  }
  async function markNoResponse(leads: Lead[]) {
    const at = now();
    return save(replaceLeads(leads.map((l) => ({ ...setStatus(latestLead(l), "no_response", at), followUp: "" }))), `${leads.length} marked as No response`);
  }
  const outcomeHandlers = { onSent: markLeadSent, onReply: (l: Lead) => setReplyFor(l), onStatus: setLeadStatus };
  // ---------- Data quality ----------
  async function runChecks(c: Project) {
    if (!(await sourcesHealth())) return toast.error("Start the sources service (npm run sources) to run checks.");
    setProjectRun({ campaignId: c.id, progress: { done: 0, total: 0, label: "Checking email domains and websites" } });
    try {
      const { leads, summary } = await contactChecks(liveState.current.leads.filter((l) => l.campaignId === c.id && l.project), (route, body) => sourcesCall(route, body));
      return await save(
        replaceLeads(leads),
        `Checked ${summary.emails} emails (${summary.validDomain} valid domain, ${summary.noMailServer} no mail server, ${summary.invalid} invalid${summary.unknown ? `, ${summary.unknown} could not be looked up` : ""}) and ${summary.websites} websites (${summary.live} live, ${summary.redirects} redirect, ${summary.dead} dead, ${summary.timeout} timed out)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checks failed.");
      return false;
    } finally {
      setProjectRun(null);
    }
  }
  async function runRecheck(c: Project) {
    setProjectRun({ campaignId: c.id, progress: { done: 0, total: 0, label: "Re-checking stale leads against their sources" } });
    try {
      const r = await recheckStale(c, liveState.current.leads, { call: (route, body) => sourcesCall(route, body), discover: discoverCall });
      const latest = liveState.current;
      const next = {
        ...replaceLeads(r.leads),
        campaigns: latest.campaigns.map((x) => (x.id === c.id && x.custom ? { ...x, custom: { ...x.custom, lastReport: [...r.reports, ...x.custom.lastReport].slice(0, 400) } } : x)),
      };
      return await save(next, `Re-checked ${r.stale} stale leads (see the source report)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-check failed.");
      return false;
    } finally {
      setProjectRun(null);
    }
  }
  async function saveWorkspaceTemplates(templates: ProjectTemplate[]) {
    return save({ ...liveState.current, customTemplates: templates }, "Workspace default saved");
  }
  async function prepareDrafts(c: Project, d: Delivery, channels: TemplateChannel[]) {
    const latest = liveState.current;
    const fresh = (latest.campaigns.find((x) => x.id === c.id) as Project | undefined) ?? c;
    const inBatch = latest.leads.filter((l) => l.campaignId === c.id && l.project?.delivery.id === d.id);
    const { leads, blocked } = batchDrafts(inBatch, channels, fresh.custom, latest.customTemplates ?? []);
    const byId = new Map(leads.map((l) => [l.id, l]));
    const ok = await save({ ...latest, leads: latest.leads.map((l) => byId.get(l.id) ?? l) }, `Drafts prepared for ${leads.length} leads in batch ${d.seq}`);
    if (ok && blocked) toast.warning(`${blocked} drafts still contain placeholders without a value; fill the sender profile or add fallbacks, then prepare again.`);
    return ok;
  }
  async function createProject(c: Campaign) {
    if (!(await save({ ...liveState.current, campaigns: [...liveState.current.campaigns, c] }, "Lead project created"))) return false;
    setProjectView(c.id);
    // New projects fill their pool straight away.
    void runProjectDiscovery(c as Project, { size: 250 });
    return true;
  }
  function showLeads(c: Campaign) {
    setActiveCampaign(null);
    setCampaignFilter(c.id);
    go("Leads");
  }
  function draftLead(l: Lead) {
    setOutreachLead(l.id);
    go("Outreach");
  }
  return (
    <SidebarProvider>
      <Sidebar className="brand-sidebar">
        <SidebarHeader>
          <div className="brand">
            <Sparkles />
            LeadGen <em>Pro</em>
          </div>
          <div className="signature">by Rini</div>
        </SidebarHeader>
        <SidebarContent>
          <span className="nav-caption">YOUR WORKSPACE</span>
          <Navigation page={page} go={go} />
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-note">
            <Sparkles size={23} />
            <p>
              Your pipeline.
              <br />
              <em>Your next opportunity.</em>
            </p>
            <small>LEADGEN PRO WORKSPACE</small>
          </div>
          <div className="profile">
            <b className="avatar">{state.profile.name.slice(0, 1)}</b>
            <span>
              {state.profile.name}
              <small>Founder · Your workspace</small>
            </span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main className="workspace" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <span>
              Workspace <span className="muted"> / </span>{" "}
              {page === "Inbox" ? "Follow-ups" : page}
            </span>
          </div>
          <div className="button-row">
            <span className="saved-state" aria-live="polite">
              {busy
                ? "Saving…"
                : loading
                  ? "Loading…"
                  : error
                    ? "Save needs attention"
                    : "Workspace saved"}
            </span>
            <span className="demo-tag">
              {ai ? "AI connected" : "Templates available"}
            </span>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div role="alert" className="error-banner">
              <p>{error}</p>
              <button className="secondary" disabled={busy} onClick={load}>
                <RefreshCw size={15} /> Reload saved data
              </button>
            </div>
          )}
          {loading ? (
            <div
              aria-label="Loading your workspace"
              className="loading-surface"
            >
              <h1>Your workspace is opening…</h1>
              <Skeleton className="h-44 w-full" />
              <div className="stats">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            </div>
          ) : !initialized.current ? (
            <section className="panel">
              <h1>Workspace unavailable</h1>
              <p className="muted">
                Your saved records could not be loaded. Use Reload saved data
                above to try again.
              </p>
            </section>
          ) : (
            <>
              {page === "Dashboard" && (
                <Dashboard
                  state={state}
                  startProject={() => {
                    setProjectView("new");
                    go("Lead Projects");
                  }}
                  start={start}
                  go={go}
                  open={openCampaign}
                  busy={busy}
                />
              )}{" "}
              {page === "Campaigns" && (
                <Campaigns
                  state={state}
                  start={start}
                  open={openCampaign}
                />
              )}{" "}
              {page === "Lead Projects" && (
                <Projects
                  state={state}
                  deliveries={extras.deliveries}
                  health={health}
                  busy={busy}
                  running={projectRun}
                  view={projectView}
                  setView={setProjectView}
                  discover={discoverCall}
                  preview={async (c, options) => {
                    try {
                      return await availability(c as Project, projectDeps(c), options);
                    } finally {
                      setProjectRun(null);
                    }
                  }}
                  progress={projectRun?.progress}
                  create={createProject}
                  saveProject={saveProject}
                  runDiscovery={runProjectDiscovery}
                  generate={generateBatch}
                  undo={undoBatch}
                  refreshHealth={refreshHealth}
                  prepareDrafts={prepareDrafts}
                  checks={runChecks}
                  recheck={runRecheck}
                  tabs={(c) => [
                    {
                      id: "outreach",
                      label: "Outreach",
                      render: () => (
                        <ProjectOutreach
                          project={c}
                          state={state}
                          busy={busy}
                          onSave={saveProject}
                          onSaveWorkspaceTemplates={saveWorkspaceTemplates}
                          onSent={markLeadSent}
                          onReply={(l) => setReplyFor(l)}
                        />
                      ),
                    },
                    {
                      id: "map",
                      label: "Map",
                      render: () => (
                        <Suspense fallback={<p className="muted">Loading the map…</p>}>
                          <ProjectMap project={c} state={state} events={extras.events} busy={busy} handlers={outcomeHandlers} />
                        </Suspense>
                      ),
                    },
                    { id: "outcomes", label: "Outcomes", render: () => <ProjectOutcomes project={c} state={state} events={extras.events} /> },
                  ]}
                />
              )}{" "}
              {page === "Find My Market" && (
                <MarketBuilder
                  key={builder?.id || "new"}
                  initial={builder || newCampaign()}
                  onSave={saveCampaign}
                  onCancel={() => go("Dashboard")}
                  busy={busy}
                  ai={ai}
                />
              )}{" "}
              {page === "Leads" && (
                <Leads
                  state={state}
                  save={save}
                  busy={busy}
                  campaignFilter={campaignFilter}
                  setCampaignFilter={setCampaignFilter}
                  outreach={draftLead}
                  discover={discover}
                  discovering={discovering}
                  projectRow={(l) => <StatusSelect lead={l} busy={busy} onStatus={setLeadStatus} />}
                  projectPanel={(d) => {
                    const lead = state.leads.find((x) => x.id === d.id) ?? d;
                    const c = state.campaigns.find((x) => x.id === lead.campaignId && x.custom) as Project | undefined;
                    return c ? (
                      <LeadOutcomePanel lead={lead} project={c.custom} events={extras.events} workspaceTemplates={state.customTemplates ?? []} busy={busy} handlers={outcomeHandlers} />
                    ) : null;
                  }}
                />
              )}{" "}
              {page === "Outreach" && (
                <Outreach
                  key={outreachLead}
                  state={state}
                  save={save}
                  busy={busy}
                  initialLead={outreachLead}
                  ai={ai}
                />
              )}{" "}
              {page === "Inbox" && (
                <FollowUps
                  state={state}
                  save={save}
                  busy={busy}
                  outreach={draftLead}
                  projectTools={{
                    open: (l) => {
                      setProjectView(l.campaignId);
                      go("Lead Projects");
                    },
                    noResponse: noResponseSuggestions(
                      state.leads.filter((l) => l.project),
                      extras.events,
                      (l) => (state.campaigns.find((c) => c.id === l.campaignId)?.custom?.noResponseDays ?? 7),
                      localDate(),
                    ),
                    markNoResponse,
                  }}
                />
              )}{" "}
              {page === "Analytics" && (
                <Analytics
                  state={state}
                  projects={state.campaigns
                    .filter((c) => c.custom && !c.demo)
                    .map((c) => (
                      <section key={c.id} className="project-analytics">
                        <div className="section-title">
                          <div>
                            <p className="eyebrow">LEAD PROJECT</p>
                            <h2>{c.name}</h2>
                          </div>
                        </div>
                        <ProjectOutcomes project={c as Project} state={state} events={extras.events} />
                      </section>
                    ))}
                />
              )}{" "}
              {page === "Settings" && (
                <Settings
                  state={state}
                  save={save}
                  busy={busy}
                  ai={ai}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            Discover. Qualify. Follow through.
            <span>
              LeadGen Pro <em>by Rini</em>
            </span>
          </footer>
        </div>
      </main>
      <CampaignDetails
        campaign={
          activeCampaign
            ? state.campaigns.find((c) => c.id === activeCampaign.id) || null
            : null
        }
        state={state}
        onClose={() => setActiveCampaign(null)}
        onEdit={(c) => {
          setBuilder({ ...c });
          setActiveCampaign(null);
          go("Find My Market");
        }}
        onStatus={async (c, status) => {
          await save(
            {
              ...state,
              campaigns: state.campaigns.map((x) =>
                x.id === c.id ? { ...x, status } : x,
              ),
            },
            "Campaign updated",
          );
        }}
        onLeads={showLeads}
        onSamples={async (c) => {
          setActiveCampaign(null);
          setCampaignFilter(c.id);
          go("Leads");
          await discover(c);
        }}
        busy={busy}
      />
      <ReplyDialog lead={replyFor} busy={busy} onClose={() => setReplyFor(null)} onSave={logLeadReply} />
      <Toaster theme="dark" richColors position="bottom-right" />
    </SidebarProvider>
  );
}
