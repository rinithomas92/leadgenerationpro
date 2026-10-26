"use client";
// Five-step brief for a custom lead project: business, target segments,
// location and reach, tier split, availability preview. Rule-based only.
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Plus, Search, Trash2, TriangleAlert, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Field } from "./ui";
import { SplitEditor, TierPicker, AvailabilityTable } from "./project-parts";
import {
  briefErrors,
  defaultSplit,
  descriptionKeywords,
  globalCountries,
  newCustomCampaign,
  privateIndividualWarning,
  segmentErrors,
  splitErrors,
  tierErrors,
} from "@/lib/project";
import { browseChildren, categoriesUnder, categoryLabel, categoryTotal, countryList, readableCategory, suggestCategories } from "@/lib/categories";
import { tiers as tierOrder, type Segment, type Tier } from "@/lib/project-schema";
import { uid, type Campaign } from "@/lib/leadgen";
import type { ProjectGeo } from "@/lib/project-net";
import type { Availability } from "@/lib/project-run";

type Props = {
  discover: (body: unknown) => Promise<unknown>;
  preview: (campaign: Campaign, options?: { osm?: boolean }) => Promise<{ rows: Availability[] }>;
  progress?: { label: string; done: number; total: number };
  onSave: (campaign: Campaign) => Promise<boolean>;
  onCancel: () => void;
  busy: boolean;
  sender: { name: string; business: string; website: string };
};
const steps = ["Business", "Segments", "Location and reach", "Tier split", "Availability"];
const firstSentence = (s: string) => (s.trim().match(/^[^.!?]+[.!?]?/)?.[0] ?? s).trim().slice(0, 300);

/** Browse every category: pick a group, drill down, add single ones or a whole group; or search all. */
function CategoryBrowser({ selected, onAdd }: { selected: string[]; onAdd: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const parent = trail[trail.length - 1] ?? "";
  const nodes = useMemo(() => browseChildren(parent), [parent]);
  const results = useMemo(() => (q.trim().length >= 2 ? suggestCategories(q, 40) : []), [q]);
  if (!open)
    return (
      <button className="text-button" onClick={() => setOpen(true)}>
        <Search size={15} /> Browse all {categoryTotal.toLocaleString()} categories
      </button>
    );
  const add = (ids: string[]) => onAdd(ids.filter((id) => !selected.includes(id)));
  return (
    <div className="category-browser">
      <div className="section-title">
        <small className="muted">Browse all categories</small>
        <button className="text-button" onClick={() => setOpen(false)}>Close</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all categories, e.g. dentist, cafe, gym" aria-label="Search categories" />
      {q.trim().length >= 2 ? (
        <div className="chips">
          {results.length ? (
            results.map((s) => (
              <button key={s.id} className={selected.includes(s.id) ? "chip chip-on" : "chip"} title={s.path} disabled={selected.includes(s.id)} onClick={() => add([s.id])}>
                {selected.includes(s.id) ? <Check size={12} /> : <Plus size={12} />} {s.label}
              </button>
            ))
          ) : (
            <span className="muted">No categories match “{q}”. Try a broader word.</span>
          )}
        </div>
      ) : (
        <>
          <div className="chips">
            <button className="chip" onClick={() => setTrail([])}>All groups</button>
            {trail.map((id, i) => (
              <button key={id} className="chip" onClick={() => setTrail(trail.slice(0, i + 1))}>› {readableCategory(id)}</button>
            ))}
          </div>
          {parent && (
            <button className="text-button" onClick={() => add(categoriesUnder(parent))}>
              <Plus size={14} /> Add all {categoriesUnder(parent).length} in {readableCategory(parent)}
            </button>
          )}
          <div className="chips category-list">
            {nodes.map((n) => {
              const hasKids = browseChildren(n.id).length > 0;
              const on = selected.includes(n.id);
              return (
                <span key={n.id} className="chip-split">
                  {n.selectable ? (
                    <button className={on ? "chip chip-on" : "chip"} disabled={on} onClick={() => add([n.id])}>
                      {on ? <Check size={12} /> : <Plus size={12} />} {n.label}
                    </button>
                  ) : (
                    <span className="chip chip-soft">{n.label}</span>
                  )}
                  {hasKids && (
                    <button className="chip" onClick={() => setTrail([...trail, n.id])} aria-label={`Open ${n.label}`}>
                      {n.count} <ChevronRight size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SegmentEditor({ segment, onChange, onRemove, related }: { segment: Segment; onChange: (s: Segment) => void; onRemove?: () => void; related: string[] }) {
  const [inc, setInc] = useState("");
  const [exc, setExc] = useState("");
  const suggestions = useMemo(() => suggestCategories(segment.label, 8).filter((s) => !segment.categories.includes(s.id)), [segment.label, segment.categories]);
  const relatedSuggestions = useMemo(
    () => related.flatMap((w) => suggestCategories(w, 2, { strict: true })).filter((s, i, a) => !segment.categories.includes(s.id) && a.findIndex((x) => x.id === s.id) === i).slice(0, 6),
    [related, segment.categories],
  );
  const warning = privateIndividualWarning(segment.label);
  const words = (raw: string) => raw.split(",").map((w) => w.trim()).filter(Boolean);
  return (
    <section className="panel segment-card">
      <div className="section-title">
        <Field label="Segment label" hint="Who should the leads be? For example “Architects” or “Furniture showrooms”.">
          <input value={segment.label} maxLength={80} onChange={(e) => onChange({ ...segment, label: e.target.value })} placeholder="e.g. Real-estate developers" />
        </Field>
        {onRemove && (
          <button className="text-button" onClick={onRemove} aria-label={`Remove ${segment.label || "segment"}`}>
            <Trash2 size={15} /> Remove
          </button>
        )}
      </div>
      {warning && (
        <div className="warning-note" role="status">
          <TriangleAlert size={16} />
          <span>
            {warning.message} Suggested: {warning.standIns.join(", ")}.
          </span>
        </div>
      )}
      <div>
        <small className="muted">Confirmed categories</small>
        <div className="chips">
          {segment.categories.length ? (
            segment.categories.map((id) => (
              <button key={id} className="chip chip-on" onClick={() => onChange({ ...segment, categories: segment.categories.filter((c) => c !== id) })} aria-label={`Remove ${categoryLabel(id)}`}>
                {categoryLabel(id)} <X size={12} />
              </button>
            ))
          ) : (
            <span className="muted">None yet. Pick from the suggestions below.</span>
          )}
        </div>
      </div>
      {!!suggestions.length && (
        <div>
          <small className="muted">Suggested categories</small>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s.id} className="chip" title={s.path} onClick={() => onChange({ ...segment, categories: [...segment.categories, s.id] })}>
                <Plus size={12} /> {s.label}
                {s.via === "synonym" && <em className="muted"> · {s.term}</em>}
              </button>
            ))}
          </div>
        </div>
      )}
      {!!relatedSuggestions.length && (
        <div>
          <small className="muted">Related to your description (optional)</small>
          <div className="chips">
            {relatedSuggestions.map((s) => (
              <button key={s.id} className="chip chip-soft" onClick={() => onChange({ ...segment, categories: [...segment.categories, s.id] })}>
                <Plus size={12} /> {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <CategoryBrowser selected={segment.categories} onAdd={(ids) => onChange({ ...segment, categories: [...new Set([...segment.categories, ...ids])] })} />
      <div className="form-grid">
        <Field label="Also include names containing (optional)" hint="Also finds places whose names contain one of these, comma-separated, even in other categories.">
          <input value={inc} onChange={(e) => setInc(e.target.value)} onBlur={() => { if (inc.trim()) { onChange({ ...segment, include: [...new Set([...segment.include, ...words(inc)])] }); setInc(""); } }} placeholder="e.g. design, interiors" />
        </Field>
        <Field label="Exclude keywords (optional)" hint="Skip names containing any of these.">
          <input value={exc} onChange={(e) => setExc(e.target.value)} onBlur={() => { if (exc.trim()) { onChange({ ...segment, exclude: [...new Set([...segment.exclude, ...words(exc)])] }); setExc(""); } }} placeholder="e.g. wholesale" />
        </Field>
      </div>
      {(segment.include.length > 0 || segment.exclude.length > 0) && (
        <div className="chips">
          {segment.include.map((w) => (
            <button key={"i" + w} className="chip" onClick={() => onChange({ ...segment, include: segment.include.filter((x) => x !== w) })}>
              + {w} <X size={12} />
            </button>
          ))}
          {segment.exclude.map((w) => (
            <button key={"e" + w} className="chip chip-soft" onClick={() => onChange({ ...segment, exclude: segment.exclude.filter((x) => x !== w) })}>
              − {w} <X size={12} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectWizard({ discover, preview, progress, onSave, onCancel, busy, sender }: Props) {
  const [step, setStep] = useState(0);
  // Errors show once Next has been pressed on a step, not while typing the first time.
  const [tried, setTried] = useState<number[]>([]);
  const [countOsm, setCountOsm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState(sender.website);
  const blank = (): Segment => ({ id: uid(), label: "", include: [], exclude: [], categories: [] });
  const [segments, setSegments] = useState<Segment[]>([blank()]);
  const [location, setLocation] = useState("");
  const [geo, setGeo] = useState<ProjectGeo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [selected, setSelected] = useState<Tier[]>(["city"]);
  const [countries, setCountries] = useState<string[]>([]);
  const [countryQuery, setCountryQuery] = useState("");
  const [localityKm, setLocalityKm] = useState(3);
  const [split, setSplit] = useState<number[]>([100]);
  const [mode, setMode] = useState<"split" | "nearest">("split");
  const [rows, setRows] = useState<Availability[] | null>(null);
  const [counting, setCounting] = useState(false);
  const related = useMemo(() => descriptionKeywords(description, 8), [description]);
  const home = geo?.country?.code || "IN";
  const tiers = tierOrder.filter((t) => selected.includes(t));
  const draft = (): Campaign =>
    newCustomCampaign({
      name: name.trim(),
      description: description.trim(),
      website: website.trim(),
      location: location.trim(),
      project: {
        segments: segments.map((s) => ({ ...s, label: s.label.trim() })),
        tiers,
        split: mode === "nearest" ? tiers.map(() => 0) : split,
        mode,
        countries: globalCountries(countries, home),
        localityKm,
        sender: { name: sender.name, business: sender.business || name.trim(), pitch: firstSentence(description), website: website.trim(), phone: "", offer: "", cta: "Can I share a 2-minute overview?" },
        base: {
          locality: geo?.locality?.lat != null ? { name: geo.locality.name, lat: geo.locality.lat, lon: geo.locality.lon!, code: "" } : undefined,
          city: geo?.city?.lat != null ? { name: geo.city.name, lat: geo.city.lat, lon: geo.city.lon!, code: "" } : undefined,
          state: geo?.state ? { name: geo.state.name, code: geo.stateCode ?? "" } : undefined,
          country: geo?.country ? { name: geo.country.name, code: geo.country.code ?? "" } : undefined,
        },
        geo: geo ?? undefined,
      },
    });
  const errors: string[] =
    step === 0
      ? Object.values(briefErrors({ name, description, website }))
      : step === 1
        ? segmentErrors(segments)
        : step === 2
          ? [...(geo ? [] : ["Check the location first."]), ...tierErrors({ tiers, countries }, !!geo?.locality, home)]
          : step === 3 && mode === "split"
            ? [splitErrors(split, tiers.length)].filter(Boolean)
            : [];
  async function resolve() {
    if (location.trim().length < 2) return;
    setResolving(true);
    try {
      const r = (await discover({ action: "plan", location: location.trim() })) as { geo: ProjectGeo };
      setGeo(r.geo);
      if (!r.geo.locality) setSelected((s) => s.filter((t) => t !== "locality"));
    } catch (e) {
      setGeo(null);
      toast.error(e instanceof Error ? e.message : "Location lookup failed.");
    } finally {
      setResolving(false);
    }
  }
  function pickTiers(next: Tier[]) {
    const ordered = tierOrder.filter((t) => next.includes(t));
    setSelected(ordered);
    setSplit(defaultSplit(ordered.length));
  }
  async function runPreview() {
    setCounting(true);
    try {
      setRows((await preview(draft(), { osm: countOsm })).rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Availability preview failed.");
    } finally {
      setCounting(false);
    }
  }
  const countryMatches = countryList()
    .filter((c) => c.code !== home && !countries.includes(c.code) && (c.name.toLowerCase().includes(countryQuery.toLowerCase()) || c.code === countryQuery.toUpperCase()))
    .slice(0, 8);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NEW LEAD PROJECT · STEP {step + 1} OF 5</p>
          <h1>{steps[step]}</h1>
          <p className="muted">Leads come only from open public data. Nothing is sent automatically.</p>
        </div>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ol className="wizard-steps" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={i === step ? "active" : i < step ? "done" : ""}>
            {i < step ? <Check size={14} /> : i + 1} {s}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <section className="panel form-stack">
          <Field label="Project name">
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interior studio outreach" />
          </Field>
          <Field label="What does the business do?" hint={`2–3 lines, 20–400 characters (${description.trim().length}).`}>
            <textarea rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Interior design studio in Baner, Pune, designing homes, offices and show flats." />
          </Field>
          <Field label="Website (optional)">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
          {related.length > 0 && (
            <p className="muted">
              Keywords found: {related.join(", ")}. They are offered as related categories in the next step.
            </p>
          )}
        </section>
      )}
      {step === 1 && (
        <div className="form-stack">
          {segments.map((s, i) => (
            <SegmentEditor
              key={s.id}
              segment={s}
              related={related}
              onChange={(next) => setSegments(segments.map((x) => (x.id === s.id ? next : x)))}
              onRemove={segments.length > 1 ? () => setSegments(segments.filter((x) => x.id !== s.id)) : undefined}
            />
          ))}
          {segments.length < 20 && (
            <button className="secondary" onClick={() => setSegments([...segments, blank()])}>
              <Plus size={16} /> Add another segment
            </button>
          )}
        </div>
      )}
      {step === 2 && (
        <section className="panel form-stack">
          <Field label="Base location" hint="A locality and city, such as “Baner, Pune”, or just a city.">
            <div className="input-row">
              <input value={location} onChange={(e) => { setLocation(e.target.value); setGeo(null); }} onKeyDown={(e) => e.key === "Enter" && resolve()} placeholder="e.g. Baner, Pune" />
              <button className="secondary" disabled={resolving || location.trim().length < 2} onClick={resolve}>
                <MapPin size={15} /> {resolving ? "Checking…" : "Check location"}
              </button>
            </div>
          </Field>
          {geo && (
            <p className="muted">
              Found: {[geo.locality?.name, geo.city?.name, geo.state?.name, geo.country?.name].filter(Boolean).join(" · ")}
              {!geo.locality && " (no locality, so the Locality tier is not offered)"}
            </p>
          )}
          <TierPicker selected={selected} onChange={pickTiers} hasLocality={!!geo?.locality} home={geo?.country?.name || "India"} />
          {selected.includes("locality") && (
            <Field label="Locality radius (km)">
              <input type="number" min={1} max={25} value={localityKm} onChange={(e) => setLocalityKm(Math.min(25, Math.max(1, Number(e.target.value) || 3)))} />
            </Field>
          )}
          {selected.includes("global") && (
            <div>
              <Field label="Global countries" hint={`Each country is searched on its own; ${geo?.country?.name || "India"} has its own tier.`}>
                <input value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} placeholder="Search countries" />
              </Field>
              <div className="chips">
                {countries.map((c) => (
                  <button key={c} className="chip chip-on" onClick={() => setCountries(countries.filter((x) => x !== c))}>
                    {countryList().find((x) => x.code === c)?.name ?? c} <X size={12} />
                  </button>
                ))}
                {countryQuery &&
                  countryMatches.map((c) => (
                    <button key={c.code} className="chip" onClick={() => { setCountries([...countries, c.code]); setCountryQuery(""); }}>
                      <Plus size={12} /> {c.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}
      {step === 3 && (
        <section className="panel form-stack">
          <SplitEditor tiers={tiers} split={split} onChange={setSplit} mode={mode} onMode={setMode} home={geo?.country?.name || "India"} />
        </section>
      )}
      {step === 4 && (
        <section className="panel form-stack">
          <p className="muted">
            Cheap count queries per tier and segment. These are estimates: final numbers come after the reach-out-channel rule and dedupe.
          </p>
          <div className="button-row">
            <button className="secondary" disabled={counting} onClick={runPreview}>
              {counting ? "Counting…" : rows ? "Count again" : "Preview availability"}
            </button>
            <label className="inline-check">
              <input type="checkbox" checked={countOsm} onChange={(e) => setCountOsm(e.target.checked)} /> Also count OpenStreetMap (slower)
            </label>
          </div>
          {counting && progress && (
            <p className="muted" aria-live="polite">
              {progress.label}
              {progress.total ? ` (${progress.done + 1} of ${progress.total})` : ""}…
            </p>
          )}
          {rows && <AvailabilityTable rows={rows} segments={segments} />}
        </section>
      )}
      {errors.length > 0 && tried.includes(step) && (
        <ul className="form-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="button-row wizard-nav">
        <button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={16} /> Back
        </button>
        {step < 4 ? (
          <button
            className="primary"
            aria-disabled={errors.length > 0}
            onClick={() => {
              setTried((t) => [...t, step]);
              if (!errors.length) setStep(step + 1);
            }}
          >
            Next <ArrowRight size={16} />
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => onSave(draft())}>
            <Check size={16} /> Create project
          </button>
        )}
      </div>
    </>
  );
}
