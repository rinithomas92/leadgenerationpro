import { campaignEligible, contactLead, duplicatePlaces, evidenceFields, PLACE_POLICY, type PlaceContact, type PlaceRun, type PlaceSearch, type PlacesSnapshot } from "./places.ts";
import { PlacesError, providerConfig, reserve, searchPlaces, type PlaceEnv } from "./places-providers.ts";
import { loadWorkspace, saveWorkspace } from "./workspace-store.ts";
import { loadSuppression } from "./project-store.ts";
import { isSuppressed, suppressionIndex } from "./suppression.ts";

export async function audit(db:D1Database,owner:string,action:string,subject:string) {
  await db.prepare("INSERT INTO places_audit(owner,id,action,subject,at) VALUES (?,?,?,?,?)").bind(owner,crypto.randomUUID(),action,subject.slice(0,300),new Date().toISOString()).run();
}
type RunRow={id:string;search:string;status:string;count:number;message:string;results:string;created_at:string;updated_at:string};
const runValue=(r:RunRow):PlaceRun=>({id:r.id,search:JSON.parse(r.search),status:r.status,count:r.count,message:r.message,results:JSON.parse(r.results),createdAt:r.created_at,updatedAt:r.updated_at});
export async function getRun(db:D1Database,owner:string,id:string) {
  const r=await db.prepare("SELECT * FROM places_runs WHERE owner=? AND id=?").bind(owner,id).first<RunRow>();
  if(!r)throw new PlacesError("Research run not found.",404);return runValue(r);
}
export async function getContact(db:D1Database,owner:string,id:string) {
  const r=await db.prepare("SELECT data,version FROM places_contacts WHERE owner=? AND id=?").bind(owner,id).first<{data:string;version:number}>();
  if(!r)throw new PlacesError("Contact not found.",404);return {...JSON.parse(r.data),version:r.version} as PlaceContact;
}
export async function placesSnapshot(db:D1Database,owner:string,env:PlaceEnv):Promise<PlacesSnapshot> {
  const expiry=new Date(Date.now()-90*86400000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM places_audit WHERE owner=? AND at<?").bind(owner,expiry),
    db.prepare("DELETE FROM places_requests WHERE owner=? AND at<?").bind(owner,expiry),
    db.prepare("UPDATE places_runs SET results='[]' WHERE owner=? AND updated_at<?").bind(owner,new Date(Date.now()-30*86400000).toISOString()),
    db.prepare("UPDATE places_runs SET status='Interrupted',message='Request ended without a confirmed response. Start a new run; the previous attempt remains counted.' WHERE owner=? AND status='Running' AND updated_at<?").bind(owner,new Date(Date.now()-120000).toISOString()),
  ]);
  const [s,r,c,a]=await Promise.all([
    db.prepare("SELECT data FROM places_searches WHERE owner=? ORDER BY rowid DESC LIMIT 100").bind(owner).all<{data:string}>(),
    db.prepare("SELECT * FROM places_runs WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(owner).all<RunRow>(),
    db.prepare("SELECT data,version FROM places_contacts WHERE owner=? ORDER BY rowid DESC LIMIT 1000").bind(owner).all<{data:string;version:number}>(),
    db.prepare("SELECT action,subject,at FROM places_audit WHERE owner=? ORDER BY at DESC LIMIT 50").bind(owner).all<{action:string;subject:string;at:string}>(),
  ]);
  const providers=await Promise.all((["osm","google","apple"]as const).map(async id=>{const cfg=providerConfig(id,env);const q=await db.prepare("SELECT used FROM places_quota WHERE meter=? AND period=?").bind(id,cfg.period).first<{used:number}>();const operations=await db.prepare("SELECT operation,count(*) AS count FROM places_requests WHERE owner=? AND meter=? AND period=? GROUP BY operation").bind(owner,id,cfg.period).all<{operation:string;count:number}>();return {...cfg,used:q?.used||0,operations:operations.results};}));
  const contacts=c.results.map(v=>({...JSON.parse(v.data),version:v.version})) as PlaceContact[];
  const suppressed=suppressionIndex(await loadSuppression(db,owner));
  return {searches:s.results.map(v=>JSON.parse(v.data)),runs:r.results.map(runValue),contacts,blocked:contacts.filter(c=>isSuppressed(contactLead(c,"","check"),suppressed)).map(c=>c.id),audit:a.results,providers};
}
export async function saveSearch(db:D1Database,owner:string,search:PlaceSearch) {
  const exists=await db.prepare("SELECT id FROM places_searches WHERE owner=? AND id=?").bind(owner,search.id).first();
  const count=await db.prepare("SELECT count(*) AS n FROM places_searches WHERE owner=?").bind(owner).first<{n:number}>();
  if(!exists&&(count?.n||0)>=100)throw new PlacesError("Archive a saved search before adding another (100 maximum).",409);
  await db.prepare("INSERT INTO places_searches(owner,id,data) VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET data=excluded.data").bind(owner,search.id,JSON.stringify(search)).run();
  await audit(db,owner,"search_saved",search.id);
}
export async function startRun(db:D1Database,owner:string,id:string,search:PlaceSearch,env:PlaceEnv) {
  const cfg=providerConfig(search.provider,env);if(!cfg.enabled)throw new PlacesError(cfg.reason,403);
  // Search definitions never contain provider results and are safe to persist.
  await saveSearch(db,owner,search);
  const at=new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO places_runs(owner,id,search,status,created_at,updated_at) VALUES (?,?,?,'Ready',?,?)").bind(owner,id,JSON.stringify(search),at,at).run();
  const run=await getRun(db,owner,id);
  if(JSON.stringify(run.search)!==JSON.stringify(search))throw new PlacesError("This run ID already belongs to a different search.",409);
  return run;
}
export async function executeRun(db:D1Database,owner:string,id:string,env:PlaceEnv,f:typeof fetch=fetch) {
  const run=await getRun(db,owner,id);
  const won=await db.prepare("UPDATE places_runs SET status='Running',updated_at=? WHERE owner=? AND id=? AND status='Ready'").bind(new Date().toISOString(),owner,id).run();
  if(!won.meta.changes)return {run,results:run.results};
  try {
    await reserve(db,owner,run.search.provider,`search-${id}`,env,run.search.provider==="google"?"Text Search Pro":"search");
    await audit(db,owner,"provider_request_dispatched",`${run.search.provider}:search:${id}`);
    // Check cancellation again immediately before dispatch.
    if((await getRun(db,owner,id)).status!=="Running")return {run:await getRun(db,owner,id),results:[]};
    const result=await searchPlaces(run.search,env,f);
    const saved=run.search.provider==="osm"?result.results:[];
    const status=result.results.length?(result.partial?"Partial":"Complete"):"Empty";
    await db.prepare("UPDATE places_runs SET status=?,count=?,message=?,results=?,updated_at=? WHERE owner=? AND id=? AND status='Running'").bind(status,result.results.length,result.message,JSON.stringify(saved),new Date().toISOString(),owner,id).run();
    const final=await getRun(db,owner,id);await audit(db,owner,"run_finished",`${id}:${final.status}`);
    return {run:final,results:final.status==="Cancelled"?[]:result.results};
  } catch(e) {
    const message=e instanceof PlacesError?e.message:"The source did not return in time. Start a new run to retry; the previous attempt remains counted.";
    const status=e instanceof PlacesError&&e.status===429?(message.startsWith("Source")?"Rate limited":"Paused by limit"):"Failed";
    await db.prepare("UPDATE places_runs SET status=?,message=?,updated_at=? WHERE owner=? AND id=? AND status='Running'").bind(status,message,new Date().toISOString(),owner,id).run();
    await audit(db,owner,"run_failed",id);
    return {run:await getRun(db,owner,id),results:[]};
  }
}
export async function cancelRun(db:D1Database,owner:string,id:string) {
  await getRun(db,owner,id);
  await db.prepare("UPDATE places_runs SET status='Cancelled',results='[]',message='Cancelled. An in-flight request may still count toward the limit.',updated_at=? WHERE owner=? AND id=? AND status IN ('Ready','Running')").bind(new Date().toISOString(),owner,id).run();
  await audit(db,owner,"run_cancelled",id);
}
export async function saveContact(db:D1Database,owner:string,c:PlaceContact) {
  const previous=c.version>0?await getContact(db,owner,c.id):undefined;
  if(c.origin==="osm") {
    const run=await getRun(db,owner,c.runId);
    const result=run.search.provider==="osm"&&run.results.find(r=>r.id===c.resultId);
    for(const field of evidenceFields) {
      const evidence=c.fields[field];
      if(evidence.source!=="osm")continue;
      // Previously accepted directory evidence may be retained or archived after
      // its run expires, but cannot be rewritten without a new source.
      if(!result&&previous?.origin==="osm"&&previous.runId===c.runId&&previous.resultId===c.resultId&&JSON.stringify(previous.fields[field])===JSON.stringify(evidence))continue;
      if(!result)throw new PlacesError("The directory evidence expired or is unavailable. Re-run the directory search.",409);
      if(evidence.source==="osm" && (evidence.sourceUrl!==result.source || evidence.value!==String(result[field]??"")))throw new PlacesError("Directory evidence cannot be altered. Add an independent website source for corrected fields.");
    }
  } else if(evidenceFields.some(k=>c.fields[k].source==="osm"))throw new PlacesError("Directory evidence must originate from a directory result.");
  const at=new Date().toISOString();
  if(c.version===0) {
    const count=await db.prepare("SELECT count(*) AS n FROM places_contacts WHERE owner=?").bind(owner).first<{n:number}>();
    if((count?.n||0)>=1000)throw new PlacesError("Contact research limit reached (1000, including archived records). Ask the administrator to review retention and capacity before expanding the workspace.",409);
  }
  const r=c.version===0
    ?await db.prepare("INSERT OR IGNORE INTO places_contacts(owner,id,version,data) VALUES(?,?,1,?)").bind(owner,c.id,JSON.stringify({...c,version:1})).run()
    :await db.prepare("UPDATE places_contacts SET version=version+1,data=? WHERE owner=? AND id=? AND version=?").bind(JSON.stringify({...c,version:c.version+1}),owner,c.id,c.version).run();
  if(!r.meta.changes)throw new PlacesError("This contact changed in another tab. Reload the contact before saving.",409);
  await audit(db,owner,"evidence_saved",`${c.id}:${PLACE_POLICY}:${at}`);
  return getContact(db,owner,c.id);
}
export async function handoff(db:D1Database,owner:string,id:string,campaignId:string,linkId:string,distinctReason:string) {
  const c=await getContact(db,owner,id);
  if(c.archived)throw new PlacesError("Restore this archived contact first.");
  if(!["Published","Manually confirmed"].includes(c.fields.name.status))throw new PlacesError("Review the establishment name before campaign handoff.");
  const snap=await loadWorkspace(db,owner);
  const campaign=snap.state.campaigns.find(c=>c.id===campaignId);
  if(!campaign||!campaignEligible(campaign))throw new PlacesError("Choose an active General or Professional Prospects campaign. Creator Partners and Lead Projects use their own intake workflows.");
  const lead=contactLead(c,campaignId,`places-${id}-${campaignId}`);
  if(!lead.phone&&!lead.email&&!lead.website)throw new PlacesError("Add at least one Published or Manually confirmed contact channel before handoff.");
  const suppressed=suppressionIndex(await loadSuppression(db,owner));
  if(isSuppressed(lead,suppressed))throw new PlacesError("This contact matches the do-not-contact list.",403);
  const existing=await db.prepare("SELECT lead_id FROM places_links WHERE owner=? AND contact_id=? AND campaign_id=?").bind(owner,id,campaignId).first<{lead_id:string}>();
  const already=snap.state.leads.find(l=>l.id===(existing?.lead_id||lead.id));
  if(already)return {leadId:already.id,campaignId,linked:true};
  const duplicates=snap.state.leads.filter(l=>l.campaignId===campaignId&&((c.origin==="osm"&&l.source===`https://www.openstreetmap.org/${c.resultId}`)||duplicatePlaces(lead,l)));
  let target=lead.id;
  if(linkId) {
    const chosen=duplicates.find(l=>l.id===linkId);if(!chosen)throw new PlacesError("Choose one of the current duplicate candidates.");
    if(isSuppressed(chosen,suppressed))throw new PlacesError("The existing lead is on the do-not-contact list.",403);
    target=chosen.id;
  } else {
    if(duplicates.length&&!distinctReason.trim())return {duplicates:duplicates.map(l=>({id:l.id,name:l.name,address:l.location})),campaignId};
    if(distinctReason)lead.notes+=`\nDuplicate review: separate establishment - ${distinctReason}`;
    const saved=await saveWorkspace(db,owner,{state:snap.state,revision:snap.revision,leads:{upsert:[lead],remove:[]}});
    if("error"in saved)throw new PlacesError(saved.error || "Workspace save failed.",saved.status);
  }
  await db.prepare("INSERT INTO places_links(owner,contact_id,campaign_id,lead_id) VALUES(?,?,?,?) ON CONFLICT(owner,contact_id,campaign_id) DO UPDATE SET lead_id=excluded.lead_id").bind(owner,id,campaignId,target).run();
  await audit(db,owner,"handoff_completed",`${id}:${campaignId}:${target}`);
  return {leadId:target,campaignId,linked:!!linkId};
}
export async function eligibleContacts(db:D1Database,owner:string,ids:string[]) {
  const contacts=await Promise.all(ids.map(id=>getContact(db,owner,id)));
  const index=suppressionIndex(await loadSuppression(db,owner));
  return contacts.filter(c=>!c.archived&&!isSuppressed(contactLead(c,"","export"),index));
}
