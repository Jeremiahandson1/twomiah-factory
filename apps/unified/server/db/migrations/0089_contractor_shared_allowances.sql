CREATE TABLE IF NOT EXISTS "project_allowance" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_selection" ADD COLUMN "allowance_id" text;--> statement-breakpoint
ALTER TABLE "project_selection" ADD COLUMN "change_order_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_allowance" ADD CONSTRAINT "project_allowance_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_allowance" ADD CONSTRAINT "project_allowance_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_allowance_project_id_idx" ON "project_allowance" USING btree ("project_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_selection" ADD CONSTRAINT "project_selection_allowance_id_project_allowance_id_fk" FOREIGN KEY ("allowance_id") REFERENCES "public"."project_allowance"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_selection_allowance_id_idx" ON "project_selection" USING btree ("allowance_id");--> statement-breakpoint
-- Hand-written: link the change orders that approved selections raised before this column existed (selectionsService titled
-- them "Selection Upgrade: <name>" / "Selection Credit: <name>"), so the revised budget and WIP do not count them twice.
UPDATE "project_selection" ps SET "change_order_id" = (
  SELECT co."id" FROM "change_order" co
  WHERE co."project_id" = ps."project_id" AND co."company_id" = ps."company_id"
    AND co."title" IN ('Selection Upgrade: ' || ps."name", 'Selection Credit: ' || ps."name")
  ORDER BY co."created_at" DESC LIMIT 1
) WHERE ps."change_order_id" IS NULL AND ps."status" IN ('approved', 'ordered', 'received');
