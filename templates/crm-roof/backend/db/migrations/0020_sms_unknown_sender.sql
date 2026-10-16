-- A text from a number that belongs to no contact is kept, unlinked, instead of failing: the inbound webhook wrote
-- contact_id 'unknown', which the foreign key refused, and the text was lost behind a 500. It is filed under the
-- contact when one with that number is opened (services/sms.ts linkUnknownTexts).
ALTER TABLE "sms_message" ALTER COLUMN "contact_id" DROP NOT NULL;
