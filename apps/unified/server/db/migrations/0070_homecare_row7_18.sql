-- Row 7: one No-Show alert per scheduled visit. Any older duplicates (same agency, schedule and day) are reduced to the earliest first,
-- so the unique index can be built on every database.
DELETE FROM "noshow_alerts" a USING "noshow_alerts" b
 WHERE a."company_id" = b."company_id" AND a."schedule_id" = b."schedule_id" AND a."shift_date" = b."shift_date"
   AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "noshow_alerts_once_idx" ON "noshow_alerts" USING btree ("company_id","schedule_id","shift_date");