-- The customer's unit a warranty covers and a service plan looks after (field service live test 2026-11-09).
ALTER TABLE "project_warranty" ADD COLUMN "equipment_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "equipment_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_warranty" ADD CONSTRAINT "project_warranty_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
