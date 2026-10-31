CREATE TABLE IF NOT EXISTS "supplement_status" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"base_status" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplement" ADD COLUMN "custom_status_id" text;--> statement-breakpoint
ALTER TABLE "supplement" ADD COLUMN "custom_status_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement_status" ADD CONSTRAINT "supplement_status_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_status_company_id_idx" ON "supplement_status" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplement_status_company_name_idx" ON "supplement_status" USING btree ("company_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement" ADD CONSTRAINT "supplement_custom_status_id_supplement_status_id_fk" FOREIGN KEY ("custom_status_id") REFERENCES "public"."supplement_status"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
