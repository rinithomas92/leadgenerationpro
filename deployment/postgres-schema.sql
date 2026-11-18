CREATE SCHEMA IF NOT EXISTS leadgen;
REVOKE ALL ON SCHEMA leadgen FROM PUBLIC, anon, authenticated;
SET search_path = leadgen, pg_catalog;
CREATE TABLE "workspaces" (
	"owner" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "leads" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"data" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE INDEX "leads_owner_campaign" ON "leads" ("owner","campaign_id");
ALTER TABLE "workspaces" ADD "write_token" text DEFAULT '' NOT NULL;
CREATE TABLE "contact_events" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"channel" text NOT NULL,
	"template_id" text,
	"template_version" integer,
	"direction" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE INDEX "contact_events_lead" ON "contact_events" ("owner","lead_id","created_at");
CREATE INDEX "contact_events_campaign" ON "contact_events" ("owner","campaign_id","created_at");
CREATE TABLE "deliveries" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"seq" integer NOT NULL,
	"requested" integer NOT NULL,
	"mode" text NOT NULL,
	"planned" text NOT NULL,
	"actual" text NOT NULL,
	"notes" text NOT NULL,
	"delivered" integer NOT NULL,
	"suppressed" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"filename" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE UNIQUE INDEX "deliveries_seq" ON "deliveries" ("owner","campaign_id","seq");
CREATE TABLE "suppression" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"origin" text NOT NULL,
	"created_at" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE UNIQUE INDEX "suppression_value" ON "suppression" ("owner","kind","value");
ALTER TABLE "leads" ADD "project_kind" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,kind}') STORED;
ALTER TABLE "leads" ADD "segment_id" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,segmentId}') STORED;
ALTER TABLE "leads" ADD "tier" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,tier}') STORED;
ALTER TABLE "leads" ADD "country" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,country}') STORED;
ALTER TABLE "leads" ADD "distance_km" real GENERATED ALWAYS AS (("data"::jsonb #>> '{project,distanceKm}')::real) STORED;
ALTER TABLE "leads" ADD "dedupe_key" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,dedupeKey}') STORED;
ALTER TABLE "leads" ADD "delivery_status" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,delivery,status}') STORED;
ALTER TABLE "leads" ADD "delivery_id" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,delivery,id}') STORED;
ALTER TABLE "leads" ADD "given_at" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,delivery,givenAt}') STORED;
ALTER TABLE "leads" ADD "source_ids" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,sourceIds}') STORED;
ALTER TABLE "leads" ADD "website_status" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,websiteStatus}') STORED;
ALTER TABLE "leads" ADD "email_check" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,emailCheck}') STORED;
ALTER TABLE "leads" ADD "phone_type" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,phoneType}') STORED;
ALTER TABLE "leads" ADD "outreach_status" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,outreach,status}') STORED;
ALTER TABLE "leads" ADD "last_contacted_at" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,outreach,lastContactedAt}') STORED;
ALTER TABLE "leads" ADD "replied_at" text GENERATED ALWAYS AS ("data"::jsonb #>> '{project,outreach,repliedAt}') STORED;
CREATE INDEX "leads_delivery" ON "leads" ("owner","campaign_id","delivery_status","tier");
CREATE INDEX "leads_outreach" ON "leads" ("owner","campaign_id","outreach_status");
CREATE UNIQUE INDEX "leads_dedupe" ON "leads" ("owner","campaign_id","dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE TABLE "places_audit" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"at" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE TABLE "places_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"expires" integer NOT NULL
);

CREATE TABLE "places_contacts" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE TABLE "places_links" (
	"owner" text NOT NULL,
	"contact_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"lead_id" text NOT NULL,
	PRIMARY KEY("owner", "contact_id", "campaign_id")
);

CREATE TABLE "places_quota" (
	"meter" text NOT NULL,
	"period" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY("meter", "period")
);

CREATE TABLE "places_requests" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"meter" text NOT NULL,
	"period" text NOT NULL,
	"at" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE TABLE "places_runs" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"search" text NOT NULL,
	"status" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"results" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

CREATE TABLE "places_searches" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"data" text NOT NULL,
	PRIMARY KEY("owner", "id")
);

ALTER TABLE "places_requests" ADD "operation" text DEFAULT 'search' NOT NULL;
ALTER TABLE "workspaces" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_events" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "contact_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deliveries" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppression" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "suppression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_audit" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_cache" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_contacts" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_links" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_quota" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_quota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_requests" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_runs" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "places_searches" ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "places_searches" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION leadgen.json_extract(source text, json_path text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT source::jsonb #>> string_to_array(substr(json_path,3),'.') $$;
CREATE FUNCTION leadgen.json_type(source text, json_path text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_typeof(source::jsonb #> string_to_array(substr(json_path,3),'.')) $$;
CREATE FUNCTION leadgen.json(source text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT source::jsonb $$;
CREATE FUNCTION leadgen.json_set(source text, json_path text, new_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_set(source::jsonb,string_to_array(substr(json_path,3),'.'),new_value)::text $$;
CREATE FUNCTION leadgen.json_each(source text) RETURNS TABLE(value text) LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE WHEN jsonb_typeof(element)='string' THEN element #>> '{}' ELSE element::text END FROM jsonb_array_elements(source::jsonb) AS element $$;
CREATE TABLE leadgen.login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, expires timestamptz NOT NULL);
ALTER TABLE leadgen.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA leadgen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA leadgen FROM PUBLIC, anon, authenticated;
