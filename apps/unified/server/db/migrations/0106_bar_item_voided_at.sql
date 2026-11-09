-- The moment a line was voided, so a night's voids are the ones made that night, its check open or not (bar live test 2026-11-09).
ALTER TABLE "bar_check_item" ADD COLUMN "voided_at" timestamp;