-- Salon live test, 2026-10-25.
--   1. A salon's Service Menu is the one list behind online booking: booking_service.service_menu_id links the row the
--      booking engine offers to the menu item it is (crm/salon/onlineBooking.ts keepOnlineService keeps it from here on).
--      Menu items already ticked "Bookable online" — a box nothing read until now — get their row here.
--   2. Booking hours follow the business's opening hours until the owner sets hours of their own
--      (booking_settings.hours_set_at). The weekday 9–5 rows provisioning seeded were never the owner's: they were
--      written in the company's own provisioning transaction, so their created_at IS the company's (one now() per
--      transaction). Those are removed, said in the audit log; every other company with booking hours keeps them as its
--      own. A business with neither books weekdays 9–5, as before, and the settings screen says so.
ALTER TABLE "booking_service" ADD COLUMN "service_menu_id" text;--> statement-breakpoint
ALTER TABLE "booking_settings" ADD COLUMN "hours_set_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_service" ADD CONSTRAINT "booking_service_service_menu_id_service_menu_id_fk" FOREIGN KEY ("service_menu_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_service_service_menu_id_key" ON "booking_service" USING btree ("service_menu_id");--> statement-breakpoint
INSERT INTO "booking_service" ("id", "company_id", "service_menu_id", "slug", "name", "description", "duration_minutes", "price", "active", "created_at", "updated_at")
SELECT md5(random()::text || clock_timestamp()::text || m."id"), m."company_id", m."id",
  CASE WHEN m."n" = 1 AND NOT EXISTS (SELECT 1 FROM "booking_service" b WHERE b."company_id" = m."company_id" AND b."slug" = m."base")
    THEN m."base" ELSE m."base" || '-' || lower(substr(m."id", 1, 8)) END,
  m."name", m."description", m."duration_min", m."price", true, now(), now()
FROM (
  SELECT s.*, row_number() OVER (PARTITION BY s."company_id", s."base" ORDER BY s."created_at", s."id") AS "n"
  FROM (
    SELECT sm.*, coalesce(nullif(trim(both '-' from left(regexp_replace(lower(sm."name"), '[^a-z0-9]+', '-', 'g'), 50)), ''), 'service') AS "base"
    FROM "service_menu" sm WHERE sm."bookable_online" AND sm."active"
  ) s
) m
WHERE NOT EXISTS (SELECT 1 FROM "booking_service" x WHERE x."service_menu_id" = m."id");
--> statement-breakpoint
WITH "seeded" AS (
  DELETE FROM "booking_hours" bh USING "company" c
  WHERE bh."company_id" = c."id" AND bh."created_at" = c."created_at"
  RETURNING bh."company_id"
)
INSERT INTO "audit_log" ("id", "action", "entity", "entity_id", "entity_name", "metadata", "company_id", "created_at")
SELECT md5(random()::text || clock_timestamp()::text || c."id" || 'hours'), 'update', 'company', c."id", c."name",
  json_build_object('fields', json_build_array('booking_hours'), 'description',
    'Online booking hours now follow your opening hours (Settings › Company). The weekday 9–5 hours set up with your account were removed; set booking hours of your own under Bookings › Settings to book on different hours.'),
  c."id", now()
FROM "company" c WHERE c."id" IN (SELECT "company_id" FROM "seeded");
--> statement-breakpoint
INSERT INTO "booking_settings" ("id", "company_id", "hours_set_at")
SELECT md5(random()::text || clock_timestamp()::text || h."company_id" || 'settings'), h."company_id", now()
FROM (SELECT DISTINCT "company_id" FROM "booking_hours") h
ON CONFLICT ("company_id") DO UPDATE SET "hours_set_at" = now();
