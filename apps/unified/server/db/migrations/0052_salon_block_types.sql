CREATE TABLE IF NOT EXISTS "book_block_type" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#94a3b8' NOT NULL,
	"default_min" integer DEFAULT 60 NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_id" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_name" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_color" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "paid" boolean;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "series_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block_type" ADD CONSTRAINT "book_block_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_block_type_company_name_idx" ON "book_block_type" USING btree ("company_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_type_id_book_block_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."book_block_type"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_block_series_idx" ON "book_block" USING btree ("company_id","series_id");