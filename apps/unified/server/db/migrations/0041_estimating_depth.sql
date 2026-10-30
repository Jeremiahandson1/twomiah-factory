CREATE TABLE IF NOT EXISTS "project_budget_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"quote_id" text,
	"cost_code" text NOT NULL,
	"estimated_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estimated_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"uncosted_lines" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "markup_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "project_selection" ADD COLUMN "quote_line_item_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_budget_line_project_id_idx" ON "project_budget_line" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_budget_line_quote_id_idx" ON "project_budget_line" USING btree ("quote_id");