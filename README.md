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

### The sources service and Overture extracts

Overture data is queried locally with DuckDB through a small service bound to `127.0.0.1:5188`. Without it, lead projects still work with OpenStreetMap and Wikidata only, and the project page says so.

```sh
npm run overture:extract            # India, latest monthly release (about 500 MB; 20–30 minutes)
npm run overture:extract -- AE GB   # countries chosen for the Global tier
npm run sources                     # start the service; keep it running while you use the app
```

- Extracts are saved to `data/overture/<release>/<country>.parquet`, which Git ignores. Re-run the command, or press **Update** under **Data quality** on a project, to move to Overture's newest monthly release.
- `npm run overture:taxonomy` regenerates the category list and country list from a release.
- Optional second source, Foursquare Open Source Places (Apache-2.0): it is gated on Hugging Face, so sign in at <https://huggingface.co/datasets/foursquare/fsq-os-places>, accept the terms and create a read token. Then `$env:HF_TOKEN = "hf_..."` (bash: `export HF_TOKEN=hf_...`) and `npm run fsq:extract` (or `-- AE GB`). The extract is reshaped into the Overture layout in `data/foursquare/` (Git-ignored); restart `npm run sources` and discovery searches it alongside Overture. Places found by both merge into one lead.
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
