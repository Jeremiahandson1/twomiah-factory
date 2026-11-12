-- Sales by staff, for sales made before it existed (store retest 11/12: this morning's counter sale and staff order were missing
-- from the report, and their stock moves read "Checkout"). A counter sale or a draft order made before orders kept who made them
-- is credited to the signed-in person who made it, as the audit log recorded it (its "create" row). Only orders with no one yet.
UPDATE "orders" o SET "staff_user_id" = a."user_id", "staff_name" = a."user_name"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "user_id", "user_name" FROM "audit_log"
  WHERE "entity" IN ('order', 'store_order') AND "action" = 'create' AND "user_id" IS NOT NULL
  ORDER BY "entity_id", "created_at" ASC
) a
WHERE a."entity_id" = o."id" AND o."staff_user_id" IS NULL AND o."source" IN ('counter', 'draft');
