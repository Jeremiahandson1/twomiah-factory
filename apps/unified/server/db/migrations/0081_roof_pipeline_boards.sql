CREATE TABLE IF NOT EXISTS "roof_pipeline_board" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#ea580c' NOT NULL,
	"job_types" json DEFAULT '[]'::json NOT NULL,
	"filters" json DEFAULT '{}'::json NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"roles" json DEFAULT '[]'::json NOT NULL,
	"owner_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_pipeline_board" ADD CONSTRAINT "roof_pipeline_board_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_pipeline_board" ADD CONSTRAINT "roof_pipeline_board_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roof_pipeline_board_company_id_idx" ON "roof_pipeline_board" USING btree ("company_id");