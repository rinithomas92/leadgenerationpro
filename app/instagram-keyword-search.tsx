"use client";
import { useEffect, useRef, useState } from "react";
import type { InstagramKeywordResults } from "@/lib/instagram-keyword";
type Status = { enabled: boolean; reason: string; cap: number; used: number; period: string };
export function InstagramKeywordSearch({ selectUsername }: { selectUsername: (username: string) => void }) {
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
      const r = await fetch("/api/places/instagram/search", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ id: crypto.randomUUID(), keywords, location }) });
      const data = await r.json() as { results: InstagramKeywordResults; status: Status; error?: string };
      if (!r.ok) throw new Error(data.error); setResults(data.results); setStatus(data.status);
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { locked.current = false; if (!controller.signal.aborted) {
      setBusy(false);
      fetch("/api/places/instagram/search", { cache: "no-store", signal: controller.signal }).then(async r => { if (r.ok) setStatus(await r.json() as Status); }).catch(() => {});
    } }
  }
  const webQuery = `site:instagram.com ${keywords.trim()} ${location.trim()} -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/`;
  return <section aria-label="Instagram keyword account search" className="places-review">
    <small>FIND ACCOUNTS · KEYWORD SEARCH</small><h2>Find your next Instagram connection</h2><p>Search for accounts by profession, niche or business name. Add a city to make the search more relevant.</p>
    <form onSubmit={e => { e.preventDefault(); void search(); }}><div className="places-fields">
      <label>Keywords<input required value={keywords} onChange={e => setKeywords(e.target.value)} maxLength={120} placeholder="e.g. bridal makeup artist" /></label>
      <label>Location (optional)<input value={location} onChange={e => setLocation(e.target.value)} maxLength={120} placeholder="e.g. Pune" /></label>
      <button className="places-primary" disabled={busy || !status?.enabled || status.used >= status.cap || !keywords.trim()}>{busy ? "Searching accounts…" : "Search accounts"}</button>
    </div></form>
    <div className="places-actions" aria-label="Suggested keywords">{["Makeup artist", "Hair salon", "Beauty creator", "Bridal studio", "Hospitality institute"].map(term => <button key={term} type="button" onClick={() => setKeywords(term)}>{term}</button>)}</div>
    <p className="places-muted">Matches come from Brave’s public web index, not Instagram’s internal account search. Location is a keyword, not a verified address or radius. Results may be incomplete, stale, or include personal accounts; professional status is unverified.</p>
    <p>{status?.reason || "Checking keyword search connection…"}</p>
    {status && <p>{status.used} / {status.cap} keyword searches reserved today · {status.period} UTC. This is separate from Meta profile lookups; search-plan charges may apply.</p>}
    {status && status.used >= status.cap * .8 && <p role="status">Approaching the daily keyword-search cap. Requests stop at the limit.</p>}
    {keywords.trim() && <a href={`https://www.google.com/search?q=${encodeURIComponent(webQuery)}`} target="_blank" rel="noreferrer">Open external web search ↗</a>}
    {error && <p role="alert" className="places-notice">{error}</p>}
    {results && <div><div className="places-heading"><div><h3>{results.accounts.length} account matches</h3><p>“{results.keywords}”{results.location && ` · ${results.location}`} · first {results.reviewed} web results checked; {results.excluded} duplicates or non-profile links excluded.</p></div><button onClick={() => setResults(undefined)}>Clear results</button></div>
      {!results.accounts.length && <p role="status">No profile links matched in this page of results. Try a broader keyword or remove the location. This does not mean no accounts exist.</p>}
      <div className="places-results">{results.accounts.map(account => <article key={account.username}><small>PUBLIC WEB MATCH · UNVERIFIED</small><h3>{account.title}</h3><a href={account.profileUrl} target="_blank" rel="noreferrer">@{account.username} ↗</a><p>{account.snippet || "No search preview available."}</p><div className="places-actions"><button onClick={() => selectUsername(account.username)}>Use in username lookup</button></div><p className="places-muted">Search preview from Brave · not a verified Instagram biography</p></article>)}</div>
      <p className="places-muted">Retrieved {new Date(results.checkedAt).toLocaleString()}. Results expire in 15 minutes or when leaving this tab. No accounts are automatically saved, exported or messaged.</p></div>}
    <details><summary>Enable in-app keyword results</summary><p>Configure BRAVE_SEARCH_API_KEY and INSTAGRAM_KEYWORD_ENABLED=true on the server. Set INSTAGRAM_KEYWORD_DAILY_CAP to an appropriate limit for your search plan. Meta credentials are used separately when looking up a chosen professional account.</p></details>
  </section>;
}
