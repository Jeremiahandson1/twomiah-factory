CREATE TABLE IF NOT EXISTS "saved_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"status" integer,
	"response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_request" ADD CONSTRAINT "saved_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_request_key" ON "saved_request" USING btree ("company_id","user_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_request_created_idx" ON "saved_request" USING btree ("created_at");