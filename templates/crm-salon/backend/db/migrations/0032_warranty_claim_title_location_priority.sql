ALTER TABLE "warranty_claim" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD COLUMN IF NOT EXISTS "location" text;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal';--> statement-breakpoint
-- Give the claims that already exist a label. The title used to be welded onto the front of the
-- description, so take the part before the first ': ' where there is one and the whole description
-- where there is not. `description` is deliberately left untouched: nothing is lost either way.
UPDATE "warranty_claim"
SET "title" = CASE
  WHEN position(': ' in "description") > 0
    THEN substring("description" from 1 for position(': ' in "description") - 1)
  ELSE "description"
END
WHERE "title" IS NULL;
