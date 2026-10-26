"use client";
// Map of a project's leads (loaded only when the Map tab opens). Leaflet with
// marker clustering; OpenStreetMap standard tiles with visible attribution.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type * as Leaflet from "leaflet";
import { Choice, formatDate } from "./ui";
import { LeadActions } from "./lead-actions";
import { LeadOutcomePanel, type OutcomeHandlers } from "./lead-outcome";
import { buildMarkers, statusStyles, tierColors, TILE_ATTRIBUTION, TILE_URL } from "@/lib/map-markers";
import { anyProjectFilter, outreachLabels, type ProjectFilter } from "@/lib/lead-filters";
import { tierLabel } from "@/lib/allocation";
import { homeLabel } from "@/lib/ledger";
import { readableCategory } from "@/lib/categories";
import type { ContactEvent, ProjectTemplate, Tier } from "@/lib/project-schema";
import type { Lead, Workspace } from "@/lib/leadgen";
import type { Project } from "./project-details";

type Props = {
  project: Project;
  state: Workspace;
  events: ContactEvent[];
  busy: boolean;
  handlers: OutcomeHandlers;
};
type L = typeof Leaflet;

function Popup({ lead, project, workspace, busy, handlers, onDetails }: { lead: Lead; project: Project; workspace: ProjectTemplate[]; busy: boolean; handlers: OutcomeHandlers; onDetails: () => void }) {
  const p = lead.project!;
  const seg = project.custom.segments.find((s) => s.id === p.segmentId)?.label;
  return (
    <div className="map-popup">
      <b>{lead.name}</b>
      <small>
        {seg} · {p.categories[0] ? readableCategory(p.categories[0]) : lead.industry} · {tierLabel(p.tier, homeLabel(project.custom))}
        {p.distanceKm != null && ` · ${p.distanceKm} km`}
      </small>
      <small>{[lead.phone, lead.email, lead.website, lead.creator?.instagram && `@${lead.creator.instagram}`].filter(Boolean).join(" · ")}</small>
      <small>{outreachLabels[p.outreach.status]}{p.delivery.batch ? ` · Batch ${p.delivery.batch}` : " · not given yet"}</small>
      <LeadActions lead={lead} project={project.custom} workspaceTemplates={workspace} compact busy={busy} onSent={(info) => handlers.onSent(lead, info)} />
      <button className="text-button" onClick={onDetails}>
        Open lead details
      </button>
    </div>
  );
}

export default function ProjectMap({ project, state, events, busy, handlers }: Props) {
  const p = project.custom;
  const home = homeLabel(p);
  const leads = useMemo(() => state.leads.filter((l) => l.campaignId === project.id && l.project), [state.leads, project.id]);
  const [filter, setFilter] = useState<ProjectFilter>(anyProjectFilter);
  const [country, setCountry] = useState("");
  const [selected, setSelected] = useState("");
  const { markers, missing, bounds, countries } = useMemo(() => buildMarkers(leads, filter, country), [leads, filter, country]);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<{ L: L; map: Leaflet.Map; layer: Leaflet.LayerGroup } | null>(null);
  const roots = useRef<Root[]>([]);
  const latest = useRef({ leads, busy, handlers });
  latest.current = { leads, busy, handlers };
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Leaflet and the cluster plugin load on first open only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const L = (await import("leaflet")).default;
        (window as unknown as { L: L }).L = L;
        await import("leaflet.markercluster");
        if (cancelled || !box.current) return;
        const m = L.map(box.current, { preferCanvas: false, worldCopyJump: true });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);
        const base = p.base.locality ?? p.base.city;
        if (base) {
          L.marker([base.lat, base.lon], { title: "Base location", icon: L.divIcon({ className: "", html: '<span class="base-pin" aria-label="Base location"></span>', iconSize: [18, 18] }) })
            .bindTooltip(`Base: ${project.location}`)
            .addTo(m);
          if (p.base.locality && p.tiers.includes("locality"))
            L.circle([p.base.locality.lat, p.base.locality.lon], { radius: p.localityKm * 1000, color: tierColors.locality, weight: 1.5, fillOpacity: 0.05 }).addTo(m);
          m.setView([base.lat, base.lon], 12);
        } else m.setView([20, 78], 4);
        const layer = (L as unknown as { markerClusterGroup: (o: object) => Leaflet.LayerGroup }).markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false });
        layer.addTo(m);
        map.current = { L, map: m, layer };
        setReady(true);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "The map could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      roots.current.forEach((r) => r.unmount());
      map.current?.map.remove();
      map.current = null;
      setReady(false);
    };
    // The map is created once; markers update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers follow the filters; the view fits the filtered leads.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.layer.clearLayers();
    const byId = new Map(leads.map((l) => [l.id, l]));
    for (const mk of markers) {
      const icon = m.L.divIcon({
        className: "",
        html: `<span class="lead-pin" style="background:${mk.color};border-color:${mk.ring};border-style:${mk.dashed ? "dashed" : "solid"}"></span>`,
        iconSize: [16, 16],
      });
      const marker = m.L.marker([mk.lat, mk.lon], { icon, title: byId.get(mk.id)?.name });
      marker.on("click", () => {
        const div = document.createElement("div");
        const root = createRoot(div);
        roots.current.push(root);
        const render = () => {
          const lead = latest.current.leads.find((l) => l.id === mk.id);
          // Rendered synchronously so Leaflet can measure the popup and pan it into view.
          if (lead)
            flushSync(() => root.render(
              <Popup lead={lead} project={project} workspace={state.customTemplates ?? []} busy={latest.current.busy} handlers={latest.current.handlers} onDetails={() => setSelected(mk.id)} />,
            ));
        };
        render();
        const popup = m.L.popup({ maxWidth: 340, minWidth: 260, autoPanPadding: [20, 20] }).setLatLng([mk.lat, mk.lon]).setContent(div).openOn(m.map);
        requestAnimationFrame(() => popup.update());
        m.map.once("popupclose", () => {
          root.unmount();
          roots.current = roots.current.filter((r) => r !== root);
        });
      });
      m.layer.addLayer(marker);
    }
    if (bounds) {
      if (bounds.s === bounds.n && bounds.w === bounds.e) m.map.setView([bounds.s, bounds.w], 15);
      else m.map.fitBounds([[bounds.s, bounds.w], [bounds.n, bounds.e]], { padding: [30, 30], maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, bounds]);

  const set = (k: keyof ProjectFilter) => (v: string) => setFilter({ ...filter, [k]: v === "any" ? "" : v });
  const lead = leads.find((l) => l.id === selected);
  const batches = [...new Map(leads.filter((l) => l.project!.delivery.id).map((l) => [l.project!.delivery.id, l.project!.delivery.batch])).entries()].sort((a, b) => a[1] - b[1]);
  return (
    <div className="form-stack">
      <section className="panel">
        <div className="toolbar filters">
          <Choice label="Tier" value={filter.tier || "any"} onChange={set("tier")} options={[{ value: "any", label: "Any tier" }, ...p.tiers.map((t) => ({ value: t, label: tierLabel(t, home) }))]} />
          <Choice label="Segment" value={filter.segment || "any"} onChange={set("segment")} options={[{ value: "any", label: "Any segment" }, ...p.segments.map((s) => ({ value: s.id, label: s.label }))]} />
          <Choice label="Delivery" value={filter.delivery || "any"} onChange={set("delivery")} options={[{ value: "any", label: "Available or given" }, { value: "available", label: "Available" }, { value: "given", label: "Given" }]} />
          <Choice label="Outreach" value={filter.outreach || "any"} onChange={set("outreach")} options={[{ value: "any", label: "Any outreach" }, ...Object.entries(outreachLabels).map(([value, label]) => ({ value, label }))]} />
          <Choice label="Batch" value={filter.batch || "any"} onChange={set("batch")} options={[{ value: "any", label: "Any batch" }, ...batches.map(([id, n]) => ({ value: id, label: `Batch ${n}` }))]} />
          <label className="inline-check">
            <input type="checkbox" checked={!!filter.hasPhone} onChange={(e) => setFilter({ ...filter, hasPhone: e.target.checked })} /> Has phone
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={!!filter.hasEmail} onChange={(e) => setFilter({ ...filter, hasEmail: e.target.checked })} /> Has email
          </label>
          {countries.length > 0 && (
            <Choice label="Global country" value={country || "all"} onChange={(v) => setCountry(v === "all" ? "" : v)} options={[{ value: "all", label: "All countries" }, ...countries.map((c) => ({ value: c, label: c }))]} />
          )}
        </div>
        {loadError ? (
          <p className="form-error">{loadError}</p>
        ) : (
          <div ref={box} className="project-map" role="region" aria-label={`Map of ${markers.length} leads`} />
        )}
        <div className="map-legend" aria-label="Legend">
          {p.tiers.map((t: Tier) => (
            <span key={t}>
              <i className="lead-pin" style={{ background: tierColors[t], borderColor: "#fff" }} /> {tierLabel(t, home)}
            </span>
          ))}
          {Object.entries(statusStyles).map(([k, s]) => (
            <span key={k}>
              <i className="lead-pin" style={{ background: "transparent", borderColor: s.ring, borderStyle: s.dashed ? "dashed" : "solid" }} /> {s.label}
            </span>
          ))}
          <span>
            <i className="base-pin" /> Base location
          </span>
        </div>
        <p className="muted">
          {markers.length} leads on the map.{" "}
          {missing.length > 0 && `${missing.length} without coordinates are listed below.`} Map data © OpenStreetMap contributors; tiles are for light personal use.
        </p>
      </section>
      {lead && (
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>{lead.name}</h2>
              <p className="muted">
                {lead.project!.address || lead.location} · source: {lead.project!.sources.map((s) => s.name).join(", ")} · checked {formatDate(lead.checkedAt)}
              </p>
            </div>
            <button className="text-button" onClick={() => setSelected("")}>
              Close
            </button>
          </div>
          <LeadOutcomePanel lead={lead} project={p} events={events} workspaceTemplates={state.customTemplates ?? []} busy={busy} handlers={handlers} />
        </section>
      )}
      {missing.length > 0 && (
        <section className="panel">
          <h3>Leads without coordinates ({missing.length})</h3>
          <ul className="notes">
            {missing.slice(0, 200).map((l) => (
              <li key={l.id}>
                <button className="text-button" onClick={() => setSelected(l.id)}>
                  {l.name}
                </button>{" "}
                · {l.project!.sources.map((s) => s.name).join(", ")}
              </li>
            ))}
          </ul>
          {missing.length > 200 && <p className="muted">And {missing.length - 200} more; use the Leads page to see them all.</p>}
        </section>
      )}
    </div>
  );
}
