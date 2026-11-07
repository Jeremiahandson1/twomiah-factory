ALTER TABLE "canvass_territory" ADD COLUMN "parent_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_parent_id_canvass_territory_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."canvass_territory"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
