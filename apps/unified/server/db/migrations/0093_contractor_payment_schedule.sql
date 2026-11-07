CREATE TABLE IF NOT EXISTS "project_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"amount_type" text DEFAULT 'fixed' NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"due_date" timestamp,
	"milestone_task_id" text,
	"invoice_id" text,
	"released_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_payment" ADD CONSTRAINT "project_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_payment" ADD CONSTRAINT "project_payment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_payment" ADD CONSTRAINT "project_payment_milestone_task_id_project_task_id_fk" FOREIGN KEY ("milestone_task_id") REFERENCES "public"."project_task"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_payment_project_id_idx" ON "project_payment" USING btree ("project_id");