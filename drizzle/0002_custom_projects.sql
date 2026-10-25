CREATE TABLE `contact_events` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`channel` text NOT NULL,
	`template_id` text,
	`template_version` integer,
	`direction` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `contact_events_lead` ON `contact_events` (`owner`,`lead_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_events_campaign` ON `contact_events` (`owner`,`campaign_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`seq` integer NOT NULL,
	`requested` integer NOT NULL,
	`mode` text NOT NULL,
	`planned` text NOT NULL,
	`actual` text NOT NULL,
	`notes` text NOT NULL,
	`delivered` integer NOT NULL,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`filename` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_seq` ON `deliveries` (`owner`,`campaign_id`,`seq`);--> statement-breakpoint
CREATE TABLE `suppression` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`origin` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_value` ON `suppression` (`owner`,`kind`,`value`);--> statement-breakpoint
ALTER TABLE `leads` ADD `project_kind` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.kind')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `segment_id` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.segmentId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `tier` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.tier')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `country` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.country')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `distance_km` real GENERATED ALWAYS AS (json_extract(`data`,'$.project.distanceKm')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `dedupe_key` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.dedupeKey')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `delivery_status` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.delivery.status')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `delivery_id` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.delivery.id')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `given_at` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.delivery.givenAt')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `source_ids` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.sourceIds')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `website_status` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.websiteStatus')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `email_check` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.emailCheck')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `phone_type` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.phoneType')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `outreach_status` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.outreach.status')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `last_contacted_at` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.outreach.lastContactedAt')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `leads` ADD `replied_at` text GENERATED ALWAYS AS (json_extract(`data`,'$.project.outreach.repliedAt')) VIRTUAL;--> statement-breakpoint
CREATE INDEX `leads_delivery` ON `leads` (`owner`,`campaign_id`,`delivery_status`,`tier`);--> statement-breakpoint
CREATE INDEX `leads_outreach` ON `leads` (`owner`,`campaign_id`,`outreach_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_dedupe` ON `leads` (`owner`,`campaign_id`,`dedupe_key`) WHERE `dedupe_key` IS NOT NULL;