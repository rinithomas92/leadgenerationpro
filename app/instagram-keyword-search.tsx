"use client";
import { useEffect, useRef, useState } from "react";
import type { InstagramKeywordResults } from "@/lib/instagram-keyword";
import { followerRange, withinFollowerRange } from "@/lib/follower-range";
type Status = { enabled: boolean; reason: string; cap: number; used: number; period: string };
export function InstagramKeywordSearch({ selectUsername }: { selectUsername: (username: string) => void }) {
  const [minimumInput, setMinimumInput] = useState("");
  const [limitInput, setLimitInput] = useState("500");
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<Status>();
  const [results, setResults] = useState<InstagramKeywordResults>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false), pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/places/instagram/search", { cache: "no-store", signal: controller.signal }).then(async r => {
      const data = await r.json() as Status & { error?: string }; if (!r.ok) throw new Error(data.error); setStatus(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!results) return;
    const timer = setTimeout(() => { setResults(undefined); setError("Search results expired after 15 minutes. Search again for current matches."); }, 15 * 60_000);
    return () => clearTimeout(timer);
  }, [results]);
  async function search() {
    if (locked.current) return; locked.current = true; setBusy(true); setError(""); setResults(undefined);
    const controller = new AbortController(); pending.current = controller;
    try {
      setCounts({}); setSummary("");
      const range = followerRange(minimumInput, limitInput);

      let remaining = 0;
      if (range.active) {
        const response = await fetch("/api/places/instagram", { cache: "no-store", signal: controller.signal });
        const meta = await response.json() as Status;
        if (!response.ok || !meta.enabled) throw new Error("Connect Instagram lookup before filtering by followers.");
        remaining = Math.max(0, meta.cap - meta.used);
        if (!remaining) throw new Error("Instagram daily lookup cap reached. Try tomorrow or leave both follower limits blank.");
      }
      setProgress("Finding accounts…");
      const r = await fetch("/api/places/instagram/search", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ id: crypto.randomUUID(), keywords, location }) });
      const data = await r.json() as { results: InstagramKeywordResults; status: Status; error?: string };
      if (!r.ok) throw new Error(data.error); setStatus(data.status);
      if (!range.active) setResults(data.results);
      else {
        const matches: InstagramKeywordResults["accounts"] = [], verified: Record<string, number> = {};
        let checked = 0, unavailable = 0, above = 0;
        for (const account of data.results.accounts.slice(0, remaining)) {
          setProgress(`Checking followers: ${checked + 1} / ${Math.min(data.results.accounts.length, remaining)}…`);
          const response = await fetch("/api/places/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ id: crypto.randomUUID(), username: account.username }) });
          checked++;
          const result = await response.json() as { profile?: { followers: number | null } };
          const count = result.profile?.followers;
          if (!response.ok || typeof count !== "number") { unavailable++; if (response.status === 429 || response.status >= 500) break; continue; }
          if (withinFollowerRange(count, range)) { matches.push(account); verified[account.username] = count; } else above++;
        }
        setCounts(verified); setResults({ ...data.results, accounts: matches });
        setSummary(`Verified matches: ${range.min ?? 0}–${range.max ?? "any"} followers (inclusive). ${checked} checked · ${above} outside range · ${unavailable} unavailable · ${data.results.accounts.length - checked} not checked.`);
      }
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { locked.current = false; if (!controller.signal.aborted) {
      setBusy(false); setProgress("");
      fetch("/api/places/instagram/search", { cache: "no-store", signal: controller.signal }).then(async r => { if (r.ok) setStatus(await r.json() as Status); }).catch(() => {});
    } }
  }
  const webQuery = `site:instagram.com ${keywords.trim()} ${location.trim()} -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/`;
  return <section aria-label="Instagram discovery" className="places-review insta-studio">
    <header className="insta-intro"><span className="insta-eyebrow">INSTAGRAM DISCOVERY</span><h2>A smaller audience.<br />A stronger connection.</h2><p>Find the people who fit your next collaboration.</p></header>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <fieldset disabled={busy} className="insta-search"><legend className="insta-sr-only">Search preferences</legend>
        <label>Who are you looking for?<input required value={keywords} onChange={e => setKeywords(e.target.value)} maxLength={120} placeholder="Models, makeup artists, creators…" /></label>
        <label>Where?<input value={location} onChange={e => setLocation(e.target.value)} maxLength={120} placeholder="Any location" /></label>
        <label>Minimum followers<input type="number" min="0" step="1" value={minimumInput} onChange={e => setMinimumInput(e.target.value)} placeholder="No minimum" aria-describedby="insta-filter-help" /></label>
        <label>Maximum followers<input type="number" min="0" step="1" value={limitInput} onChange={e => setLimitInput(e.target.value)} placeholder="Any audience size" aria-describedby="insta-filter-help" /></label>
        <button className="places-primary" disabled={!status?.enabled || status.used >= status.cap || !keywords.trim()}>Find people <span aria-hidden="true">↗</span></button>
      </fieldset>
    </form>
    <div className="insta-presets" aria-label="Suggested audiences">{["Fashion model", "Makeup artist", "Beauty creator", "Hair stylist"].map(term => <button disabled={busy} aria-pressed={keywords === term} key={term} onClick={() => setKeywords(term)}>{term}</button>)}</div>
    <div className="insta-meta"><p id="insta-filter-help">Both limits are inclusive. Leave either blank for no limit on that side.</p><span>{status?.enabled ? `${Math.max(0, status.cap - status.used)} searches left today` : status ? "Connection needed" : "Connecting…"}</span></div>
    {busy && <div className="insta-progress" role="status" aria-live="polite"><span className="insta-pulse" aria-hidden="true" /><div><strong>{progress || "Preparing your search…"}</strong><p>Checking eligible profiles. You can stop at any time.</p></div><button onClick={() => { pending.current?.abort(); setBusy(false); setProgress(""); setError("Search stopped. Completed requests still count toward today's allowance."); }}>Stop search</button></div>}
    {error && <p role="alert" className="places-notice">{error}</p>}
    {status && !status.enabled && <p className="places-notice">{status.reason}</p>}
    {!busy && !results && !error && <div className="insta-empty"><span aria-hidden="true">◎</span><h3>Your next connection starts here.</h3><p>Choose an audience, add a location, and we’ll check the follower counts for you.</p></div>}
    {results && <section aria-label="Search results"><div className="places-heading insta-results-heading"><div><span className="insta-eyebrow">YOUR DISCOVERY</span><h3>{results.accounts.length} {results.accounts.length === 1 ? "match" : "matches"}</h3><p>{results.keywords}{results.location && ` · ${results.location}`}</p></div><button onClick={() => { setResults(undefined); setCounts({}); setSummary(""); }}>Clear results</button></div>
      {summary && <p role="status" className="insta-summary">{summary}</p>}
      {!results.accounts.length && <div className="insta-empty"><h3>No matches in this search.</h3><p>Try another audience, a wider location, or a higher follower limit. This search checks a limited set of publicly indexed profiles.</p></div>}
      <div className="places-results insta-cards">{results.accounts.map(account => <article key={account.username}>
        <div className="insta-card-top"><span className="insta-avatar" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span><span className="insta-badge">{counts[account.username] !== undefined ? "Count verified" : "Web match"}</span></div>
        <h3>@{account.username}</h3><p className="insta-account-title">{account.title}</p>
        {counts[account.username] !== undefined && <p className="insta-count"><strong>{counts[account.username].toLocaleString()}</strong> followers</p>}
        <details><summary>Search preview</summary><p>{account.snippet || "No preview available."}</p><p className="places-muted">From Brave’s web index; not a verified Instagram biography.</p></details>
        <div className="insta-card-actions"><a href={account.profileUrl} target="_blank" rel="noreferrer">Open Instagram ↗</a><button onClick={() => selectUsername(account.username)}>View details</button></div>
      </article>)}</div><p className="places-muted">Checked {new Date(results.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Results clear after 15 minutes or when you leave.</p></section>}
    <details className="insta-about"><summary>How discovery works</summary><p>We find up to 20 public profile links through Brave and verify follower counts with Instagram when a limit is set. Each candidate uses one Instagram lookup, within your daily allowance. Personal or inaccessible accounts cannot be verified. Counts can change.</p><p>Location and profession are search keywords, not verified attributes. Results may include brands or agencies. Review profiles before outreach. Nothing is automatically saved or messaged.</p>{keywords.trim() && <a href={`https://www.google.com/search?q=${encodeURIComponent(webQuery)}`} target="_blank" rel="noreferrer">Search the web instead ↗</a>}</details>
  </section>;
}