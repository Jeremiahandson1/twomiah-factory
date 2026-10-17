-- A tap's pour sizes (services/barTapSizes.ts): a pint, a pitcher, a taster, each with its ounces and price.
-- Empty means the single pour the tap always had (pour_oz at price_cents), so every existing tap is unchanged.
ALTER TABLE "bar_tap" ADD COLUMN IF NOT EXISTS "sizes" json DEFAULT '[]'::json NOT NULL;
