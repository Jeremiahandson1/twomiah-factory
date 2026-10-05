ALTER TABLE "warranty_claim" DROP CONSTRAINT IF EXISTS "warranty_claim_warranty_id_warranty_id_fk";--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_warranty_id_project_warranty_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."project_warranty"("id") ON DELETE cascade ON UPDATE no action;
