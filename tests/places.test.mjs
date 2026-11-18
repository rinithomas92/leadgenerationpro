import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { contactSchema, searchSchema, evidenceFields, placesCSV, duplicatePlaces, campaignEligible } from "../lib/places.ts";
import { reserve, providerConfig, searchPlaces } from "../lib/places-providers.ts";
import { startRun, executeRun, getRun, cancelRun, saveContact, getContact, handoff, eligibleContacts } from "../lib/places-store.ts";
import { loadWorkspace, saveWorkspace } from "../lib/workspace-store.ts";
import { newCampaign } from "../lib/leadgen.ts";
import { fetchInstagramProfile, instagramConfig, instagramLookup, lookupInstagram, instagramStatus } from "../lib/instagram.ts";
import { fetchInstagramKeywords, instagramKeywordSchema, instagramProfileURL, keywordConfig, keywordStatus, searchInstagramKeywords } from "../lib/instagram-keyword.ts";
const search = (provider="osm") => searchSchema.parse({ id: crypto.randomUUID(), title: "Pune colleges", category: "Colleges", provider, area: {label:"Pune",lat:18.52,lon:73.85} });
const contact = () => contactSchema.parse({ id:crypto.randomUUID(), origin:"independent", attested:true, fields:Object.fromEntries(evidenceFields.map(k=>[k,{value:({name:"Example College",address:"1 College Road, Pune",email:"office@example.edu",website:"https://example.edu"})[k]||"",sourceUrl:"https://example.edu/contact",source:"official",status:"Published",checkedAt:new Date().toISOString()}])) });
const instagramEnv = { INSTAGRAM_ENABLED:"true", INSTAGRAM_ACCOUNT_ID:"123456", INSTAGRAM_ACCESS_TOKEN:"secret-test-token", INSTAGRAM_GRAPH_VERSION:"v27.0", INSTAGRAM_DAILY_CAP:"2" };
const keywordEnv = { BRAVE_SEARCH_API_KEY:"test-search-secret", INSTAGRAM_KEYWORD_ENABLED:"true", INSTAGRAM_KEYWORD_DAILY_CAP:"2" };
const keywordInput = () => instagramKeywordSchema.parse({id:crypto.randomUUID(),keywords:"makeup artist",location:"Pune"});
test("Instagram keyword results include canonical profiles only and never fabricate account metrics",async()=>{
 assert.equal(keywordConfig({}).enabled,false);
 assert.equal(instagramKeywordSchema.safeParse({...keywordInput(),keywords:"site:evil.com"}).success,false);
 assert.equal(instagramKeywordSchema.safeParse({...keywordInput(),keywords:"   "}).success,false);
 for (const url of ["https://instagram.com/p/ABC/","https://instagram.com/reel/ABC/","https://instagram.com/explore/","https://instagram.com.evil.org/artist/","https://instagram.com@evil.org/artist/","http://instagram.com/artist/","https://www.instagram.com/artist/extra","https://instagram.com:444/artist/"]) assert.equal(instagramProfileURL(url),null,url);
 assert.equal(instagramProfileURL("https://www.instagram.com/Artist.Pune/?ref=x").username,"artist.pune");
 const results=await fetchInstagramKeywords(keywordInput(),keywordEnv,async(url,init)=>{
  assert.equal(url.hostname,"api.search.brave.com");assert.equal(url.searchParams.get("count"),"20");assert.match(url.searchParams.get("q"),/site:instagram.com makeup artist Pune/);
  assert.equal(init.headers["X-Subscription-Token"],"test-search-secret");assert.equal(url.href.includes("test-search-secret"),false);
  return Response.json({web:{results:[{url:"https://www.instagram.com/Artist.Pune/",title:"<strong>Artist</strong>",description:"Public preview"},{url:"https://instagram.com/artist.pune/?ref=x"},{url:"https://instagram.com/p/ABC"},{url:"https://elsewhere.com/artist/"}]}});
 });
 assert.equal(results.accounts.length,1);assert.equal(results.accounts[0].title,"Artist");assert.equal(results.excluded,3);assert.equal("followers" in results.accounts[0],false);
 await assert.rejects(fetchInstagramKeywords(keywordInput(),keywordEnv,async()=>Response.json({secret:"test-search-secret"},{status:401})),e=>e.status===403&&!e.message.includes("test-search-secret"));
 assert.equal((await fetchInstagramKeywords(keywordInput(),keywordEnv,async()=>Response.json({web:{results:[]}}))).accounts.length,0);
});
test("keyword search has a separate atomic cap and retains only safe request metadata",()=>database(async db=>{
 const input=keywordInput();let calls=0;const f=async()=>{calls++;return Response.json({web:{results:[{url:"https://instagram.com/specific_artist/",description:"do not persist this snippet"}]}});};
 await searchInstagramKeywords(db,"a",input,keywordEnv,f);
 await assert.rejects(searchInstagramKeywords(db,"a",input,keywordEnv,f),e=>e.status===409);
 const outcomes=await Promise.allSettled(Array.from({length:4},()=>searchInstagramKeywords(db,"a",keywordInput(),keywordEnv,f)));
 assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);assert.equal(calls,2);
 assert.equal((await keywordStatus(db,keywordEnv)).used,2);assert.equal((await instagramStatus(db,instagramEnv)).used,0);
 assert.equal(JSON.stringify((await db.prepare("SELECT * FROM places_audit").all()).results).includes("specific_artist"),false);
}));
test("Instagram validates handles, gates missing setup, and redacts auth failures",async()=>{
 assert.equal(instagramConfig({}).enabled,false);
 assert.equal(instagramLookup.safeParse({id:crypto.randomUUID(),username:"bad){id}"}).success,false);
 assert.equal(instagramLookup.parse({id:crypto.randomUUID(),username:"@Example.Name"}).username,"example.name");
 await assert.rejects(fetchInstagramProfile("example",{},()=>{throw Error("must not fetch");}),/Not connected/);
 const profile=await fetchInstagramProfile("example",instagramEnv,async(url,init)=>{
  assert.equal(url.hostname,"graph.facebook.com");assert.equal(url.href.includes(instagramEnv.INSTAGRAM_ACCESS_TOKEN),false);
  assert.equal(init.headers.Authorization,"Bearer secret-test-token");
  assert.match(url.searchParams.get("fields"),/business_discovery.username\(example\)/);
  return Response.json({business_discovery:{username:"example",name:"Example",followers_count:0,website:"javascript:alert(1)"}});
 });
 assert.equal(profile.followers,0);assert.equal(profile.mediaCount,null);assert.equal(profile.website,"");assert.equal("email" in profile,false);
 await assert.rejects(fetchInstagramProfile("example",instagramEnv,async()=>Response.json({error:{message:"secret-test-token"}},{status:400})),e=>e.status===403&&!e.message.includes("secret-test-token"));
 await assert.rejects(fetchInstagramProfile("example",instagramEnv,async()=>Response.json({})),e=>e.status===404);
});
test("Instagram attempts are bounded, replay-safe, and never store profile content",()=>database(async db=>{
 const input={id:crypto.randomUUID(),username:"example"};let calls=0;
 const f=async()=>{calls++;return Response.json({business_discovery:{username:"example",biography:"Transient biography"}});};
 await lookupInstagram(db,"a",input,instagramEnv,f);
 await assert.rejects(lookupInstagram(db,"a",input,instagramEnv,f),e=>e.status===409);
 const outcomes=await Promise.allSettled(Array.from({length:4},()=>lookupInstagram(db,"a",{...input,id:crypto.randomUUID()},instagramEnv,f)));
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);assert.equal(calls,2);
 const status=await instagramStatus(db,instagramEnv);assert.equal(status.used,2);assert.equal(JSON.stringify(status).includes("secret-test-token"),false);
 const log=await db.prepare("SELECT * FROM places_audit").all();assert.equal(JSON.stringify(log).includes("Transient biography"),false);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM places_contacts").first()).n,0);
}));
async function database(fn) {
 if(process.env.LEADGEN_TEST_POSTGRES === "true") return (await import("./postgres-database.mjs")).postgresTestDatabase(fn);
 const mf = new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:["DB"],compatibilityDate:"2026-05-15"});
 try {const db=await mf.getD1Database("DB"); for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort()) for(const sql of readFileSync(`drizzle/${file}`,"utf8").split("--> statement-breakpoint")) if(sql.trim())await db.exec(sql.replace(/\r?\n/g," ")); await fn(db);} finally {await mf.dispose();}
}
test("evidence requires independent provenance; CSV does not expose unreviewed fields",()=>{
 const c=contact(); c.fields.email.status="Needs review"; c.fields.name.value="=HYPERLINK(1)";
 assert.equal(placesCSV([c]).includes("office@example.edu"),false); assert.match(placesCSV([c]),/'=HYPERLINK/);
 c.fields.name.sourceUrl="https://maps.google.com/example";assert.equal(contactSchema.safeParse(c).success,false);
 c.fields.name.sourceUrl="";assert.equal(contactSchema.safeParse(c).success,false);
 assert.equal(campaignEligible({...newCampaign(0),audience:"Creator Partners"}),false);
 assert.equal(duplicatePlaces({name:"Branch A",location:"A",website:"https://chain.com",phone:""},{name:"Branch B",location:"B",website:"https://chain.com",phone:""}),false);
});
test("provider gate defaults closed and adapters request only selected data",async()=>{
 assert.equal(providerConfig("google",{}).enabled,false); assert.equal(providerConfig("apple",{}).enabled,false);
 let requests=0; const result=await searchPlaces(search(),{},async(url,init)=>{requests++;assert.match(init.body.toString(),/college/);return Response.json({elements:[{type:"node",id:1,lat:18.5,lon:73.8,tags:{name:"College",website:"javascript:alert(1)"}}]});});
 assert.equal(requests,1);assert.equal(result.results[0].website,"");assert.equal(result.results[0].email,"");
 await searchPlaces(search("google"),{GOOGLE_PLACES_API_KEY:"test"},async(url,init)=>{assert.equal(init.headers["X-Goog-FieldMask"].includes("websiteUri"),false);return Response.json({places:[]});});
 await assert.rejects(searchPlaces(search(),{},async()=>Response.json({elements:[],remark:"runtime error: timeout"})),/did not complete/);
 const partial=await searchPlaces(search(),{},async()=>Response.json({elements:[{type:"node",id:1,tags:{name:"One"}}],remark:"runtime error: timeout"}));assert.equal(partial.partial,true);
});
test("quota reservations cannot exceed a shared cap under concurrency",()=>database(async db=>{
 const outcomes=await Promise.allSettled(Array.from({length:8},(_,i)=>reserve(db,`owner-${i}`,"osm",crypto.randomUUID(),{PLACES_OSM_CAP:"3"})));
 assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,3);
 assert.equal((await db.prepare("SELECT used FROM places_quota").first()).used,3);
}));
test("runs claim once, cancellation prevents dispatch, commercial results never persist",()=>database(async db=>{
 const s=search(), id=crypto.randomUUID(); await startRun(db,"a",id,s,{});let calls=0;
 const f=async()=>{calls++;return Response.json({elements:[{type:"node",id:7,tags:{name:"College"}}]});};
 await Promise.all([executeRun(db,"a",id,{},f),executeRun(db,"a",id,{},f)]);assert.equal(calls,1);
 assert.equal((await getRun(db,"a",id)).results.length,1);await assert.rejects(getRun(db,"b",id),/not found/);
 const cancelled=crypto.randomUUID();await startRun(db,"a",cancelled,s,{});await cancelRun(db,"a",cancelled);await executeRun(db,"a",cancelled,{},f);assert.equal(calls,1);
 const env={GOOGLE_PLACES_API_KEY:"x",GOOGLE_MAPS_BROWSER_KEY:"x",PLACES_GOOGLE_ENABLED:"true",PLACES_GOOGLE_FREE_ALLOWANCE_CONFIRMED:"true",PLACES_GOOGLE_ALLOWANCE_CHECKED_AT:new Date().toISOString()};
 const gid=crypto.randomUUID();await startRun(db,"a",gid,search("google"),env);const live=await executeRun(db,"a",gid,env,async()=>Response.json({places:[{id:"secret-provider-id",displayName:{text:"Live business"}}]}));
 assert.equal(live.results.length,1);assert.deepEqual((await getRun(db,"a",gid)).results,[]);
 const rows=await db.prepare("SELECT * FROM places_runs WHERE id=?").bind(gid).first();assert.equal(JSON.stringify(rows).includes("Live business"),false);
}));
test("contact conflicts, audience validation, duplicate review, suppression and idempotent handoff",()=>database(async db=>{
 const c=await saveContact(db,"a",contact()); await assert.rejects(saveContact(db,"a",{...c,version:0}),/changed/);await assert.rejects(getContact(db,"b",c.id),/not found/);
 const initial=await loadWorkspace(db,"a");const general=newCampaign(0),creator=newCampaign(0,"Gloss","Creator Partners");
 await saveWorkspace(db,"a",{state:{...initial.state,campaigns:[general,creator]},revision:initial.revision,leads:{upsert:[],remove:[]}});
 await assert.rejects(handoff(db,"a",c.id,creator.id,"",""),/Creator Partners/);
 const first=await handoff(db,"a",c.id,general.id,"",""); const second=await handoff(db,"a",c.id,general.id,"","");assert.equal(first.leadId,second.leadId);assert.equal((await loadWorkspace(db,"a")).state.leads.length,1);
 const other=await saveContact(db,"a",contact());const duplicate=await handoff(db,"a",other.id,general.id,"","");assert.equal(duplicate.duplicates.length,1);
 await handoff(db,"a",other.id,general.id,first.leadId,"");assert.equal((await loadWorkspace(db,"a")).state.leads.length,1);
 await db.prepare("INSERT INTO suppression(owner,id,kind,value,reason,origin,created_at) VALUES(?,?,?,?,?,?,?)").bind("a","block","email","office@example.edu","requested","manual",new Date().toISOString()).run();
 await assert.rejects(handoff(db,"a",c.id,general.id,"",""),/do-not-contact/);assert.equal((await eligibleContacts(db,"a",[c.id])).length,0);
}));
