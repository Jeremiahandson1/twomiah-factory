-- ONE CLOCK (coordinator 2026-10-23). The business's time zone is the company's (Settings › Company, company.timezone; blank
-- = its state's). Online bookings (booking_settings.timezone), the AI receptionist (ai_receptionist_settings.timezone) and
-- a bar's hours (bar_settings.hours->>'timezone') each kept one of their own, which the app no longer reads.
--
-- Moved with care, and never silently:
--   1. A company with no zone of its own takes its booking zone — what its customers have been booking against.
--   2. Still none: the AI receptionist's, where one was saved; then a bar's.
--   3. Where one of them DIFFERS from the company's zone, the company's stands and the audit log says so, naming both.
--      Booked appointments are instants and keep their times; only the open hours are now read on the company's clock.
-- Only names Postgres knows are taken (pg_timezone_names).
UPDATE "company" c SET "timezone" = bs."timezone", "updated_at" = now()
FROM "booking_settings" bs
WHERE bs."company_id" = c."id"
  AND (c."timezone" IS NULL OR btrim(c."timezone") = '')
  AND bs."timezone" IN (SELECT "name" FROM pg_timezone_names);
--> statement-breakpoint
UPDATE "company" c SET "timezone" = ai."timezone", "updated_at" = now()
FROM "ai_receptionist_settings" ai
WHERE ai."company_id" = c."id"
  AND (c."timezone" IS NULL OR btrim(c."timezone") = '')
  AND ai."timezone" IN (SELECT "name" FROM pg_timezone_names);
--> statement-breakpoint
UPDATE "company" c SET "timezone" = b."hours"->>'timezone', "updated_at" = now()
FROM "bar_settings" b
WHERE b."company_id" = c."id"
  AND (c."timezone" IS NULL OR btrim(c."timezone") = '')
  AND (b."hours"->>'timezone') IN (SELECT "name" FROM pg_timezone_names);
--> statement-breakpoint
INSERT INTO "audit_log" ("id", "action", "entity", "entity_id", "entity_name", "metadata", "company_id", "created_at")
SELECT md5(random()::text || clock_timestamp()::text || c."id" || 'booking'), 'update', 'company', c."id", c."name",
  json_build_object('fields', json_build_array('timezone'), 'description',
    'Online bookings now keep time on the business''s time zone, ' || c."timezone" || ' (Settings › Company). Booking settings had '
    || bs."timezone" || '. Booked appointments keep their times; check the open hours under Bookings › Settings.'),
  c."id", now()
FROM "company" c JOIN "booking_settings" bs ON bs."company_id" = c."id"
WHERE c."timezone" IS NOT NULL AND btrim(c."timezone") <> '' AND bs."timezone" <> c."timezone";
--> statement-breakpoint
INSERT INTO "audit_log" ("id", "action", "entity", "entity_id", "entity_name", "metadata", "company_id", "created_at")
SELECT md5(random()::text || clock_timestamp()::text || c."id" || 'ai'), 'update', 'company', c."id", c."name",
  json_build_object('fields', json_build_array('timezone'), 'description',
    'The AI Receptionist now judges after hours on the business''s time zone, ' || c."timezone" || ' (Settings › Company). It had '
    || ai."timezone" || '.'),
  c."id", now()
FROM "company" c JOIN "ai_receptionist_settings" ai ON ai."company_id" = c."id"
WHERE c."timezone" IS NOT NULL AND btrim(c."timezone") <> '' AND ai."timezone" <> c."timezone";
--> statement-breakpoint
INSERT INTO "audit_log" ("id", "action", "entity", "entity_id", "entity_name", "metadata", "company_id", "created_at")
SELECT md5(random()::text || clock_timestamp()::text || c."id" || 'bar'), 'update', 'company', c."id", c."name",
  json_build_object('fields', json_build_array('timezone'), 'description',
    'The bar''s hours now keep time on the business''s time zone, ' || c."timezone" || ' (Settings › Company). They had '
    || (b."hours"->>'timezone') || '.'),
  c."id", now()
FROM "company" c JOIN "bar_settings" b ON b."company_id" = c."id"
WHERE c."timezone" IS NOT NULL AND btrim(c."timezone") <> '' AND coalesce(b."hours"->>'timezone', '') <> ''
  AND (b."hours"->>'timezone') <> c."timezone";
