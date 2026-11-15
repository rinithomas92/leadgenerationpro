"use client";
import { useEffect, useRef, useState } from "react";
import type { PlaceProvider, PlaceResult } from "@/lib/places";
import "leaflet/dist/leaflet.css";

// SDK objects live only in this view. Provider results never enter local storage.
type MapSDK = {
  google?: { maps: { Map: new (node: HTMLElement, options: object) => object; Marker: new (options: object) => { setMap: (map: null) => void } } };
  mapkit?: { addEventListener: (name: string, callback: () => void) => void; removeEventListener: (name: string, callback: () => void) => void; init: (options: { authorizationCallback: (done: (token: string) => void) => void }) => void; Map: new (node: HTMLElement, options: object) => { addAnnotations: (a: object[]) => void; destroy: () => void }; Coordinate: new (lat: number, lon: number) => object; CoordinateRegion: new (centre: object, span: object) => object; CoordinateSpan: new (lat: number, lon: number) => object; MarkerAnnotation: new (coordinate: object, options: object) => object };
};
const scripts = new Map<string, Promise<void>>();
function script(url: string) {
  if (!scripts.has(url)) scripts.set(url, new Promise<void>((resolve, reject) => {
    const el = document.createElement("script"); el.src = url; el.async = true;
    el.onload = () => resolve(); el.onerror = () => { scripts.delete(url); el.remove(); reject(new Error("Map library could not load.")); }; document.head.appendChild(el);
  }));
  return scripts.get(url)!;
}
export default function PlacesMap({ provider, centre, results, ready }: { provider: PlaceProvider; centre: { lat: number; lon: number }; results: PlaceResult[]; ready: (value: boolean) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false; let cleanup = () => {};
    async function load() {
      if (!node.current || !results.length) return;
      if (provider === "osm") {
        const L = await import("leaflet"); if (disposed || !node.current) return;
        const map = L.map(node.current).setView([centre.lat, centre.lon], 12);
        cleanup = () => map.remove();
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(map);
        const bounds: [number, number][] = [];
        for (const r of results) if (r.lat != null && r.lon != null) { const label = document.createElement("span"); label.textContent = r.name; L.circleMarker([r.lat, r.lon], { radius: 6, color: "#24543b", fillOpacity: .8 }).addTo(map).bindPopup(label); bounds.push([r.lat, r.lon]); }
        if (bounds.length) map.fitBounds(bounds, { padding: [25, 25], maxZoom: 15 });
      } else {
        const response = await fetch("/api/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "map", provider }) });
        const config = await response.json() as { error?: string; key: string; token: string }; if (!response.ok) throw new Error(config.error); if (disposed) return;
        const sdk = window as unknown as MapSDK;
        if (provider === "google") {
          await script(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.key)}&v=quarterly`); if (disposed || !node.current || !sdk.google) return;
          const map = new sdk.google.maps.Map(node.current, { center: { lat: centre.lat, lng: centre.lon }, zoom: 12, mapTypeControl: false });
          const markers = results.filter(r => r.lat != null && r.lon != null).map(r => new sdk.google!.maps.Marker({ map, position: { lat: r.lat, lng: r.lon }, title: r.name }));
          cleanup = () => { markers.forEach(m => m.setMap(null)); node.current?.replaceChildren(); };
        } else {
          await script("https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"); if (disposed || !node.current || !sdk.mapkit) return;
          const mk = sdk.mapkit; const failed = () => { if (!disposed) { ready(false); setError("Apple map authorization failed. Check credentials and allowance."); } }; mk.addEventListener("error", failed); mk.init({ authorizationCallback: done => done(config.token) });
          const map = new mk.Map(node.current, { region: new mk.CoordinateRegion(new mk.Coordinate(centre.lat, centre.lon), new mk.CoordinateSpan(.08, .08)) });
          cleanup = () => { mk.removeEventListener("error", failed); map.destroy(); };
          map.addAnnotations(results.filter(r => r.lat != null && r.lon != null).map(r => new mk.MarkerAnnotation(new mk.Coordinate(r.lat!, r.lon!), { title: r.name })));
        }
      }
      if (!disposed) ready(true);
    }
    load().catch(e => { if (!disposed) setError(e.message || "Map unavailable"); });
    return () => { disposed = true; cleanup(); };
  }, [provider, centre.lat, centre.lon, results, ready]);
  if (!results.length) return null;
  return <><div className="places-map" ref={node} aria-label={`${provider} results map`} />{error && <p role="alert">{error} {provider === "apple" ? "Apple results remain hidden until its map is available." : "Source links remain available below."}</p>}</>;
}
