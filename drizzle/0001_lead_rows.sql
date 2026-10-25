CREATE TABLE `leads` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `leads_owner_campaign` ON `leads` (`owner`,`campaign_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `write_token` text DEFAULT '' NOT NULL;