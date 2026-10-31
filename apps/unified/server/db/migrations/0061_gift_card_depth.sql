ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_granted_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_expires_on" text;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "deliver_on" text;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "source" text DEFAULT 'desk' NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "session_id" text;--> statement-breakpoint
UPDATE "salon_gift_card" SET "delivered_at" = "created_at" WHERE "recipient_email" IS NOT NULL;
