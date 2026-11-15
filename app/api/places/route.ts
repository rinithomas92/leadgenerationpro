import { env } from "cloudflare:workers";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, sameOrigin } from "@/lib/server-store";
import { contactSchema, placesCSV, searchSchema, providerSchema } from "@/lib/places";
import { appleJWT, googleDetail, PlacesError, reserve, resolvePlacesArea, type PlaceEnv } from "@/lib/places-providers";
import { audit, cancelRun, eligibleContacts, executeRun, getRun, handoff, placesSnapshot, saveContact, saveSearch, startRun } from "@/lib/places-store";
export const dynamic="force-dynamic";
const id=z.string().uuid();
const requestSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("resolve"),query:z.string().trim().min(2).max(80)}),
  z.object({action:z.literal("save-search"),search:searchSchema}),
  z.object({action:z.literal("delete-search"),id}),
  z.object({action:z.literal("start"),id,search:searchSchema}),
  z.object({action:z.literal("execute"),id}),
  z.object({action:z.literal("cancel"),id}),
  z.object({action:z.literal("save-contact"),contact:contactSchema}),
  z.object({action:z.literal("handoff"),id,campaignId:z.string().max(300),linkId:z.string().max(300).default(""),distinctReason:z.string().max(300).default("")}),
  z.object({action:z.literal("export"),ids:z.array(id).min(1).max(1000)}),
  z.object({action:z.literal("map"),provider:providerSchema}),
  z.object({action:z.literal("detail"),runId:id,placeId:z.string().regex(/^[\w-]{1,250}$/)}),
]);
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){
  const user=await getChatGPTUser();if(!user)return json({error:"Sign in required."},401);
  try{return json(await placesSnapshot(database(),user.userId,env as unknown as PlaceEnv));}
  catch{return json({error:"Places Discovery is unavailable. Apply database migrations and retry."},503);}
}
export async function POST(req:Request){
  const user=await getChatGPTUser();if(!user)return json({error:"Sign in required."},401);
  if(!sameOrigin(req))return json({error:"Invalid request origin."},403);
  try{
    const raw=await req.text();if(raw.length>100000)return json({error:"Request too large."},413);
    const parsed=requestSchema.safeParse(JSON.parse(raw));if(!parsed.success)return json({error:parsed.error.issues[0]?.message||"Invalid request."},400);
    const b=parsed.data,db=database(),owner=user.userId,settings=env as unknown as PlaceEnv;
    if(settings.PLACES_DISABLED==="true")throw new PlacesError("Places Discovery is disabled by the administrator.",403);
    if(b.action==="resolve"){
      const key=`places-area:${b.query.toLowerCase()}`;
      const hit=await db.prepare("SELECT data FROM places_cache WHERE key=? AND expires>?").bind(key,Date.now()).first<{data:string}>();
      if(hit)return json({areas:JSON.parse(hit.data)});
      await reserve(db,owner,"osm",crypto.randomUUID(),settings,"area resolution");
      const areas=await resolvePlacesArea(b.query,settings);
      await db.prepare("INSERT INTO places_cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires").bind(key,JSON.stringify(areas),Date.now()+86400000).run();
      return json({areas});
    }
    if(b.action==="save-search"){await saveSearch(db,owner,b.search);return json({saved:true});}
    if(b.action==="delete-search"){await db.prepare("DELETE FROM places_searches WHERE owner=? AND id=?").bind(owner,b.id).run();await audit(db,owner,"search_deleted",b.id);return json({deleted:true});}
    if(b.action==="start")return json({run:await startRun(db,owner,b.id,b.search,settings)});
    if(b.action==="execute")return json(await executeRun(db,owner,b.id,settings));
    if(b.action==="cancel"){await cancelRun(db,owner,b.id);return json({cancelled:true});}
    if(b.action==="save-contact")return json({contact:await saveContact(db,owner,b.contact)});
    if(b.action==="handoff")return json(await handoff(db,owner,b.id,b.campaignId,b.linkId,b.distinctReason));
    if(b.action==="export"){
      const contacts=await eligibleContacts(db,owner,[...new Set(b.ids)]);
      await audit(db,owner,"export_created",`${contacts.length} eligible contacts; ${b.ids.length-contacts.length} excluded; fields with evidence only`);
      return json({csv:placesCSV(contacts),count:contacts.length,excluded:b.ids.length-contacts.length,manifest:"Published or manually confirmed fields only. Archived and suppressed contacts excluded. No Apple or Google content."});
    }
    if(b.action==="map"){
      if(b.provider==="osm")return json({provider:"osm"});
      await reserve(db,owner,b.provider,crypto.randomUUID(),settings,b.provider==="google"?"Dynamic Maps":"MapKit JS map");
      await audit(db,owner,"map_reserved",b.provider);
      return json(b.provider==="google"?{provider:"google",key:settings.GOOGLE_MAPS_BROWSER_KEY}:{provider:"apple",token:await appleJWT(settings,new URL(req.url).origin)});
    }
    const run=await getRun(db,owner,b.runId);
    if(run.search.provider!=="google")throw new PlacesError("Rich contact details are available through Google research only.");
    await reserve(db,owner,"google",crypto.randomUUID(),settings,"Place Details Enterprise");
    await audit(db,owner,"detail_requested",`${run.id}:Place Details Enterprise`);
    return json(await googleDetail(b.placeId,settings));
  }catch(e){
    if(e instanceof SyntaxError)return json({error:"Invalid JSON."},400);
    if(e instanceof PlacesError)return json({error:e.message},e.status);
    return json({error:"The operation could not complete. Retry after checking source status."},503);
  }
}
