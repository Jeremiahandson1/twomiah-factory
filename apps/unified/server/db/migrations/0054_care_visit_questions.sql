CREATE TABLE IF NOT EXISTS "visit_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"question_id" text NOT NULL,
	"prompt" text NOT NULL,
	"phase" text NOT NULL,
	"answer" text NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"answered_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_question" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"prompt" text NOT NULL,
	"kind" text NOT NULL,
	"options" json,
	"phase" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"flag_on" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_answered_by_id_user_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_question" ADD CONSTRAINT "visit_question_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_answer_once_idx" ON "visit_answer" USING btree ("time_entry_id","question_id","phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_answer_company_idx" ON "visit_answer" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_question_company_idx" ON "visit_question" USING btree ("company_id");