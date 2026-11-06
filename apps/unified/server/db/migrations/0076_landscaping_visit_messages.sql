ALTER TABLE "landscaping_setting" ADD COLUMN "visit_text" text;--> statement-breakpoint
ALTER TABLE "landscaping_setting" ADD COLUMN "visit_email_subject" text;--> statement-breakpoint
ALTER TABLE "landscaping_setting" ADD COLUMN "visit_email_body" text;--> statement-breakpoint
ALTER TABLE "landscaping_setting" ADD COLUMN "visit_skip_services" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "landscaping_setting" ADD COLUMN "visit_alert_below" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_route_stop" ADD COLUMN "skip_visit_message" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_report" ADD COLUMN "message_subject" text;--> statement-breakpoint
ALTER TABLE "visit_report" ADD COLUMN "message_text" text;--> statement-breakpoint
ALTER TABLE "visit_report" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "visit_report" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "visit_report" ADD COLUMN "rated_at" timestamp;