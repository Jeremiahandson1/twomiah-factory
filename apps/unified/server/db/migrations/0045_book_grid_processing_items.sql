CREATE TABLE IF NOT EXISTS "appointment_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"position" integer NOT NULL,
	"service_id" text,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_offset_min" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"processing_after_min" integer,
	"processing_min" integer,
	"price" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_block" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "processing_after_min" integer;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "processing_min" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "processing_after_min" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "processing_min" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_service_id_service_menu_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_item_appointment_id_idx" ON "appointment_item" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_item_stylist_idx" ON "appointment_item" USING btree ("company_id","stylist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_block_company_start_idx" ON "book_block" USING btree ("company_id","start_time");