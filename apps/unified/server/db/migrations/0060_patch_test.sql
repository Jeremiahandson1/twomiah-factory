CREATE TABLE IF NOT EXISTS "patch_test" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"tested_at" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"ran_by_user_id" text,
	"ran_by_name" text,
	"appointment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_ran_by_user_id_user_id_fk" FOREIGN KEY ("ran_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patch_test_contact_idx" ON "patch_test" USING btree ("company_id","contact_id","tested_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patch_test_appointment_unique" ON "patch_test" USING btree ("appointment_id");
--> statement-breakpoint
-- A patch test already on a client's chart (a date and, once results were kept, a result; a date alone counted as passed) becomes the first entry of their history.
INSERT INTO "patch_test" ("id", "company_id", "contact_id", "tested_at", "status", "title", "created_at", "updated_at")
SELECT md5(cp."id" || 'patch-test'), c."company_id", cp."contact_id", cp."patch_test_at", COALESCE(cp."patch_test_result", 'passed'), 'Patch test', now(), now()
FROM "client_profile" cp JOIN "contact" c ON c."id" = cp."contact_id"
WHERE cp."patch_test_at" IS NOT NULL;
