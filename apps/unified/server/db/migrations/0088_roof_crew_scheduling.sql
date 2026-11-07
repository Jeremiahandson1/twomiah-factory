ALTER TABLE "crew" ADD COLUMN "trades" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "crew" ADD COLUMN "certificates" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "checklist" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "checks" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "arrived_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "left_at" timestamp;