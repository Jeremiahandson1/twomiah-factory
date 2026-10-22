ALTER TABLE "email_recipient" DROP CONSTRAINT "email_recipient_campaign_id_email_campaign_id_fk";
--> statement-breakpoint
-- A recipient row names a campaign of `campaign` from here on. Nothing ever wrote `email_campaign`, so no row could have
-- pointed at one; a row naming no campaign at all is cleared so the new key can be added (2026-10-22).
DELETE FROM "email_recipient" WHERE "campaign_id" NOT IN (SELECT "id" FROM "campaign");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The campaigns that failed on the wrong key carry the raw database error as their reason; they say it plainly instead.
UPDATE "campaign" SET "last_error" = 'None of these emails could be sent. Nothing went to your contacts — you can send it again.'
WHERE "status" = 'failed' AND "last_error" LIKE '%violates foreign key constraint%';
