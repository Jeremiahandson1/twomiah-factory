ALTER TABLE "crew" ADD COLUMN "requires_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "requires_approval" boolean;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "recipient_email" text;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "cc_emails" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "scope_es" text;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "link_days" integer;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "show_materials" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "show_photos" boolean DEFAULT true NOT NULL;