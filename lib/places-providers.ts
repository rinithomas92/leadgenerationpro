import { placeCategories, providerNames, publicUrl, type PlaceProvider, type PlaceResult, type PlaceSearch, type ProviderStatus } from "./places.ts";

export type PlaceEnv = Record<string,string | undefined>;
export class PlacesError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function providerConfig(id: PlaceProvider, env: PlaceEnv): Omit<ProviderStatus,"used"> {
  const period = new Date().toISOString().slice(0, id === "google" ? 7 : 10);
  const cap = Math.max(0,Math.min(id === "google" ? 7000 : id === "apple" ? 25000 : 100, Number(env[`PLACES_${id.toUpperCase()}_CAP`] || (id === "osm" ? 40 : 100)) || 0));
  const credentials = id === "google" ? !!(env.GOOGLE_PLACES_API_KEY && env.GOOGLE_MAPS_BROWSER_KEY) : id === "apple" ? !!(env.APPLE_MAPS_TEAM_ID && env.APPLE_MAPS_KEY_ID && env.APPLE_MAPS_PRIVATE_KEY) : true;
  const checkedAt=env[`PLACES_${id.toUpperCase()}_ALLOWANCE_CHECKED_AT`]||"";
  const age=Date.now()-Date.parse(checkedAt);
  const reconciled=Number.isFinite(age)&&age>=0&&age<86400000;
  const enabled = env.PLACES_DISABLED !== "true" && (id === "osm" || (credentials && reconciled && env[`PLACES_${id.toUpperCase()}_ENABLED`] === "true" && env[`PLACES_${id.toUpperCase()}_FREE_ALLOWANCE_CONFIRMED`] === "true"));
  return { id, name: providerNames[id], enabled, cap, period, checkedAt, reason: env.PLACES_DISABLED === "true" ? "Disabled by the workspace administrator." : id === "osm" ? "Public directory · limited, user-initiated searches · ODbL attribution" : !credentials ? "Not connected. Add server credentials and the compatible map configuration." : !enabled ? "Connection paused. Enable approved live research and reconcile remaining account allowance within the last 24 hours." : "Live research only. Paid usage disabled; account allowance reconciled manually by the owner." };
}
export async function reserve(db: D1Database, owner: string, meter: PlaceProvider, id: string, env: PlaceEnv, operation="search") {
  const c = providerConfig(meter,env);
  if (!c.enabled) throw new PlacesError(c.reason,403);
  await db.prepare("INSERT OR IGNORE INTO places_quota (meter,period,used) VALUES (?,?,0)").bind(meter,c.period).run();
  // A single conditional SQL update serializes concurrent reservations. Lost or
  // timed-out requests remain charged conservatively; no retry refunds.
  const result = await db.prepare("UPDATE places_quota SET used=used+1 WHERE meter=? AND period=? AND used<? RETURNING used").bind(meter,c.period,c.cap).first();
  if (!result) throw new PlacesError("Request limit reached. No paid fallback was started.",429);
  await db.prepare("INSERT INTO places_requests(owner,id,meter,period,at,operation) VALUES (?,?,?,?,?,?)").bind(owner,id,meter,c.period,new Date().toISOString(),operation).run();
}
async function jsonFetch(url: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<Record<string,unknown>> {
  const r = await f(url,{...init,redirect:"error",signal:AbortSignal.timeout(25000)});
  if (!r.ok) throw new PlacesError(r.status === 429 ? "Source rate limited this request. Try later; the attempt remains counted." : `Source unavailable (HTTP ${r.status}). Check connection or retry later.`,r.status === 429 ? 429 : 502);
  if (Number(r.headers.get("content-length") || 0)>3_000_000) throw new PlacesError("Source response exceeded the size limit.",502);
  const reader = r.body?.getReader(); if (!reader) throw new PlacesError("Empty source response.",502);
  const chunks: Uint8Array[]=[]; let bytes=0;
  while (true) { const v=await reader.read(); if(v.done)break; bytes+=v.value.length; if(bytes>3_000_000){await reader.cancel();throw new PlacesError("Source response exceeded the size limit.",502);} chunks.push(v.value); }
  const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
type OSM = { type: string; id: number; lat?: number; lon?: number; center?: {lat:number;lon:number}; tags?: Record<string,string> };
const clean = (v: unknown) => typeof v === "string" ? v.slice(0,300) : "";
function osmURL(env: PlaceEnv) {
  const u=env.PLACES_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
  if(!publicUrl(u))throw new PlacesError("Configure a public HTTPS Overpass endpoint.",503);
  return u;
}
async function overpass(q:string,env:PlaceEnv,f:typeof fetch) {
  return jsonFetch(osmURL(env),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"LeadGenPro/1.0 (user-initiated Places Discovery; openstreetmap.org/copyright)"},body:new URLSearchParams({data:q})},f);
}
export async function resolvePlacesArea(query:string,env:PlaceEnv,f:typeof fetch=fetch) {
  const name=JSON.stringify(query.trim());
  const r=await overpass(`[out:json][timeout:20];(rel[boundary=administrative][name=${name}];nwr[place][name=${name}];);out tags center 12;`,env,f);
  if(r.remark)throw new PlacesError("Area lookup did not complete. The source reported a timeout or execution error.",502);
  return ((r.elements || []) as OSM[]).flatMap(e=>{
    const lat=e.lat??e.center?.lat,lon=e.lon??e.center?.lon;
    if(lat===undefined||lon===undefined)return [];
    return [{label:[e.tags?.name,e.tags?.["addr:state"],e.tags?.["addr:country"],e.tags?.admin_level&&`administrative level ${e.tags.admin_level}`,`${lat.toFixed(3)}, ${lon.toFixed(3)}`].filter(Boolean).join(" · ").slice(0,300),lat,lon,...(e.type==="relation"?{areaId:3600000000+e.id}:{})}];
  });
}
function base(provider:PlaceProvider,s:PlaceSearch): PlaceResult {return {id:"",provider,name:"",category:s.category,address:"",website:"",email:"",phone:"",source:"",checkedAt:new Date().toISOString()};}
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
export async function appleJWT(env:PlaceEnv,origin?:string) {
  const enc=new TextEncoder(),t=Math.floor(Date.now()/1000);
  const header=b64(enc.encode(JSON.stringify({alg:"ES256",kid:env.APPLE_MAPS_KEY_ID,typ:"JWT"})));
  const payload=b64(enc.encode(JSON.stringify({iss:env.APPLE_MAPS_TEAM_ID,iat:t,exp:t+1200,...(origin?{origin}:{})})));
  const pem=(env.APPLE_MAPS_PRIVATE_KEY||"").replaceAll("\\n","\n").replace(/-----[^-]+-----|\s/g,"");
  const key=await crypto.subtle.importKey("pkcs8",Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64(new Uint8Array(sig))}`;
}
let appleAccess: {token:string;until:number;key:string}|undefined;
async function appleToken(env:PlaceEnv,f:typeof fetch) {
  const key=`${env.APPLE_MAPS_TEAM_ID}:${env.APPLE_MAPS_KEY_ID}`;
  if(appleAccess&&appleAccess.key===key&&appleAccess.until>Date.now())return appleAccess.token;
  const data=await jsonFetch("https://maps-api.apple.com/v1/token",{headers:{Authorization:`Bearer ${await appleJWT(env)}`}},f);
  const token=cleanToken(data.accessToken);if(!token)throw new PlacesError("Apple token exchange failed.",502);
  appleAccess={token,key,until:Date.now()+Math.min(Number(data.expiresInSeconds)||300,900)*1000};return token;
}
const cleanToken=(v:unknown)=>typeof v==="string"?v:"";
export async function searchPlaces(s:PlaceSearch,env:PlaceEnv,f:typeof fetch=fetch): Promise<{results:PlaceResult[];message:string;partial:boolean}> {
  if(s.provider==="osm") {
    const tag=placeCategories[s.category];
    const area=s.scope==="area"?`(area:${s.area.areaId})`:`(around:${s.radiusKm*1000},${s.area.lat},${s.area.lon})`;
    const q=`[out:json][timeout:20];nwr["${tag.key}"~"^(${tag.values.join("|")})$"][name]${area};out tags center 101;`;
    const r=await overpass(q,env,f);const rows=(r.elements||[])as OSM[];
    if(r.remark&&!rows.length)throw new PlacesError("Directory lookup did not complete. The source reported a timeout or execution error.",502);
    const results=rows.slice(0,100).filter(e=>e.tags?.name).map(e=>{
      const t=e.tags!;return {...base("osm",s),id:`${e.type}/${e.id}`,name:clean(t.name),address:clean([t["addr:housenumber"],t["addr:street"],t["addr:suburb"],t["addr:city"],t["addr:state"],t["addr:postcode"],t["addr:country"]].filter(Boolean).join(", ")),website:publicUrl(t.website||t["contact:website"]||""),email:clean(t.email||t["contact:email"]),phone:clean(t.phone||t["contact:phone"]),source:`https://www.openstreetmap.org/${e.type}/${e.id}`,lat:e.lat??e.center?.lat,lon:e.lon??e.center?.lon};
    }).filter(r=>!s.keyword||`${r.name} ${r.address}`.toLowerCase().includes(s.keyword.toLowerCase()));
    return {results,partial:rows.length>100||!!r.remark,message:r.remark?"Partial directory response: source execution stopped early. Narrow the area and start a new run to continue.":rows.length>100?"First 100 listings reviewed; narrow the area to research more. This is not an exhaustive directory.":"Directory listings returned. Missing contacts need independent research; coverage is not exhaustive."};
  }
  if(s.provider==="google") {
    const r=await jsonFetch("https://places.googleapis.com/v1/places:searchText",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":env.GOOGLE_PLACES_API_KEY!,"X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions,nextPageToken"},body:JSON.stringify({textQuery:`${s.category} ${s.keyword} in ${s.area.label}`,pageSize:20,locationBias:{circle:{center:{latitude:s.area.lat,longitude:s.area.lon},radius:s.radiusKm*1000}}})},f);
    const results=((r.places||[])as Record<string,unknown>[]).map(p=>({...base("google",s),id:clean(p.id),name:clean((p.displayName as {text?:string})?.text),address:clean(p.formattedAddress),source:publicUrl(clean(p.googleMapsUri)),attributions:((p.attributions||[]) as {provider?:string;providerUri?:string}[]).map(a=>({name:clean(a.provider),url:publicUrl(clean(a.providerUri))})),lat:(p.location as {latitude?:number})?.latitude,lon:(p.location as {longitude?:number})?.longitude}));
    return {results,partial:!!r.nextPageToken,message:"Live Google Maps research, first page only. Location is a search bias, not an exhaustive boundary. Results are not saved or exported."};
  }
  const r=await jsonFetch(`https://maps-api.apple.com/v1/search?${new URLSearchParams({q:`${s.category} ${s.keyword} ${s.area.label}`,searchLocation:`${s.area.lat},${s.area.lon}`})}`,{headers:{Authorization:`Bearer ${await appleToken(env,f)}`}},f);
  const results=((r.results||[])as Record<string,unknown>[]).map((p,i)=>({...base("apple",s),id:clean(p.id)||`result-${i}`,name:clean(p.name),address:clean(((p.formattedAddressLines||[])as string[]).join(", ")),source:"https://maps.apple.com/",lat:(p.coordinate as {latitude?:number})?.latitude,lon:(p.coordinate as {longitude?:number})?.longitude}));
  return {results,partial:true,message:"Live Apple Maps research. Search relevance is provider-controlled; results are not saved or exported."};
}
export async function googleDetail(id:string,env:PlaceEnv,f:typeof fetch=fetch) {
  const r=await jsonFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,{headers:{"X-Goog-Api-Key":env.GOOGLE_PLACES_API_KEY!,"X-Goog-FieldMask":"id,displayName,formattedAddress,location,googleMapsUri,websiteUri,nationalPhoneNumber"}},f);
  return {website:publicUrl(clean(r.websiteUri)),phone:clean(r.nationalPhoneNumber)};
}
