CREATE TABLE IF NOT EXISTS "bid_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"package_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"prices" json DEFAULT '[]'::json NOT NULL,
	"total" numeric(12, 2),
	"notes" text,
	"declined_reason" text,
	"viewed_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_package" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"scope" text,
	"due_date" timestamp,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"awarded_invite_id" text,
	"purchase_order_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_package_id_bid_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."bid_package"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_purchase_order_id_job_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."job_purchase_order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bid_invite_package_vendor_unique" ON "bid_invite" USING btree ("package_id","vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_invite_vendor_idx" ON "bid_invite" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_package_company_idx" ON "bid_package" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_package_project_idx" ON "bid_package" USING btree ("project_id");