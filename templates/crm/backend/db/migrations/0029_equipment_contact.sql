-- Equipment belongs to a CUSTOMER. (T32 H9)
--
-- The Equipment form offers "Customer" and posts `contactId`. crm-basic, crm-fieldservice and
-- crm-landscaping all have `equipment.contact_id` and all three pass `options: { contacts: true }`.
-- The base contractor CRM had neither, so the field was offered, posted, and dropped: the report
-- entered "T32 Client Rivera" and the saved record had no customer link at all.
--
-- The module is customer-asset tracking — a furnace, a water heater, a generator at a client's
-- address. Without the customer it is a list of serial numbers belonging to nobody, which is also
-- why the Jobs screen's equipment picker (`GET /api/equipment?contactId=…`) returned the whole
-- company's equipment on this template.
--
-- ON DELETE SET NULL, matching the three siblings: deleting a contact must not delete the record of
-- the plant installed at their property.
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "contact_id" text;

DO $$ BEGIN
  ALTER TABLE "equipment"
    ADD CONSTRAINT "equipment_contact_id_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "equipment_contact_id_idx" ON "equipment" ("contact_id");
