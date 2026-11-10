ALTER TABLE "change_order" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "invoice_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order" ADD CONSTRAINT "change_order_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order" ADD CONSTRAINT "change_order_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_job_id_idx" ON "change_order" USING btree ("job_id");