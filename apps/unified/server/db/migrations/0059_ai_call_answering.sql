CREATE TABLE IF NOT EXISTS "ai_call_session" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"call_log_id" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"outcome" text,
	"state" json NOT NULL,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_call_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"call_log_id" text NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"intent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_receptionist_settings" ADD COLUMN "call_answering" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_call_log_id_call_log_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_turn" ADD CONSTRAINT "ai_call_turn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_turn" ADD CONSTRAINT "ai_call_turn_call_log_id_call_log_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_session_company_id_idx" ON "ai_call_session" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_call_session_provider_call_idx" ON "ai_call_session" USING btree ("company_id","provider_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_turn_call_log_id_idx" ON "ai_call_turn" USING btree ("call_log_id");