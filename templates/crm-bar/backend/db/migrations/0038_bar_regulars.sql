-- The Regulars (services/barLoyalty.ts): crm-salon's three loyalty tables and names, keyed to the register's checks.
CREATE TABLE IF NOT EXISTS "loyalty_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
	"contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_member_company_id_idx" ON "loyalty_members" ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_member_company_contact_uniq" ON "loyalty_members" ("company_id","contact_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
	"member_id" text NOT NULL REFERENCES "loyalty_members"("id") ON DELETE cascade,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"balance_after" integer,
	"description" text,
	"check_id" text,
	"earn_check_id" text,
	"reward_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_tx_member_idx" ON "loyalty_transactions" ("member_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_tx_earn_per_check" ON "loyalty_transactions" ("member_id","earn_check_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"description" text,
	"points_cost" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'fixed' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"menu_item_id" text REFERENCES "bar_menu_item"("id") ON DELETE set null,
	"active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_reward_company_id_idx" ON "loyalty_rewards" ("company_id");
