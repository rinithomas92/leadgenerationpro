CREATE TABLE `places_audit` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`action` text NOT NULL,
	`subject` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `places_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `places_contacts` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `places_links` (
	`owner` text NOT NULL,
	`contact_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text NOT NULL,
	PRIMARY KEY(`owner`, `contact_id`, `campaign_id`)
);
--> statement-breakpoint
CREATE TABLE `places_quota` (
	`meter` text NOT NULL,
	`period` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`meter`, `period`)
);
--> statement-breakpoint
CREATE TABLE `places_requests` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`meter` text NOT NULL,
	`period` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `places_runs` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`search` text NOT NULL,
	`status` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `places_searches` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
