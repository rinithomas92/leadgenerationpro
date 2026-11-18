"use client";
import { useEffect, useRef, useState } from "react";
import type { InstagramProfile } from "@/lib/instagram";
import { InstagramKeywordSearch } from "./instagram-keyword-search";
type Status = { enabled: boolean; reason: string; cap: number; used: number; period: string; remaining?: number; hourlyCap?: number; hourlyUsed?: number };
export function InstagramDiscovery() {
  const [status, setStatus] = useState<Status>();
  const [username, setUsername] = useState("");
  const [profile, setProfile] = useState<InstagramProfile>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/places/instagram", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(data.error); setStatus(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => { setProfile(undefined); setError("Live profile expired after 15 minutes. Look it up again to refresh."); }, 15 * 60_000);
    return () => clearTimeout(timer);
  }, [profile]);
  async function lookup() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setProfile(undefined);
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/places/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ id: crypto.randomUUID(), username }) });
      const data = await response.json() as { profile: InstagramProfile; status: Status; error?: string };
      if (!response.ok) throw new Error(data.error); setProfile(data.profile); setStatus(data.status);
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally {
      lock.current = false;
      if (!controller.signal.aborted) {
        setBusy(false);
        fetch("/api/places/instagram", { cache: "no-store", signal: controller.signal }).then(async r => { if (r.ok) setStatus(await r.json() as Status); }).catch(() => {});
      }
    }
  }
  return <section className="places-panel"><InstagramKeywordSearch selectUsername={handle => { setUsername(handle); setProfile(undefined); setError(""); document.getElementById("instagram-username")?.focus(); }} /><div className="places-heading"><div><small>INSTAGRAM · PROFESSIONAL ACCOUNTS</small><h2>Look up a specific username</h2><p>Already know the account? Retrieve available professional profile details through Meta.</p></div><strong>{status?.enabled ? "Meta configuration connected" : "Meta setup required"}</strong></div>
    <p className="places-notice">This searches one professional account by username. It does not search by city or radius, access personal accounts, collect private contacts, or send DMs. Emails, phone numbers and street addresses are not provided by this integration.</p>
    <p>{status?.reason || "Checking connection…"}</p>
    {status && <p>{status.used} / {status.cap} application lookups reserved today · {status.period} UTC · {status.hourlyUsed ?? 0} / {status.hourlyCap ?? 60} this UTC hour. Meta feedback can pause lookups earlier.</p>}
    {status && status.used >= status.cap * .8 && <p role="status">Approaching the daily limit. Failed and timed-out requests remain counted.</p>}
    <form onSubmit={e => { e.preventDefault(); void lookup(); }}><div className="places-fields"><label>Instagram username<input id="instagram-username" value={username} onChange={e => setUsername(e.target.value)} placeholder="@businessname" maxLength={31} required autoComplete="off" /></label><button className="places-primary" disabled={busy || !status?.enabled || (status.remaining ?? status.cap - status.used) <= 0}>{busy ? "Looking up profile…" : "Look up professional account"}</button></div></form>
    {error && <p role="alert" className="places-notice">{error}</p>}
    {profile && <article className="places-review"><small>LIVE INSTAGRAM RESEARCH</small><h3>{profile.name || profile.username}</h3><a href={profile.profileUrl} target="_blank" rel="noreferrer">@{profile.username} ↗</a><p style={{ whiteSpace: "pre-wrap" }}>{profile.biography || "Biography not available"}</p><div className="places-stats"><div><strong>{profile.followers?.toLocaleString() ?? "Unknown"}</strong>Followers</div><div><strong>{profile.mediaCount?.toLocaleString() ?? "Unknown"}</strong>Published media</div></div>{profile.website && <a href={profile.website} target="_blank" rel="noreferrer">Published website ↗</a>}<p>Retrieved {new Date(profile.checkedAt).toLocaleString()}. Follower count is not buying intent or permission to contact.</p><p>Live results expire after 15 minutes or when leaving this tab. They are not automatically saved, exported or added to campaigns. Use Saved contacts for separately authorized business evidence; creator outreach belongs in Creator Partners campaigns.</p><button onClick={() => setProfile(undefined)}>Clear profile</button></article>}
    <details><summary>Connection requirements</summary><p>A Meta developer app with Instagram API with Facebook Login; an Instagram Business or Creator account linked to a Facebook Page; your querying Instagram account ID; a Facebook User access token with instagram_basic, instagram_manage_insights and pages_read_engagement; and the Graph API version used by the app. Additional permissions or Advanced Access may be required for your account and users.</p><p>Configure credentials on the server. Do not paste access tokens into this form. If the app requires App Secret Proof, configure its app secret too. Expired or revoked tokens stop lookups; this pilot does not renew tokens automatically.</p><a href="https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery" target="_blank" rel="noreferrer">Meta Business Discovery documentation ↗</a></details>
  </section>;
}
