ALTER TABLE "service_menu" ADD COLUMN "prepay_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "keep_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_service" ADD COLUMN "prepay" boolean DEFAULT false NOT NULL;