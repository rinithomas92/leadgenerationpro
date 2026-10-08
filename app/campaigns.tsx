"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  ScanSearch,
  Sparkles,
  Megaphone,
  Check,
  ArrowLeft,
  LoaderCircle,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  presets,
  channels,
  suggestMarkets,
  metrics,
  type Workspace,
  type Campaign,
  type Market,
} from "@/lib/leadgen";
import { Mark, Stats, Blank, Field, Choice, formatDate } from "./ui";
export function CampaignTable({
  campaigns,
  state,
  open,
  start,
}: {
  campaigns: Campaign[];
  state: Workspace;
  open: (c: Campaign) => void;
  start: () => void;
}) {
  if (!campaigns.length)
    return (
      <Blank
        title="Make room for your next opportunity."
        description="Choose a business template or create a campaign of your own."
      >
        <button className="primary" onClick={start}>
          <Plus size={16} /> Create your first campaign
        </button>
      </Blank>
    );
  return (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          <TableHead>Campaign</TableHead>
          <TableHead>Leads</TableHead>
          <TableHead>Interested</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map((c) => {
          const m = metrics(state.leads.filter((l) => l.campaignId === c.id));
          return (
            <TableRow key={c.id}>
              <TableCell>
                <button className="campaign-name" onClick={() => open(c)}>
                  <Mark theme={c.theme} />
                  <span>
                    <b>{c.name}</b>
                    <small>
                      {c.markets.map((m) => m.name).join(", ") || c.description}
                    </small>
                    {c.demo && <span className="mini-label">Demo</span>}
                  </span>
                </button>
              </TableCell>
              <TableCell>{m.found}</TableCell>
              <TableCell>{m.interested}</TableCell>
              <TableCell>
                <span className={"status status-" + c.status.toLowerCase()}>
                  {c.status}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
export function Campaigns({
  state,
  start,
  open,
}: {
  state: Workspace;
  start: () => void;
  open: (c: Campaign) => void;
}) {
  const [status, setStatus] = useState("All statuses");
  const [q, setQ] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CAMPAIGN MANAGEMENT</p>
          <h1>Your campaigns</h1>
          <p className="muted">
            Organize your offers, target markets and discovery activity.
          </p>
        </div>
        <button className="primary" onClick={start}>
          <Plus size={17} /> New campaign
        </button>
      </div>
      <section className="panel">
        <div className="toolbar">
          <input
            className="input"
            aria-label="Search campaigns"
            placeholder="Search campaigns…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Choice
            label="Campaign status"
            value={status}
            onChange={setStatus}
            options={["All statuses", "Active", "Paused", "Archived"]}
          />
        </div>
        <CampaignTable
          campaigns={state.campaigns.filter(
            (c) =>
              (status === "All statuses" || c.status === status) &&
              c.name.toLowerCase().includes(q.toLowerCase()),
          )}
          state={state}
          open={open}
          start={start}
        />
      </section>
    </>
  );
}
export function CampaignDetails({
  campaign,
  state,
  onClose,
  onEdit,
  onStatus,
  onLeads,
  onSamples,
  busy,
}: {
  campaign: Campaign | null;
  state: Workspace;
  onClose: () => void;
  onEdit: (c: Campaign) => void;
  onStatus: (c: Campaign, status: Campaign["status"]) => Promise<void>;
  onLeads: (c: Campaign) => void;
  onSamples: (c: Campaign) => void;
  busy: boolean;
}) {
  return (
    <Dialog
      open={!!campaign}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign?.name}</DialogTitle>
          <DialogDescription>
            Campaign details and next steps.
          </DialogDescription>
        </DialogHeader>
        {campaign && (
          <>
            <div className="flex gap-3 items-center">
              <Mark theme={campaign.theme} />
              <span
                className={"status status-" + campaign.status.toLowerCase()}
              >
                {campaign.status}
              </span>
              {campaign.demo && <span className="demo-tag">Demo campaign</span>}
            </div>
            <p>{campaign.description}</p>
            <div className="details-grid">
              <span>
                Location
                <strong>
                  {campaign.location} · {campaign.radius}
                </strong>
              </span>
              <span>
                Goal<strong>{campaign.goal}</strong>
              </span>
              <span>
                Channels<strong>{campaign.channels.join(", ")}</strong>
              </span>
              <span>
                Created<strong>{formatDate(campaign.createdAt)}</strong>
              </span>
            </div>
            <div className="chips">
              {campaign.markets.map((m, i) => (
                <span key={i}>{m.name}</span>
              ))}
            </div>
            <p className="muted">
              {state.leads.filter((l) => l.campaignId === campaign.id).length}{" "}
              saved leads. Search the public business directory or import your
              business leads. Every result has a source link.
            </p>
            <div className="button-row">
              <button className="primary" onClick={() => onLeads(campaign)}>
                Review leads <ArrowRight size={16} />
              </button>
              <button
                className="secondary"
                disabled={busy || campaign.status !== "Active"}
                onClick={() => onSamples(campaign)}
              >
                Find real businesses
              </button>
              <button className="secondary" onClick={() => onEdit(campaign)}>
                Edit campaign
              </button>
            </div>
            <div className="button-row">
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  onStatus(
                    campaign,
                    campaign.status === "Active" ? "Paused" : "Active",
                  )
                }
              >
                {campaign.status === "Active"
                  ? "Pause campaign"
                  : "Activate campaign"}
              </button>
              <button
                className="text-button"
                disabled={busy || campaign.status === "Archived"}
                onClick={() => onStatus(campaign, "Archived")}
              >
                Archive campaign
              </button>
            </div>
            <p className="muted">
              Pausing or archiving keeps your records and prevents new
              discovery. This app never sends outreach automatically.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function MarketBuilder({
  initial,
  onSave,
  onCancel,
  busy,
  ai,
}: {
  initial: Campaign;
  onSave: (c: Campaign) => Promise<boolean>;
  onCancel: () => void;
  busy: boolean;
  ai: boolean;
}) {
  const [c, setC] = useState(initial);
  const [step, setStep] = useState(1);
  const [markets, setMarkets] = useState<Market[]>(initial.markets);
  const [selected, setSelected] = useState<number[]>(
    initial.markets.map((_, i) => i),
  );
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState("");
  const set = (key: keyof Campaign, value: unknown) =>
    setC((prev) => ({ ...prev, [key]: value }));
  async function generate() {
    setGenerating(true);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "markets", campaign: c }),
      });
      const data = (await r.json()) as {
        error: string;
        markets: Market[];
        mode: string;
      };
      if (!r.ok) throw new Error(data.error);
      setMarkets(data.markets);
      setSelected(data.markets.map((_: Market, i: number) => i));
      setMode(data.mode);
      setStep(2);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not generate markets.",
      );
    } finally {
      setGenerating(false);
    }
  }
  function fallback() {
    const m = suggestMarkets(c.description, c.location, c.theme, c.customer);
    setMarkets(m);
    setSelected(m.map((_, i) => i));
    setMode("demo");
    setStep(2);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARKET DISCOVERY</p>
          <h1>Find your market</h1>
          <p className="muted">
            Define your offer and choose the audiences to explore.
          </p>
        </div>
        <button className="secondary" onClick={onCancel}>
          Back to workspace
        </button>
      </div>
      <div className="steps">
        <span className={step === 1 ? "current" : "done"}>
          01 <b>Describe your offering</b>
        </span>
        <ArrowRight size={17} />
        <span className={step === 2 ? "current" : ""}>
          02 <b>Choose your markets</b>
        </span>
        <ArrowRight size={17} />
        <span>
          03 <b>Create your campaign</b>
        </span>
      </div>
      {step === 1 ? (
        <div className="builder-grid">
          <form
            className="panel form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <div className="span-2">
              <h2>Campaign brief</h2>
              <p className="muted">
                A little detail helps you find a better fit.
              </p>
            </div>
            <Field label="Business / campaign name">
              <input
                className="input"
                required
                maxLength={300}
                value={c.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Rini Aesthetics"
              />
            </Field>
            <Field label="Website (optional)">
              <input
                className="input"
                type="url"
                maxLength={300}
                value={c.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://your-business.com"
              />
            </Field>
            <div className="span-2">
              <Field
                label="What do you sell?"
                hint="Include what makes your offering useful or distinctive."
              >
                <textarea
                  className="input"
                  required
                  maxLength={5000}
                  rows={4}
                  value={c.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Handmade paintings that bring warmth and personality to cafés…"
                />
              </Field>
            </div>
            <Field label="Target location">
              <input
                className="input"
                required
                maxLength={300}
                value={c.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </Field>
            <Field label="Service area (planning only)">
              <input
                className="input"
                maxLength={300}
                value={c.radius}
                onChange={(e) => set("radius", e.target.value)}
                placeholder="e.g. 25 km; directory search uses city boundaries"
              />
            </Field>
            <Field label="Preferred customer (optional)">
              <input
                className="input"
                maxLength={300}
                value={c.customer}
                onChange={(e) => set("customer", e.target.value)}
                placeholder="e.g. Independent cafés"
              />
            </Field>
            <Field label="Price range (optional)">
              <input
                className="input"
                maxLength={300}
                value={c.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="e.g. ₹5,000–₹25,000"
              />
            </Field>
            <div className="span-2">
              <Field label="Campaign goal">
                <input
                  className="input"
                  required
                  maxLength={300}
                  value={c.goal}
                  onChange={(e) => set("goal", e.target.value)}
                />
              </Field>
            </div>
            <div className="span-2">
              <p className="field-label">Preferred outreach channels</p>
              <div className="button-row">
                {channels.slice(0, 3).map((ch) => (
                  <label className="check-label" key={ch}>
                    <Checkbox
                      checked={c.channels.includes(ch)}
                      onCheckedChange={(v) =>
                        set(
                          "channels",
                          v
                            ? [...c.channels, ch]
                            : c.channels.filter((x) => x !== ch),
                        )
                      }
                    />
                    {ch}
                  </label>
                ))}
              </div>
            </div>
            <div className="span-2 form-end">
              <p className="muted">
                {ai
                  ? "AI suggestions are hypotheses for you to review."
                  : "Starter suggestions are available without an AI connection."}
              </p>
              <button
                className="primary"
                disabled={generating || !c.channels.length}
              >
                {generating ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <Sparkles size={17} />
                )}{" "}
                {generating ? "Finding possibilities…" : "Suggest markets"}
              </button>
              {ai && (
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    !c.name.trim() ||
                    !c.description.trim() ||
                    !c.location.trim()
                  }
                  onClick={fallback}
                >
                  Use starter suggestions instead
                </button>
              )}
            </div>
          </form>
          <aside className="builder-aside">
            <Mark theme={c.theme} />
            <h2>
              A clearer idea.
              <br />A better connection.
            </h2>
            <p>
              Tell us what you offer, who it helps, and where you want to grow.
            </p>
            <hr />
            <h3>Make it specific</h3>
            <p>
              “Custom artwork for independent cafés in Pune” gives you a more
              useful starting point than “art.”
            </p>
            <p className="notice">
              You’ll review and edit every market before creating your campaign.
            </p>
          </aside>
        </div>
      ) : (
        <>
          <section className="panel">
            <div className="section-title">
              <div>
                <h2>Review your target markets</h2>
                <p className="muted">
                  Select and edit the markets you want to explore for {c.name}.
                </p>
              </div>
              <button className="text-button" onClick={() => setStep(1)}>
                <ArrowLeft size={16} /> Edit offering
              </button>
            </div>
            <p className="notice">
              {mode === "ai"
                ? "AI suggestions: review these hypotheses before use."
                : "Starter suggestions · Indicative fit scores. Review these hypotheses against your own market knowledge."}{" "}
              Relevance is not a conversion prediction.
            </p>
            <div className="market-grid">
              {markets.map((m, i) => (
                <article
                  key={i}
                  className={
                    "market-card " + (selected.includes(i) ? "selected" : "")
                  }
                >
                  <div className="flex items-center justify-between">
                    <label className="check-label">
                      <Checkbox
                        aria-label={"Select " + m.name}
                        checked={selected.includes(i)}
                        onCheckedChange={(v) =>
                          setSelected(
                            v
                              ? [...selected, i]
                              : selected.filter((x) => x !== i),
                          )
                        }
                      />{" "}
                      Include market
                    </label>
                    <span className="score">{m.score}/100</span>
                  </div>
                  <Field label="Market name">
                    <input
                      className="input"
                      required
                      maxLength={300}
                      value={m.name}
                      onChange={(e) =>
                        setMarkets(
                          markets.map((v, j) =>
                            j === i ? { ...v, name: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Progress
                    value={m.score}
                    aria-label="Market relevance"
                    className="h-1"
                  />
                  <p>{m.reason}</p>
                  <details>
                    <summary>Why this market?</summary>
                    <p>
                      <b>Likely needs:</b> {m.needs}
                    </p>
                    <p>
                      <b>Positioning:</b> {m.positioning}
                    </p>
                    <Field label="Search terms">
                      <input
                        className="input"
                        maxLength={300}
                        value={m.search}
                        onChange={(e) =>
                          setMarkets(
                            markets.map((v, j) =>
                              j === i ? { ...v, search: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </Field>
                  </details>
                </article>
              ))}
            </div>
            <button
              className="text-button"
              disabled={markets.length >= 20}
              onClick={() => {
                setMarkets([
                  ...markets,
                  {
                    name: "Custom market",
                    reason: "User-defined market hypothesis.",
                    needs: "Add customer needs.",
                    positioning: "Add your positioning.",
                    search: `Businesses in ${c.location}`,
                    score: 50,
                  },
                ]);
                setSelected([...selected, markets.length]);
              }}
            >
              <Plus size={16} /> Add custom market
            </button>
          </section>
          <div className="save-bar">
            <span>
              {selected.length} market{selected.length === 1 ? "" : "s"}{" "}
              selected · {c.location}
            </span>
            <button
              className="primary"
              disabled={
                busy ||
                !selected.length ||
                selected.some((i) => !markets[i]?.name.trim())
              }
              onClick={() =>
                onSave({
                  ...c,
                  markets: markets.filter((_, i) => selected.includes(i)),
                })
              }
            >
              {busy ? "Saving…" : "Save campaign"} <Check size={17} />
            </button>
          </div>
        </>
      )}
    </>
  );
}
