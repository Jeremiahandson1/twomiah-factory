CREATE TABLE IF NOT EXISTS "repair_order" (
	"id" text PRIMARY KEY NOT NULL,
	"ro_number" text,
	"write_up_date" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_unit_info" json,
	"services" json DEFAULT '[]'::json NOT NULL,
	"advisor_name" text,
	"estimated_total" numeric(10, 2),
	"actual_total" numeric(10, 2),
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" text NOT NULL,
	"unit_id" text,
	"technician_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"trade_in_info" json,
	"follow_up_date" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"contact_id" text NOT NULL,
	"unit_id" text,
	"assigned_to" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_sales_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_message" text,
	"alerted_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp,
	"converted_to_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"repair_order_id" text NOT NULL,
	"sales_lead_id" text,
	"salesperson_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"stock_number" text,
	"vin" text,
	"year" integer,
	"make" text,
	"model_name" text,
	"trim" text,
	"status" text DEFAULT 'available' NOT NULL,
	"msrp" numeric(10, 2),
	"listed_price" numeric(10, 2),
	"internet_price" numeric(10, 2),
	"cost" numeric(10, 2),
	"photos" json DEFAULT '[]'::json NOT NULL,
	"floorplan_img" text,
	"description" text,
	"features" json DEFAULT '[]'::json NOT NULL,
	"exterior_color" text,
	"interior_color" text,
	"rv_class" text,
	"towable_type" text,
	"length_ft" numeric(5, 1),
	"sleeps" integer,
	"slide_outs" integer,
	"gvwr" integer,
	"dry_weight" integer,
	"hitch_weight" integer,
	"chassis" text,
	"fresh_tank_gal" integer,
	"grey_tank_gal" integer,
	"black_tank_gal" integer,
	"generator_hours" integer,
	"awnings" integer,
	"fuel_type" text,
	"engine" text,
	"engine_cc" integer,
	"mileage" integer,
	"hours" integer,
	"transmission" text,
	"drivetrain" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_company_id_idx" ON "repair_order" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_status_idx" ON "repair_order" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_customer_id_idx" ON "repair_order" USING btree ("customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_order_ro_number_company_id_key" ON "repair_order" USING btree ("ro_number","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_company_id_idx" ON "sales_lead" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_stage_idx" ON "sales_lead" USING btree ("stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_assigned_to_idx" ON "sales_lead" USING btree ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_contact_id_idx" ON "sales_lead" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_company_id_idx" ON "service_sales_alert" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_salesperson_id_idx" ON "service_sales_alert" USING btree ("salesperson_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_dismissed_at_idx" ON "service_sales_alert" USING btree ("dismissed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_company_id_idx" ON "unit" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_status_idx" ON "unit" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_category_idx" ON "unit" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_make_idx" ON "unit" USING btree ("make");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unit_vin_company_id_key" ON "unit" USING btree ("vin","company_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_repair_order_id_repair_order_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_sales_lead_id_sales_lead_id_fk" FOREIGN KEY ("sales_lead_id") REFERENCES "public"."sales_lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_salesperson_id_user_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit" ADD CONSTRAINT "unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
