ALTER TABLE "appointment" ADD COLUMN "segments" json;--> statement-breakpoint
ALTER TABLE "appointment_item" ADD COLUMN "segments" json;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "segments" json;