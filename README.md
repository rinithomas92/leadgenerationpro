# LeadGen Pro

A focused workspace for discovering relevant businesses, managing campaigns and preparing outreach. Built with React 19, TypeScript, Vinext/Vite and Cloudflare D1.

## What works

- Create, edit, pause and archive campaigns with selected target markets.
- Generate editable market suggestions and message drafts. Templates work without an API key; an optional OpenAI connection enables AI generation.
- Discover businesses through OpenStreetMap with source links, plus a dated Pune research snapshot for supported markets. Directory coverage and contact availability vary.
- Import up to 500 leads per CSV, deduplicate within a campaign, filter leads and manage stages in table or pipeline views.
- Save lead notes, tags, campaign assignments and follow-up reminders.
- Save, copy and download outreach drafts and reusable templates.
- Review lead and draft reminders together under Follow-ups, then complete them explicitly.
- See stage-based analytics and export your workspace.
- Persist each signed-in user's workspace in D1 with revision checks to prevent silent overwrites across tabs.

Email/WhatsApp sending, scheduled delivery and reply synchronization are **not connected**. Send reviewed drafts using your own account and record replies manually. Fit scores are transparent rule-based estimates, not buying intent or conversion predictions. Sample records are excluded from analytics.

## Run locally

Requires **Node.js 22.13 or newer** (Node 24 recommended) and npm. The app works on Windows, macOS and Linux.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5187. The sign-in redirect uses a development-only local identity on loopback. Local records live in `.wrangler/state/` and survive restarts. The database and credentials are not committed to Git.

`db:migrate` is for new clones and migration-managed local databases. If an older checkout already has the `workspaces` table created manually, preserve its `.wrangler/state` and skip the initial migration; do not delete existing records to initialize the project.

To use another port:

```sh
npm run dev -- --port 5190
```

### Optional AI generation

Copy `.env.example` to `.env` and configure `OPENAI_API_KEY` and `OPENAI_MODEL` with a model available to your account that supports Responses structured output. Restart the development server. Never commit `.env` or enter secrets into browser code.

Without these settings, campaign suggestions and outreach templates remain available. AI suggestions must be reviewed, and provider availability is not guaranteed.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:worker
```

Tests cover CSV parsing and formula safety, campaign-aware deduplication, lead-stage history, workspace validation and reminders. The build emits a Cloudflare Worker and client assets under `dist/`.

```sh
npm start
```

This previews the built Worker, without development sign-in. Production identity headers must be supplied by a trusted authentication gateway; the app is configured for Sites authentication. Do not expose a raw Worker that accepts untrusted identity headers.

## Project structure

- `app/dashboard.tsx` — overview, campaign shortcuts and next actions
- `app/campaigns.tsx` — campaign brief and market selection
- `app/leads.tsx` — discovery, CSV import, filtering, pipeline and lead details
- `app/outreach.tsx` — editable drafts and templates
- `app/follow-ups.tsx` — saved reminders
- `app/insights.tsx` — analytics and workspace settings
- `app/api/` — authenticated workspace, discovery and generation endpoints
- `lib/leadgen.ts` — validation, domain types and shared calculations
- `lib/discovery.ts` — public directory mapping and dated research snapshot
- `db/` and `drizzle/` — schema and versioned migrations
- `app/premium.css` — dark forest visual theme and responsive refinements

## Data and hosting

The local development database is separate from the hosted database. Source pushes do not upload local campaign records. Use the in-app workspace export for backups.

The existing `.openai/hosting.json` identifies the original Sites project and declares its `DB` binding. A Git push alone does not deploy this app. When publishing through Sites, retain its authentication gateway and apply the included migrations. Configure AI secrets in the hosting environment, never in source.

OpenStreetMap data is attributed to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) under ODbL. Included business-website records are dated research snapshots with original source links; review current details before outreach.
