-- The floor (services/barFloor.ts): the room's booths, tables and bar seats, as the floor screen draws them.
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "floor" json;
