# LeadGen Pro

A focused workspace for discovering relevant leads, managing campaigns and preparing outreach. It includes **custom lead projects** for any kind of business, and a **Gloss workflow** for finding beauty, creative and hospitality professionals and creator partners in **Pune and Maharashtra**.

Built with React 19, TypeScript, Vinext/Vite and Cloudflare D1. No API keys are required.

## What works

- **Campaigns:** create, edit, pause and archive campaigns with selected target markets.
- **Custom lead projects:** leads for any business from open data (Overture Maps, OpenStreetMap, Wikidata), delivered in batches split across reach tiers, with a Given ledger, templates, a map and outcome tracking. See [Custom lead projects](#custom-lead-projects).
- **Automatic Gloss lead generation:** a new Gloss campaign finds leads immediately, then refreshes daily to keep them current.
- **Open public sources:** discovery uses OpenStreetMap and Wikidata, and every lead keeps its source link.
- **Reachable leads only:** every outlet with at least one reach-out channel is kept, with no caps.
- **Lead management:** import any number of leads by CSV, deduplicate within a campaign, filter, and manage stages in paged table or pipeline views.
- **Lead details:** save notes, tags, campaign assignments and follow-up reminders.
- **Outreach drafts:** write drafts for Instagram DM, Email, WhatsApp, Phone and Follow-up, and save reusable templates. Nothing is sent automatically.
- **Excel per campaign:** download a complete workbook for any campaign.
- **Insights:** stage-based analytics, creator breakdowns and a full workspace export.
- **Persistence:** each signed-in user's data is stored in D1, with revision checks that prevent silent overwrites across tabs.

Email, WhatsApp and Instagram sending, scheduled delivery and reply sync are **not connected**. Send reviewed drafts from your own accounts and record replies manually. Fit scores are transparent rule-based checklists, not buying intent or conversion predictions. The app never adds fictional or sample records.

## Gloss workflow

Start from the **Gloss creator outreach** card on the Dashboard, or pick a target audience when creating a campaign from the Gloss template.

### Campaign audiences

Creator partners and customer prospects are kept in separate campaigns, and the server rejects saves that mix them.

| Audience | Holds | Partnership type |
| --- | --- | --- |
| **Creator Partners** | Creators and influencers who could introduce Gloss to their audience (creator leads only) | Creator Partner or Both |
| **Professional Prospects** | Makeup artists, hairstylists, nail artists, bridal studios, models, creative freelancers and hospitality outlets that may become Gloss customers | Starter Prospect or Both |

A Gloss campaign sets the following:
- **Professions.** Presets: Makeup Artist, Hairstylist, Nail Artist, Bridal Makeup Artist, Beauty Creator, Model, Creative Freelancer and Chef / Hospitality. Makeup artists and hairstylists are the default launch focus, as in the PRD.
- **Location,** for example `Pune` or `Baner, Pune`.
- **Preferred platforms.**
- **Follower range,** for creators.
- **Keywords.**
- **Automatic refresh interval:** off, daily (the default), weekly or monthly.
- **Starter offer wording in drafts:** include it marked as proposed (the default), include it as confirmed terms, or leave pricing out.
- **Optional partner commission terms.**

### Automatic discovery: Pune and Maharashtra

Discovery searches in this order:

1. **Locality**, if the location names one (for example Baner), within a 3 km radius.
2. **City:** Pune (the Pune District area on OpenStreetMap).
3. **State:** the rest of Maharashtra, excluding results already found in Pune.

It runs:
- **automatically** when a Gloss campaign is created;
- **automatically** when the app is opened and the campaign's last run is older than its refresh interval;
- **on demand**, from **Run discovery / Refresh discovery** on the Leads page or in the campaign details.

A Pune and Maharashtra run usually takes a few minutes. Progress is saved after each tier, so a page reload keeps everything found so far.

### Sources

| Source | What it finds |
| --- | --- |
| **OpenStreetMap** (Overpass API, ODbL) | Beauty and hair salons, makeup, bridal, nail and mehendi studios, photographers, talent agencies, restaurants and hotels. Includes any phone, email, website and Instagram, Facebook, YouTube or TikTok links that mappers have published. |
| **Wikidata** (CC0) | Notable makeup artists, cosmetologists, hairstylists, nail technicians, estheticians, models, beauty and fashion bloggers and influencers, photographers, fashion designers and chefs with published Instagram, YouTube, TikTok, Facebook, LinkedIn or website identifiers. |
| **Nominatim** | Location lookup when the Overpass servers are unavailable. |

Instagram, TikTok, YouTube, LinkedIn and Facebook offer no public search without an account or API key, so they are **never searched or scraped**. Their links are kept whenever a source publishes them. To find other profiles, use **Open Search** (Leads → Creators), which opens public search pages in a new tab, then **Add creator**.

### Rules for every run

- **Reachable outlets only, and all of them.** A lead is added when it has at least one channel: phone, email, website, Instagram, Facebook, YouTube, TikTok or LinkedIn. The source report counts the listings left out for having no channel. There are no result caps.
- **No duplicates.** Leads are matched by source record, profile URL, Instagram handle, website, or name plus location. Separate branches of a chain are kept as separate outlets.
- **Refresh, don't overwrite.** A repeat run re-confirms existing leads: it updates their **Last Source Check** date and fills empty contact fields. It never changes your stages, notes or edits.
- **Every search is reported.** Each campaign keeps a source report listing every source and area searched, with status, counts and notes. Failures are never hidden or replaced with sample data.
- **Reliability.** Each OpenStreetMap search retries, waits out rate limits and fails over to mirror servers within a time budget. If a nearer search keeps failing, wider searches from that source are postponed, so Pune results always come first.

### Creators added manually or by CSV

- **Add creator** records what is publicly visible: name, profession, location, platform links, follower count, engagement, contacts, and an optional photo URL you are permitted to use.
- **Import creators** accepts any number of rows and re-imports Gloss Excel/CSV exports. Duplicates are skipped by Instagram handle or profile URL.
- Every creator needs at least one valid public profile. Platform links must be on the platform's own domain. Use **I checked this public profile today** to record when you verified one.

Instagram is the primary platform. Handles are shown as `@handle` with a prominent **Open Instagram** action; other profiles show **Open profile**.

### Fit score (creators)

A rule-based checklist out of 100:

| Criterion | Points |
| --- | --- |
| Profession relevance | 25 |
| Location | 20 |
| Valid public profile | 20 |
| Source link and manual verification | 15 |
| Follower range | 10 |
| Profile completeness | 10 |

It is not a conversion probability or a performance prediction.

### Outreach (draft only)

There are separate templates for **creator partnership** and **Starter prospect** outreach:
- **Creator partnership** drafts never promise income, jobs, bookings, enquiries or results. Commission is mentioned only if you enter partner terms on the campaign.
- **Starter prospect** drafts include the ₹199 / 12-month offer only when the campaign includes it. When it's set to proposed, the draft labels it as proposed pricing that is not final yet.

### Excel workbooks

**Every campaign has its own workbook,** generated from all of its saved leads. Download it from:
- the Excel column on the Campaigns page;
- the campaign details;
- the discovery panel;
- the prompt shown after each discovery run.

It has three sheets:
- **Leads:** nearest tier first, with every detail. The columns are Name, Profession, Location, Instagram Handle, Instagram URL, Primary Contact Platform, TikTok URL, YouTube URL, LinkedIn URL, Facebook URL, Website / Portfolio, Followers, Engagement, Gloss Fit Score, Fit Reasons, Lead Type, Partnership Type, Source URL, Outreach Status, Last Contacted, Follow-up Date, Notes, Email, Phone, Category, Source Name, Discovery Area, Last Verified and Last Source Check.
- **Discovery report:** every source and area searched.
- **Campaign:** the campaign settings plus counts of leads with a phone, email, website and Instagram.

**Formula protection:** text that could run as a spreadsheet formula (starting with `=`, `+`, `-` or `@`) gets a leading apostrophe. Plain Instagram handles such as `@username` and plain phone numbers are left readable. The Leads page **Export Excel** button exports the currently filtered view, and the original business CSV export is unchanged.

To write every campaign's workbook from the local database into `exports/` (which Git ignores, because it contains contact details):

```sh
node --experimental-strip-types scripts/export-campaigns.mjs
```

## Custom lead projects

Lead projects generate leads for **any kind of business**, not just Gloss. Describe the business, list the kinds of leads you want, pick a location and reach, and receive leads in batches split across reach tiers. Everything is free and rule-based: no AI, no API keys and no paid services.

Start from **New lead project** on the Dashboard or the **Lead Projects** page. Gloss campaigns are unchanged; a lead project is a separate kind of campaign.

### The brief (5 steps)

1. **Business:** a project name, a 2–3 line description (20–400 characters) and an optional website.
2. **Segments:** as many kinds of leads as you want, for example "Real-estate developers", "Architects", "Furniture showrooms".
   - As you type, matching categories appear as chips. Confirm or remove them before saving.
   - Categories come from **Overture's places taxonomy** (2,131 categories, `lib/overture-taxonomy.json`). A hand-curated synonym file (`lib/category-synonyms.json`, 250+ Indian and English terms such as "CA", "kirana", "PG" and "coaching") and typo-tolerant search (Fuse.js) help find them.
   - Keywords from your description are offered as related categories.
   - Optional include and exclude keywords filter by name.
   - Terms for private individuals (students, parents, homeowners, customers, people) show a warning with business stand-ins, because open place data lists businesses, not people.
3. **Location and reach:** a base location such as `Baner, Pune`, and reach tiers, nearest first:

   | Tier | Area |
   | --- | --- |
   | **Locality** | a radius around the locality (3 km by default); offered only when the location names a locality |
   | **City** | 20 km around the city centre, excluding the locality |
   | **State** | the rest of the state |
   | **India** (your country) | the rest of the country |
   | **Global** | countries you choose, searched one at a time; never the whole world, and never your own country |

   Each wider tier leaves out places in nearer tiers, so every lead belongs to exactly one tier.
4. **Tier split:** a percentage per tier in 5% steps, totalling 100%. The defaults are 100, 70/30, 50/30/20, 40/30/20/10 and 35/25/20/12/8. Alternatively, **Nearest first** fills tiers in order.
5. **Availability:** estimated counts per tier and segment from cheap count queries. Final numbers come after the reach-out-channel rule and dedupe.

### Lead project sources

| Source | Used for | Licence |
| --- | --- | --- |
| **Overture Maps Places** (local extracts, DuckDB) | the main bulk source for every tier | CDLA-Permissive-2.0 or Apache-2.0, per source record |
| **OpenStreetMap** (Overpass) | Locality, City and State (district by district); India and Global only when the sources service is offline | ODbL |
| **Wikidata** | segments whose categories map to occupations (for example architects or photographers) | CC0 |
| **Business websites** | optional enrichment: the homepage and one contact page, for `mailto:` emails, `tel:` numbers and social profile links | the site's own content; each value stores the page it came from |

The Overture Places theme contains no OpenStreetMap data, so ODbL applies to OpenStreetMap-derived rows, and possibly to exports that combine them. Instagram, LinkedIn, Facebook, TikTok, YouTube, Google Maps, JustDial and IndiaMART are **never searched or scraped**; their links are kept only when an open source publishes them.

**Rules for every run:**
- **Reachable only:** a lead needs at least one channel (phone, email, website, Instagram, Facebook, YouTube, TikTok or LinkedIn). Listings without one, and places marked closed or disused, are counted in the source report.
- **One lead per place:** records from Overture, OpenStreetMap and Wikidata merge when they share a source id, a normalised name within about 100 m, or a phone, website domain or Instagram handle within 250 m. Every source link is kept, and branches of a chain stay separate.
- **Fit score:** a transparent 100-point checklist covering segment category 30, keywords 15, distance within the tier 20, reach-out channels 20, and source confidence and recency 15. It is not a prediction of replies or sales.
- **Do-not-contact list:** checked during discovery and delivery (see below).
- **Every search is reported:** failures appear in the source report and are never hidden.

### The sources service and place data (not included in the repository)

**The place data is not in Git.** `data/` is ignored, because the data runs to several GB and GitHub rejects files over 100 MB. After cloning, each person downloads it once on their own computer, as below. Until they do, lead projects still work with OpenStreetMap and Wikidata only, which finds far fewer leads, and the project page says so.

Overture data is queried locally with DuckDB through a small service bound to `127.0.0.1:5188`.

```sh
npm install
npm run overture:extract                # India only: about 470 MB, 20–30 minutes
npm run overture:extract -- AE GB       # specific countries, for the Global tier
npm run overture:extract -- --all       # every country: about 9 GB, around 5–6 hours
npm run sources                         # start the service; keep it running while you use the app
```

- **Worldwide download (`--all`):** it reads Overture's 16 source files one at a time and keeps its progress in `data/overture/<release>/_staging`. If it stops (network drop, sleep, closed terminal), run the same command again and it resumes where it stopped. If it keeps failing on "Could not resolve hostname" while your internet works, stop it and run it again: a fresh process resumes from the saved progress. Keep the computer awake while it runs, and have about 20 GB of free disk during the download (the staging copy is removed at the end). Each country is usable as soon as it has been sorted into its own file, and the last step (sorting each country by location so searches are fast) takes one to two hours.
- **Where it is saved:** `data/overture/<release>/<country>.parquet`, which Git ignores. Re-run the command, or press **Update** under **Data quality** on a project, to move to Overture's newest monthly release. Overture publishes monthly and the places themselves can be older than the release, so check leads before sending (the Data quality checks and each lead's source date help).
- `npm run overture:taxonomy` regenerates the category list and country list from a release.
- Optional second source, Foursquare Open Source Places (Apache-2.0): it is gated on Hugging Face, so sign in at <https://huggingface.co/datasets/foursquare/fsq-os-places>, accept the terms and create a read token. Put the token on its own line as `HF_TOKEN=hf_...` in `.env.local` (Git-ignored), or set it in your shell (`$env:HF_TOKEN = "hf_..."` on PowerShell), then run `npm run fsq:extract` (India only takes about an hour) or `-- AE GB` for other countries. The extract is reshaped into the Overture layout in `data/foursquare/` (Git-ignored); restart `npm run sources` and discovery searches it alongside Overture. Places found by both merge into one lead.
- Foursquare worldwide is possible with `npm run fsq:extract -- --all`, but it is slow (many hours) and Overture already covers most places, so India only is the recommended setup. If the category matching improves later, `npm run fsq:remap` re-maps an existing extract without downloading again.
- The service answers only the app's own origins (`http://127.0.0.1:5187`, `http://localhost:5187`). Add more with `LEADGEN_ORIGINS=http://127.0.0.1:5190`.
- Email checks use DNS MX lookups. If your system's DNS refuses them, the service falls back to public resolvers (1.1.1.1, 9.9.9.9). Set `LEADGEN_DNS=192.168.0.1` to choose your own.

### Batches and the Given ledger

**Generate batch** hands out 50, 100, 250, 500, 1,000, 2,500 or 5,000 leads.

- **Allocation:** each tier's share uses largest-remainder rounding, so the shares sum exactly to the batch size.
  - A tier that is short spills to the next tier outward, and inward when there is nothing further out.
  - Within a tier, segments take turns (round-robin), best fit first, then nearest.
  - **Nearest first** mode fills Locality, City, State, India and Global in order.
- **Short pool:** if any tier is short of its share, discovery first runs for the tiers and segments that still have places. It continues from saved cursors, so nothing is fetched twice. If the pool is still short, the batch says exactly what was delivered and why, for example "Locality exhausted for Cafés; 12 moved to City".
- **Given:** delivered leads are marked **Given** in the same database batch as the delivery record and the workspace revision check, so a stale tab cannot deliver twice. A Given lead is never delivered again, and re-discovery never resets it.
- **Undo:** only the latest batch can be undone, and only before any of its leads has been contacted.
- **Workbooks:** each batch has its own workbook `<project>-batch-<n>-<date>.xlsx`, with a Summary sheet, one sheet per tier that has leads (Global sorted by country) and All leads. The **master workbook** has every lead with Delivery Status, Batch #, Given At and outcome columns, plus Outcomes, Batches and Project sheets.

### Outreach templates

Each project has a sender profile (your name, business, one-line pitch, website, phone, offer and call to action) and templates for WhatsApp, Email, Instagram DM, Call script, Follow-up 1 and Follow-up 2.

| Placeholder | Filled from |
| --- | --- |
| `{business_name}`, `{segment}`, `{category}` | the lead's name, segment label and main category |
| `{area}` | the lead's locality, or its city |
| `{city}`, `{state}`, `{country}`, `{website}` | the lead's address and website |
| `{distance_km}` | distance from your base location, rounded |
| `{my_name}`, `{my_business}`, `{my_pitch}`, `{my_website}`, `{my_phone}` | the sender profile |
| `{offer}`, `{cta}` | the sender profile |

- **Syntax:**
  - `{area|your area}` sets a fallback;
  - `{{` and `}}` are literal braces;
  - a line holding only an empty optional placeholder, such as `{offer|}`, is dropped.
- **Missing values:** a placeholder with no value is highlighted in the preview, typos are flagged while editing, and Copy and Open stay disabled until they are fixed.
- **Lookup order:** segment template → project default → workspace default → built-in starter. Each template keeps a version number, so outcomes compare per version.
- **Starters:** they never promise results, income, bookings or prices, mention the offer only through `{offer}`, and include an opt-out line in Email and the follow-ups.
- **Actions** only open apps; you always press send:
  - Copy;
  - Open WhatsApp (`wa.me`, for mobile numbers only);
  - Open email (`mailto:`; links over about 1,800 characters fall back to Copy);
  - Open Instagram (copies the draft first);
  - Call (`tel:` plus the call script).
- **Batch drafts:** **Prepare drafts for a batch** fills templates for every lead in a batch and adds draft columns to its workbook.

### Outcome tracking

- **Statuses:**
  - Main path: Not contacted → Contacted → Replied → Interested → Meeting / call booked → Won.
  - Exits: Not interested, No response, Bad contact and Do not contact.
  - Each status keeps the app's existing stages in step, so the Pipeline and Insights include project leads.
- **Mark as sent** records a contact event (channel, template and version, time), sets the lead to Contacted and schedules Follow-up 1 after 3 days (configurable), then Follow-up 2. **Log reply** records the channel and an optional note.
- **Do not contact** adds the lead's phone, email, website domain and Instagram handle to the workspace **do-not-contact list**. The list can also take manual entries and CSV imports (for existing clients, competitors and opt-outs). Matching places are never added or delivered, and each batch reports how many were left out.
- **No response:** the Follow-ups page suggests marking a lead No response when it was contacted, has no reply, and has had no contact for 7 days (configurable) after its last follow-up. Nothing changes until you choose.
- **Outcomes:**
  - a funnel (given → contacted → replied → interested → meeting → won);
  - contact, reply, interested and win rates, and median time to first reply;
  - breakdowns by tier, segment, channel, template version, batch and source, including bad-contact rate by source.
  
  They appear on the project's Outcomes tab, on Insights and in the master workbook. Hints such as "City tier reply rate 18% vs Locality 9%" appear only when every compared group has at least 30 contacted leads, and they never change settings.

### Map

The Map tab shows the base location, the locality radius and every lead with coordinates:
- marker colour shows the tier, and the outline shows the status;
- clustering keeps thousands of markers fast;
- it has the same filters as the Leads page, and Global leads can be viewed one country at a time;
- clicking a marker shows the lead with the template actions and Mark as sent;
- leads without coordinates are listed under the map.

Leaflet loads only when the Map tab opens. Tiles come from OpenStreetMap's standard tile server under its [usage policy](https://operations.osmfoundation.org/policies/tiles/): visible attribution, no bulk downloading or prefetching, light personal use only. Change `TILE_URL` in `lib/map-markers.ts` to use another provider.

### Data quality

On each project, **Data quality** offers:
- **Contact checks:** email syntax plus a DNS MX lookup (`valid domain`, `no mail server` or `invalid`). A failed lookup stores nothing, and no probe email is ever sent. Websites are checked with HEAD (GET as a fallback): `live`, `redirects`, `dead` or `timeout`.
- **Re-check stale leads:** leads last confirmed more than 90 days ago are looked up again by their Overture or OpenStreetMap record id. Found records are refreshed. Records no longer listed, or now marked closed, are noted on the lead, never removed.
- **Overture data:** the release of each extract, the newest release available, and an **Update** button.

## Run locally

Requires **Node.js 22.13 or newer** (Node 24 recommended) and npm. Works on Windows, macOS and Linux.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5187. Sign-in uses a development-only local identity on loopback. Local records live in `.wrangler/state/` and survive restarts. The database and credentials are not committed to Git.

`db:migrate` applies the versioned migrations: `0001_lead_rows` stores leads in their own table, and `0002_custom_projects` adds the lead-project columns (generated from each lead's data, so nothing is rewritten) and the `deliveries`, `contact_events` and `suppression` tables. Both are additive. It is safe on an existing local database: workspaces saved earlier are moved into the new table automatically the first time they load. Do not delete `.wrangler/state` to initialise the project.

To use another port:

```sh
npm run dev -- --port 5190
```

Keep the app open for automatic discovery and daily refresh, because both run in the browser.

### Optional AI drafts

Templates work without any key. To enable AI-written drafts:
1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` and `OPENAI_MODEL`. The model must support Responses structured output.
3. Restart the development server.

Never commit `.env`. AI drafts follow the same Gloss wording rules and must be reviewed before use.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:worker
```

- **`tests/leadgen.test.mjs`:** CSV parsing and formula safety, deduplication, stage history, validation and reminders.
- **`tests/gloss.test.mjs`:** legacy-workspace compatibility, handle and URL validation, creator deduplication, scoring, CSV/Excel round trips, draft wording rules and audience separation.
- **`tests/discovery.test.mjs`:**
  - location resolution and fallbacks;
  - the Pune → Maharashtra plan;
  - uncapped queries and paging;
  - the reach-out-channel rule and branch deduplication;
  - retries, rate limits and postponement;
  - progress checkpoints and the per-campaign workbook.
- **`tests/worker-smoke.mjs`:** runs the built Worker against an isolated in-memory D1 database. It covers:
  - sign-in, saving, and protection against stale saves;
  - 2,500-lead campaigns stored as rows, change-only saves and deletes;
  - the Excel export endpoint;
  - creator rules;
  - moving a legacy workspace's leads into the new table;
  - lead projects: three batches with no lead given twice, a stale tab refused, a save never resetting Given, undo of the latest batch only, contact events, do-not-contact CSV import, and the batch and master workbooks.
- **`tests/custom-projects.test.mjs`:**
  - the wizard rules, synonym and fuzzy category search, the private-individual warning, and the Global tier rules;
  - allocation (largest remainder, 50/30/20, spill outward then inward, round-robin, nearest first), the Given ledger and the batch sizes;
  - dedupe across Overture, OpenStreetMap and Wikidata, and phones and the do-not-contact list;
  - workbooks, templates (placeholders, fallbacks, braces, lookup order, Marathi, Hindi and emoji link encoding), outcome tracking, the map marker builder and stale re-checks.
- **`tests/project-discovery.test.mjs`:** the Overpass query builder, result mapping, tier plans, pool top-up with cursors, robots.txt, contact-page extraction and enrichment safety.
- **`tests/sources-service.test.mjs`:** the sources service against a tiny Parquet file written by DuckDB, with no network: counts, tiers that never overlap (including records with only a PIN code), paging, origins, email and website checks, lookup by id and update status.

To try lead-project discovery against the live sources from a terminal (Overture is used when `npm run sources` is running):

```sh
node --experimental-strip-types scripts/project-probe.mjs "Baner, Pune" --segment "Architects" --tiers locality,city,state
```

To check discovery against the live public sources:

```sh
node --experimental-strip-types scripts/discovery-probe.mjs "Baner, Pune" --xlsx baner.xlsx
```

Preview the built Worker (without development sign-in):

```sh
npm start
```

Production identity headers must come from a trusted authentication gateway; the app is configured for Sites authentication. Never expose a raw Worker that accepts untrusted identity headers.

## Data storage

- **Leads** are stored one row each in the D1 `leads` table, so a campaign can hold any number of them.
- **The workspace document** holds campaigns, drafts, templates and settings.
- **Saves are change-only.** A save sends the document plus only the leads that changed, written in one batch together with the revision check. A stale save from another tab never writes its leads.
- **Lead projects** keep their brief, segments, templates, sender profile and discovery cursors in the workspace document. Each lead's project fields stay in its JSON; `0002_custom_projects` exposes them as generated columns with indexes. Batches (`deliveries`), `contact_events` and the do-not-contact list (`suppression`) have their own tables. A lead's Given state changes only through the delivery endpoints.

## Project structure

- `app/dashboard.tsx`: overview, Gloss quick start, campaign shortcuts and next actions
- `app/campaigns.tsx`: campaign brief, Gloss settings, market selection and campaign details
- `app/leads.tsx`: Businesses / Creators views, CSV import, filters, paging, pipeline and lead details
- `app/creators.tsx`: creator form, Add creator, Open Search and profile actions
- `app/discovery-panel.tsx`: Run/Refresh discovery, progress, source report and the Excel link
- `app/outreach.tsx`: editable drafts and templates with a searchable lead picker
- `app/follow-ups.tsx`: saved reminders
- `app/insights.tsx`: analytics and workspace settings
- `app/projects.tsx`, `app/project-wizard.tsx`, `app/project-details.tsx`, `app/project-parts.tsx`: Lead Projects page, the 5-step brief, pool, batches, split, availability and source report
- `app/project-outreach.tsx`, `app/lead-actions.tsx`, `app/lead-outcome.tsx`: templates, sender profile, draft preview and actions, statuses and replies
- `app/project-outcomes.tsx`, `app/project-map.tsx`, `app/project-quality.tsx`: outcomes, the map (loaded on demand) and data quality
- `app/api/`: authenticated workspace, discovery, generation and per-campaign export endpoints
- `lib/leadgen.ts`: validation, domain types and shared calculations
- `lib/gloss.ts`: Gloss audiences, creator validation, scoring, templates and import/export rows
- `lib/discovery-engine.ts`: discovery plan, source queries, result mapping and refresh merge (pure, unit-tested)
- `lib/discovery-net.ts`: Overpass, Wikidata and Nominatim clients with retries, paging and fallbacks
- `lib/discovery-run.ts`: browser orchestration, tier order, retries and progress checkpoints
- `lib/workspace-store.ts`: D1 persistence, change-only saves and legacy migration
- `lib/campaign-export.ts` and `lib/xlsx.ts`: dependency-free per-campaign Excel workbooks
- `lib/project-schema.ts`, `lib/project.ts`: lead-project schemas, the wizard rules and lead construction
- `lib/allocation.ts`, `lib/ledger.ts`, `lib/project-store.ts`: batch allocation, the Given ledger and its D1 batches
- `lib/categories.ts` with `overture-taxonomy.json`, `category-synonyms.json`, `category-crosswalk.json` and `countries.json`: category search and the Overture → OpenStreetMap / Wikidata crosswalk
- `lib/project-run.ts`, `lib/project-osm.ts`, `lib/project-net.ts`, `lib/project-sources.ts`: discovery orchestration, queries and the sources-service client
- `lib/dedupe.ts`, `lib/phone.ts`, `lib/suppression.ts`, `lib/india-pin.ts`: merging, phone numbers, the do-not-contact list and PIN-code states
- `lib/templates.ts`, `lib/outcomes.ts`, `lib/project-export.ts`, `lib/map-markers.ts`, `lib/project-checks.ts`: templates, outcome tracking, workbooks, the map and data-quality checks
- `sources/`: the local sources service (DuckDB over Overture extracts, enrichment, contact checks, updates)
- `db/` and `drizzle/`: schema and versioned migrations
- `scripts/`: discovery and project probes, Overture extract and taxonomy builders, campaign export and local migration helpers
- `app/premium.css`: dark forest visual theme and responsive refinements

## Data and hosting

The local development database is separate from the hosted database, and pushing source code does not upload local records. Back up with the in-app workspace export or the campaign workbooks.

`.openai/hosting.json` identifies the original Sites project and declares its `DB` binding. A Git push alone does not deploy the app. When publishing through Sites:
- keep its authentication gateway;
- apply all migrations;
- configure any AI secrets in the hosting environment, never in source code.

The sources service and Overture extracts run on your own computer; a hosted copy of the app reaches them only from a browser on the same machine.

**Data licences:**
- **Overture Maps Places:** © Overture Maps Foundation, under CDLA-Permissive-2.0 or Apache-2.0 depending on the source record. The Places theme contains no OpenStreetMap data.
- **OpenStreetMap:** © OpenStreetMap contributors, under the [ODbL](https://www.openstreetmap.org/copyright). This applies to OpenStreetMap-derived rows and to exports that combine them. Map tiles follow the OSM tile usage policy.
- **Wikidata:** CC0.

Public listings can be outdated, so check details before outreach.

## Places Discovery

Open **Places Discovery**, immediately below **Campaigns**, or `/#places-discovery`.
This implements the BRD's session-bound pilot in the existing React/Worker/D1 stack.
It does not send outreach or change existing campaign discovery.

1. Select a category, source and geographic centre. Area lookup returns exact-name candidates; explicitly choose the intended locality, city or state. The initial centre is Pune, with a 3 km radius. OpenStreetMap also supports resolved administrative boundaries. Google uses a location bias; Apple uses centre-based relevance, not a hard radius.
2. Run discovery. A saved run records progress, limits and cancellation. OpenStreetMap returns up to 100 listings; Google returns one page (up to 20); Apple returns the provider's search response. Totals are returned listings, never market size. Broad institution categories need researcher qualification.
3. Review directory evidence or add independent business contact evidence. Each field has a URL, checked date and quality status. Missing data stays blank. The module does not guess email addresses, crawl websites, infer consent or classify numbers as WhatsApp accounts.
4. Select a compatible active campaign, review the handoff, and confirm. Duplicate candidates can link to existing leads or remain separate with a reason. Linking never overwrites existing notes/history. Suppressed contacts are blocked server-side, including exports. Creator Partners and custom Lead Projects retain their own intake workflows.
5. Export selected eligible contacts as CSV with field evidence, status, date and attribution. Apple/Google response data is never exported or placed in the CRM.

### Source-use matrix (policy 2026-11-15-v1)

| Source | Live display | Durable evidence | CSV / campaign handoff | Map |
| --- | --- | --- | --- | --- |
| OpenStreetMap | Yes, attributed | Reviewed fields, source URL, ODbL | Yes, with attribution and suppression checks | OpenStreetMap / Leaflet |
| Independently researched official or authorized business source | Researcher's entered evidence | After explicit attestation | Published / manually confirmed fields only | No automatic geocoding |
| Google Places | Configured live research only | No provider fields | No | Google Maps |
| Apple Maps | Configured live research only | No provider fields | No | Apple MapKit JS |
| Unknown source | Disabled | Disabled | Disabled | Disabled |

Opening an official website is a separate research action; it is not authorization to copy provider content into the evidence form. Source URLs from Google/Apple are rejected as independent evidence. The business owner must review source/account permissions before enabling either commercial provider. See [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) and [Apple Maps terms](https://developer.apple.com/support/terms/).

### Setup and usage controls

Apply migrations with `npm run db:migrate` before starting. Migrations 0003–0004 add isolated Places tables; they do not reset campaign data. Configure Worker environment values using `.env.example` (local Cloudflare variables can be placed in a gitignored `.dev.vars`; never commit secrets). Commercial providers require credentials, an explicit enabled flag, free-allowance confirmation and an ISO reconciliation timestamp less than 24 hours old. They pause automatically when that timestamp expires. Google needs Places API (New) and Maps JavaScript API with separate restricted keys. Apple needs an authorized Maps key, team ID and key ID. Publish the required application terms/privacy disclosures before enabling Google in production.

The owner must set each application's total cap below the **remaining allowance of every enabled operation** on the relevant account, accounting for use by other apps. The defaults are conservative pilot caps, not vendor free-tier entitlements. Counters are shared across this installation, reset on UTC day boundaries for Apple/OSM and UTC month boundaries for Google. Search/detail/map reservations are separately reported by operation for the current workspace. The shared aggregate cap stops new operations atomically, with 80%/95% warnings. Timeouts and uncertain dispatches remain counted. No paid fallback, automatic retry, pagination loop or background scheduler is enabled. A search reserves one operation; displaying a commercial map reserves another; each Google detail lookup reserves another. Apple token exchange and map SDK internals are not independently billed/reconciled by this ledger; use provider-side limits too. Local estimates cannot guarantee the provider's invoice. Reconciliation is owner-entered, not an API billing sync.

Provider results exist only in component memory for 15 minutes, and disappear when leaving the module. Apple/Google run rows retain user-authored search settings and outcome metadata only. OSM run results expire after 30 days; audits and request detail expire after 90 days on authenticated access. Durable reviewed evidence remains until archived/updated under the workspace's retention process. Current pilot limits are 100 saved searches, 1000 contact records and the latest 50 runs/activity entries in the UI. Archiving does not delete records or free capacity. Run history persists; reload never re-dispatches a completed request. Unfinished requests become Interrupted after two minutes on refresh. Cancellation prevents later work but cannot recall a request already sent to a provider.

### Verification and release boundaries

`tests/places.test.mjs` exercises real isolated D1 migrations, quota races, idempotent execution, transient provider storage, evidence validation, campaign compatibility, duplicate linking, suppression and cross-owner access. `tests/worker-smoke.mjs` covers the compiled authenticated routes and existing CRM regressions. Provider response tests use controlled fixtures; live Apple/Google/Instagram integration and billing validation require the owner's accounts. Browser/mobile visual QA remains a release check where an authorized browser session is available. Automatic website extraction, registry-complete “all colleges,” billing API reconciliation, scheduled/background runs, Instagram hashtag discovery and Instagram messaging are not enabled by this pilot.

### Instagram research

**Keyword account search:** the Instagram tab now includes a keyword and optional location form (for example, `bridal makeup artist` + `Pune`). It uses Brave Web Search to find publicly indexed Instagram **profile URLs**, filters out posts/reels/explore pages and non-Instagram URLs, and deduplicates handles. Location is a search term, not a verified address. Results are web-index matches, not Instagram-native search results or confirmed professional accounts. Search snippets are labelled separately from Meta profile data; follower counts are never inferred from snippets.

Set `BRAVE_SEARCH_API_KEY`, `INSTAGRAM_KEYWORD_ENABLED=true`, and an appropriate `INSTAGRAM_KEYWORD_DAILY_CAP` (default 20, maximum 100). This service is separate from Meta: a Meta access token cannot enable web keyword search. Review your Brave subscription and quota before enabling; the application cap does not guarantee zero charges. Without the search key, the form provides an explicit external Google web-search link and clearly labels in-app search as unconfigured. It does not scrape Instagram or search result pages.

One search examines the first 20 web results and reports how many profile matches remain after exclusions. No automatic pagination or retries occur. Each unique request ID is claimed once, the daily installation-wide quota is reserved atomically, and errors/timeouts stay counted. Queries, snippets and matched profiles are not persisted; the audit contains request IDs and outcomes only. Results expire after 15 minutes or on leaving the tab. Choose **Use in username lookup** to populate the separate Meta form; performing that lookup is another explicit action and requires Meta credentials. The keyword endpoint is authenticated and rejects cross-origin writes. Tests exercise filtering, URL canonicalization, duplicate requests, quota races, redaction, and disabled-provider states. Reference: [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started).

Open **Places Discovery → Instagram**. This uses Meta's **Instagram API with Facebook Login — Business Discovery** for a known professional username. It returns available name, biography, website, follower count and media count. It does not search by geographic radius, read consumer/personal accounts, or promise email, phone and address discovery. No scraping, automatic messages, creator campaign imports, or token renewal is implemented.

Configure these server variables, then restart the local server:

| Variable | Required value |
| --- | --- |
| `INSTAGRAM_ACCOUNT_ID` | Your querying Instagram Business/Creator account's numeric ID, not the target username or Facebook Page ID |
| `INSTAGRAM_ACCESS_TOKEN` | Facebook User token authorized for that professional account |
| `INSTAGRAM_GRAPH_VERSION` | Supported version selected for your Meta app, for example `v27.0` in the current Meta documentation |
| `INSTAGRAM_ENABLED` | `true` after app permissions and account eligibility are checked |
| `INSTAGRAM_DAILY_CAP` | Conservative installation-wide daily lookup limit; default 200, maximum 200; additionally limited to 60 reservations per fixed UTC hour |
| `INSTAGRAM_APP_SECRET` | Optional app secret used to generate App Secret Proof; required when your app enforces that proof |

Set up the Meta app with Instagram API with Facebook Login and link the querying professional Instagram account to a Facebook Page. The Business Discovery endpoint requires `instagram_basic`, `instagram_manage_insights`, and `pages_read_engagement`. A Page role granted through Business Manager can additionally require `ads_read` or `ads_management`. App access level, review and business-verification requirements depend on whether the app serves its own assigned accounts or external users; check the app dashboard. `pages_show_list` is relevant to account onboarding if you later add an OAuth connection flow. This pilot accepts a pre-authorized token and account ID; it has no interactive OAuth onboarding.

Live profiles expire from UI memory after 15 minutes, clearing the profile, or leaving the Instagram tab. They are never stored in contact records, export files, browser storage or audit payloads. Audit rows contain only the request ID and outcome. Duplicate request IDs are rejected rather than re-fetching a lost result. Each attempt reserves an operation before dispatch; failures remain counted. There is no automatic retry. The API hides raw Meta error bodies to avoid exposing credentials. Independent business-contact evidence and creator campaign management remain separate workflows.

Official references: [Meta Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery), [Apple Maps key setup](https://developer.apple.com/help/account/capabilities/create-a-maps-identifier-and-private-key/), [Google API key restrictions](https://developers.google.com/maps/api-security-best-practices).

### Apple and Google credential checklist

**Apple:** create a Maps identifier in an Apple Developer account and associate a Maps-enabled private key. Configure `APPLE_MAPS_TEAM_ID`, `APPLE_MAPS_KEY_ID`, and `APPLE_MAPS_PRIVATE_KEY` (the downloaded `.p8` contents, with escaped newlines if necessary). The identifier is needed when configuring the key in Apple's portal; the implementation signs requests using the team ID, key ID and private key. MapKit tokens are origin-scoped by the server.

**Google:** use a billing-enabled Google Cloud project with **Places API (New)** and **Maps JavaScript API** enabled. Configure `GOOGLE_PLACES_API_KEY` with the server key restricted to Places API (New), and `GOOGLE_MAPS_BROWSER_KEY` with a separate key restricted to Maps JavaScript API and allowed website referrers. Add the local app origin `http://127.0.0.1:5187/*` and the actual production domain as appropriate. Apply server IP restrictions where your hosting provides stable egress; do not apply browser referrer restrictions to the server key.

Both providers remain disabled until `PLACES_<PROVIDER>_ENABLED=true`, `PLACES_<PROVIDER>_FREE_ALLOWANCE_CONFIRMED=true`, and `PLACES_<PROVIDER>_ALLOWANCE_CHECKED_AT` contains a current ISO timestamp. Set `PLACES_<PROVIDER>_CAP` below the account's verified remaining allowances. Credentials alone do not establish remaining free usage. Use local ignored environment configuration or the deployment's secret manager; never commit private keys, access tokens, or app secrets.

### Vercel deployment

The Next.js build in `vercel.json` runs the complete application on Vercel. The local Vinext/D1 workflow remains available with `npm run dev`.

Production uses a dedicated Supabase PostgreSQL project and the private `leadgen` schema. `lib/postgres-d1.ts` preserves prepared parameters and atomic batches for the existing stores; PostgreSQL compatibility functions and generated columns are defined in `deployment/postgres-schema.sql`. Apply that schema only to a new, empty target. `scripts/migrate-workspace-postgres.mjs` copies local D1 rows without deleting the source. It maps the local preview owner to the production owner.

Set `LEADGEN_HOSTING=vercel`, `LEADGEN_DATABASE_URL`, `LEADGEN_LOGIN_PASSWORD`, and a random 32-byte `LEADGEN_SESSION_SECRET` as sensitive production variables. The database connection verifies TLS with `certs/supabase-ca.crt`. Provider credentials are server-only. `.vercelignore` excludes local data and credentials from uploads.

This deployment uses a single-owner workspace password, not Supabase user registration. Signed HttpOnly cookies expire after seven days; password attempts are rate-limited in PostgreSQL. Rotate the session secret to invalidate all sessions. The local hosting-specific identity headers are never accepted in Vercel mode.

Use `scripts/check-vercel.mjs <url>` with the local environment loaded to check anonymous denial, sign-in, migrated workspace, projects, Places, and Instagram configuration without printing credentials. For database compatibility tests, run the Places tests with `LEADGEN_TEST_POSTGRES=true` and `LEADGEN_DATABASE_URL` configured; tests use isolated temporary schemas and leave production tables intact.

Instagram pacing: all users share a 60-per-UTC-hour counter and the configured daily cap. The server persists a shared pause when Meta usage headers reach 80%, HTTP 429 occurs, or a recognized Meta throttling error is returned. The pause lasts at least one hour and honors longer Retry-After or estimated_time_to_regain_access hints. These are conservative application limits, not a guaranteed Meta allocation. Failed reservations may consume allowance; no automatic retry is sent. Existing usage counts are retained when limits change.
