DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'email_recipient_campaign_id_email_campaign_id_fk') THEN
    ALTER TABLE "email_recipient" DROP CONSTRAINT "email_recipient_campaign_id_email_campaign_id_fk";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_recipient')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'email_recipient_campaign_id_campaign_id_fk') THEN
    -- NOT VALID: enforce the key for new rows without touching or deleting a
    -- single existing row.
    ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_campaign_id_campaign_id_fk"
      FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
