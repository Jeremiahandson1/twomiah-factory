DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'email_recipient_campaign_id_email_campaign_id_fk') THEN
    ALTER TABLE "email_recipient" DROP CONSTRAINT "email_recipient_campaign_id_email_campaign_id_fk";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_recipient')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'email_recipient_campaign_id_campaign_id_fk') THEN
    DELETE FROM "email_recipient" WHERE "campaign_id" NOT IN (SELECT "id" FROM "campaign");
    ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_campaign_id_campaign_id_fk"
      FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE CASCADE;
  END IF;
END $$;
