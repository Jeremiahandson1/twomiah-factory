ALTER TABLE "quote" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "sold_by_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "ended_how" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_sold_by_id_user_id_fk" FOREIGN KEY ("sold_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
