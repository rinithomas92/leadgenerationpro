"use client";
import { useState, useEffect, useRef, useCallback } from "react";
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
  sampleWorkspace,
  deduplicate,
  metrics,
  type Workspace,
  type Campaign,
  type Lead,
} from "@/lib/leadgen";
import { Dashboard } from "./dashboard";
import { FollowUps } from "./follow-ups";
import { Campaigns, CampaignDetails, MarketBuilder } from "./campaigns";
import { Leads } from "./leads";
import { Outreach } from "./outreach";
import { Analytics, Settings } from "./insights";
const names = [
  "Dashboard",
  "Find My Market",
  "Campaigns",
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
  const revision = useRef(0);
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
      initialized.current = true;
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load your workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
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
  }, [load]);
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
  async function save(next: Workspace, message = "Saved") {
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
      const r = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, revision: revision.current }),
      });
      const d = (await r.json()) as Snapshot & { error: string };
      if (!r.ok) throw new Error(d.error);
      setState(d.state);
      revision.current = d.revision;
      setError("");
      toast.success(message);
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
  function start(theme = 5, description = "") {
    const c = newCampaign(theme, description);
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
      setActiveCampaign(c);
      setBuilder(null);
      go("Campaigns");
      return true;
    }
    return false;
  }
  async function samples() {
    if (state.campaigns.some((c) => c.demo)) {
      toast.info("Sample campaigns are already in your workspace.");
      return;
    }
    await save(
      sampleWorkspace(state),
      "Sample campaigns and fictional leads added",
    );
  }
  async function addSamples(c: Campaign) {
    setBusy(true);
    try {
      const r = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign: c, mode: "directory" }),
      });
      const d = (await r.json()) as {
        error?: string;
        leads: Lead[];
        message: string;
      };
      if (!r.ok) throw new Error(d.error);
      const current = liveState.current;
      const incoming = deduplicate(current.leads, d.leads);
      if (!incoming.length) {
        toast.info(
          d.leads.length
            ? "Real businesses are already saved."
            : "No businesses found for these markets.",
        );
        return;
      }
      if (
        await save(
          { ...current, leads: [...current.leads, ...incoming] },
          `${incoming.length} real businesses added`,
        )
      ) {
        setActiveCampaign(null);
        setCampaignFilter(c.id);
        go("Leads");
      }
      toast.info(d.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setBusy(false);
    }
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
                  start={start}
                  go={go}
                  open={setActiveCampaign}
                  sample={samples}
                  busy={busy}
                />
              )}{" "}
              {page === "Campaigns" && (
                <Campaigns
                  state={state}
                  start={start}
                  open={setActiveCampaign}
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
                />
              )}{" "}
              {page === "Analytics" && <Analytics state={state} />}{" "}
              {page === "Settings" && (
                <Settings
                  state={state}
                  save={save}
                  busy={busy}
                  ai={ai}
                  sample={samples}
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
        onSamples={addSamples}
        busy={busy}
      />
      <Toaster theme="dark" richColors position="bottom-right" />
    </SidebarProvider>
  );
}
