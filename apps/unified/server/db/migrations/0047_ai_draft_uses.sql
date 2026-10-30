CREATE TABLE IF NOT EXISTS "ai_draft_uses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"feature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_draft_uses" ADD CONSTRAINT "ai_draft_uses_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_draft_uses_company_idx" ON "ai_draft_uses" USING btree ("company_id","feature","created_at");