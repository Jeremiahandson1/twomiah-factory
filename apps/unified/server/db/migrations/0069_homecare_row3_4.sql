ALTER TABLE "visit_answer" ADD COLUMN "acknowledged_at" timestamp;--> statement-breakpoint
ALTER TABLE "visit_answer" ADD COLUMN "acknowledged_by_id" text;--> statement-breakpoint
ALTER TABLE "visit_item" ADD COLUMN "care_type_id" text;--> statement-breakpoint
ALTER TABLE "visit_item" ADD COLUMN "from_care_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_acknowledged_by_id_user_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_care_type_id_care_types_id_fk" FOREIGN KEY ("care_type_id") REFERENCES "public"."care_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
