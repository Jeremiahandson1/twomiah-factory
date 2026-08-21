CREATE TABLE IF NOT EXISTS "event_space" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"seated_capacity" integer,
	"standing_capacity" integer,
	"minimum_spend" numeric(10, 2),
	"hire_fee" numeric(10, 2),
	"amenities" json DEFAULT '[]'::json NOT NULL,
	"photo" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_package" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'dinner' NOT NULL,
	"price_per_person" numeric(10, 2),
	"min_guests" integer,
	"courses" json DEFAULT '[]'::json NOT NULL,
	"dietary_notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text REFERENCES "contact"("id") ON DELETE set null,
	"space_id" text REFERENCES "event_space"("id") ON DELETE set null,
	"coordinator_id" text REFERENCES "user"("id") ON DELETE set null,
	"name" text NOT NULL,
	"event_type" text DEFAULT 'private_dining' NOT NULL,
	"status" text DEFAULT 'enquiry' NOT NULL,
	"event_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"guest_count" integer,
	"guest_count_final" integer,
	"quoted_total" numeric(10, 2),
	"deposit_required" numeric(10, 2),
	"source" text,
	"lost_reason" text,
	"dietary_requirements" text,
	"setup_notes" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL REFERENCES "event"("id") ON DELETE cascade,
	"package_id" text REFERENCES "menu_package"("id") ON DELETE set null,
	"name" text NOT NULL,
	"per_person" boolean DEFAULT true NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_timeline" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL REFERENCES "event"("id") ON DELETE cascade,
	"time" text NOT NULL,
	"title" text NOT NULL,
	"department" text DEFAULT 'floor' NOT NULL,
	"details" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL REFERENCES "event"("id") ON DELETE cascade,
	"label" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date,
	"paid_at" timestamp,
	"method" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_space_company_id_idx" ON "event_space" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_package_company_id_idx" ON "menu_package" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_company_id_idx" ON "event" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_contact_id_idx" ON "event" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_date_idx" ON "event" ("event_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_status_idx" ON "event" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_menu_item_company_id_idx" ON "event_menu_item" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_menu_item_event_id_idx" ON "event_menu_item" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_timeline_company_id_idx" ON "event_timeline" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_timeline_event_id_idx" ON "event_timeline" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_company_id_idx" ON "event_payment" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_event_id_idx" ON "event_payment" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_due_idx" ON "event_payment" ("due_date");
