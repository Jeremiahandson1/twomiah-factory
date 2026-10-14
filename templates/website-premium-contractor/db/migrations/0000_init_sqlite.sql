CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`user_email` text,
	`action` text NOT NULL,
	`target` text,
	`ip` text,
	`user_agent` text,
	`meta` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `booking_availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`day_of_week` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_avail_user_day_idx` ON `booking_availability_rules` (`user_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `booking_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`phone` text,
	`reason` text,
	`added_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `booking_bans_email_idx` ON `booking_bans` (`email`);--> statement-breakpoint
CREATE INDEX `booking_bans_phone_idx` ON `booking_bans` (`phone`);--> statement-breakpoint
CREATE TABLE `booking_blackouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`date` text NOT NULL,
	`start_minute` integer,
	`end_minute` integer,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_blackouts_date_idx` ON `booking_blackouts` (`date`);--> statement-breakpoint
CREATE TABLE `booking_calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_account_email` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`calendar_id` text,
	`sync_channel_id` text,
	`sync_resource_id` text,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_cal_user_provider_idx` ON `booking_calendar_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `booking_series` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`frequency` text NOT NULL,
	`interval_count` integer DEFAULT 1 NOT NULL,
	`first_start_at` integer NOT NULL,
	`occurrences_count` integer,
	`until_date` integer,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text,
	`customer_address` text,
	`customer_zip` text,
	`customer_notes` text,
	`assigned_user_id` text,
	`confirmation_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `booking_services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_series_confirmation_token_unique` ON `booking_series` (`confirmation_token`);--> statement-breakpoint
CREATE INDEX `booking_series_customer_email_idx` ON `booking_series` (`customer_email`);--> statement-breakpoint
CREATE INDEX `booking_series_status_idx` ON `booking_series` (`status`);--> statement-breakpoint
CREATE TABLE `booking_service_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`zip_list` text,
	`center_lat` text,
	`center_lng` text,
	`radius_miles` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_zones_user_idx` ON `booking_service_zones` (`user_id`);--> statement-breakpoint
CREATE TABLE `booking_services` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`duration_minutes` integer NOT NULL,
	`price_cents` integer,
	`deposit_amount_cents` integer,
	`deposit_percent` integer,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`slot_granularity_minutes` integer DEFAULT 30 NOT NULL,
	`capacity_per_slot` integer DEFAULT 1 NOT NULL,
	`tip_presets_percent` text,
	`is_active` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`rebook_interval_days` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_services_slug_unique` ON `booking_services` (`slug`);--> statement-breakpoint
CREATE INDEX `booking_services_active_order_idx` ON `booking_services` (`is_active`,`display_order`);--> statement-breakpoint
CREATE TABLE `booking_waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text,
	`customer_zip` text,
	`preferred_from` text,
	`preferred_to` text,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`notified_at` integer,
	`converted_booking_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `booking_services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_waitlist_service_status_idx` ON `booking_waitlist` (`service_id`,`status`);--> statement-breakpoint
CREATE INDEX `booking_waitlist_email_idx` ON `booking_waitlist` (`customer_email`);--> statement-breakpoint
CREATE TABLE `booking_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '*' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_delivery_at` integer,
	`last_status` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`series_id` text,
	`series_index` integer,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text,
	`customer_address` text,
	`customer_zip` text,
	`customer_notes` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`assigned_user_id` text,
	`source` text DEFAULT 'public_form' NOT NULL,
	`source_path` text,
	`source_referrer` text,
	`source_variant` text,
	`confirmation_token` text NOT NULL,
	`deposit_payment_intent_id` text,
	`deposit_amount_cents` integer,
	`deposit_status` text,
	`tip_amount_cents` integer,
	`reminder_24h_sent_at` integer,
	`reminder_24h_sms_sent_at` integer,
	`rebook_reminder_sent_at` integer,
	`review_request_sent_at` integer,
	`review_request_sms_sent_at` integer,
	`external_calendar_event_id` text,
	`cancelled_at` integer,
	`cancelled_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `booking_services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `booking_series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_confirmation_token_unique` ON `bookings` (`confirmation_token`);--> statement-breakpoint
CREATE INDEX `bookings_start_idx` ON `bookings` (`start_at`);--> statement-breakpoint
CREATE INDEX `bookings_assigned_start_idx` ON `bookings` (`assigned_user_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `bookings_status_start_idx` ON `bookings` (`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `bookings_series_idx` ON `bookings` (`series_id`,`series_index`);--> statement-breakpoint
CREATE TABLE `email_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`local_part` text NOT NULL,
	`routing_mode` text DEFAULT 'forward' NOT NULL,
	`forward_to` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_alias_local_part_unique` ON `email_alias` (`local_part`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`message` text NOT NULL,
	`source` text,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leads_status_created_idx` ON `leads` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `page_views` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_views_day_path_idx` ON `page_views` (`day`,`path`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`sections` text NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`is_published` integer DEFAULT true NOT NULL,
	`nav_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_slug_idx` ON `pages` (`slug`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`storage_key` text,
	`alt` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`content_type` text,
	`tag` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photos_tag_idx` ON `photos` (`tag`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`body` text DEFAULT '' NOT NULL,
	`cover_image_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_unique` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_slug_idx` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_status_published_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`summary` text,
	`body` text DEFAULT '' NOT NULL,
	`cover_image_url` text,
	`photos` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jti` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_jti_unique` ON `sessions` (`jti`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sessions_jti_idx` ON `sessions` (`jti`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`tagline` text,
	`phone` text,
	`email` text,
	`address` text,
	`seo_title` text,
	`seo_description` text,
	`nav` text NOT NULL,
	`photo_credits` text NOT NULL,
	`content_gaps` text NOT NULL,
	`service_areas` text NOT NULL,
	`inventory_feed_url` text,
	`contact_cta_label` text DEFAULT 'Get in touch' NOT NULL,
	`primary_color` text,
	`secondary_color` text,
	`accent_color` text,
	`logo_url` text,
	`favicon_url` text,
	`google_tag_manager_id` text,
	`google_analytics_id` text,
	`google_ads_id` text,
	`facebook_pixel_id` text,
	`microsoft_clarity_id` text,
	`booking_hero_title` text,
	`booking_hero_subtitle` text,
	`booking_confirm_cta` text,
	`booking_thanks_message` text,
	`booking_default_drive_time_minutes` integer DEFAULT 0 NOT NULL,
	`booking_ical_feed_token` text,
	`customizer_token` text,
	`crm_url` text,
	`crm_ready_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_tokens_hash_idx` ON `user_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `user_tokens_user_kind_idx` ON `user_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`password_hash` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'admin' NOT NULL,
	`totp_secret` text,
	`totp_enabled_at` integer,
	`recovery_codes` text,
	`tokens_invalidated_at` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);