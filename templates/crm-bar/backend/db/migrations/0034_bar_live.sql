-- The bar: what changes every night, read live by the bar's website (routes/barPublic.ts) — menu and 86,
-- taps, specials, games, public events, the Tonight console's status, and bar/kitchen hours (bar_settings).
CREATE TABLE IF NOT EXISTS "bar_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"hours" json DEFAULT '{}'::json NOT NULL,
	"speakeasy_password_hash" text,
	"speakeasy_note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_settings_company_key" ON "bar_settings" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_status" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_open" boolean,
	"kitchen_closes_at" timestamp,
	"bar_open" boolean,
	"bar_closes_at" timestamp,
	"override_until" timestamp,
	"room_status" text DEFAULT 'quiet' NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"updated_by_name" text,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_status_company_key" ON "bar_status" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tap" (
	"id" text PRIMARY KEY NOT NULL,
	"line_number" integer NOT NULL,
	"beer_name" text NOT NULL,
	"brewery" text,
	"style" text,
	"abv" numeric(4, 1),
	"origin_country" text,
	"description" text,
	"badge" text,
	"price_cents" integer,
	"status" text DEFAULT 'pouring' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tapped_at" timestamp,
	"blown_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_tap_company_idx" ON "bar_tap" ("company_id", "is_active", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_special" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_cents" integer,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_days" text,
	"created_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_special_company_idx" ON "bar_special" ("company_id", "starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_game" (
	"id" text PRIMARY KEY NOT NULL,
	"league" text NOT NULL,
	"home" text NOT NULL,
	"away" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"note" text,
	"bar_hours" json,
	"kitchen_hours" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_game_company_idx" ON "bar_game" ("company_id", "starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"image_url" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_days" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_event_company_slug_key" ON "bar_event" ("company_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_event_company_idx" ON "bar_event" ("company_id", "is_published", "starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_menu_section" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'food' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_menu_section_company_slug_key" ON "bar_menu_section" ("company_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text REFERENCES "bar_menu_section"("id") ON DELETE set null,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer,
	"price_label" text,
	"dietary" json DEFAULT '[]'::json NOT NULL,
	"image_url" text,
	"hero_image_url" text,
	"story" text,
	"is_signature" boolean DEFAULT false NOT NULL,
	"is_86ed" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"variations" json DEFAULT '[]'::json NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_menu_item_company_slug_key" ON "bar_menu_item" ("company_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_menu_item_section_idx" ON "bar_menu_item" ("section_id", "sort_order");
