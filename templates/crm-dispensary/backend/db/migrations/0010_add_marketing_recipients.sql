-- T46 N8: marketing had no record of who a campaign was sent to.
--
-- The send route called a function that did not exist, and the three public tracking routes beside
-- it — the open pixel, the click redirect and the unsubscribe link — all addressed a `recipientId`
-- that was never written anywhere. An unsubscribe link that does nothing is not a missing feature,
-- it is a legal obligation missed, and it cannot work without a row per recipient to point at.
CREATE TABLE IF NOT EXISTS marketing_recipients (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  campaign_id text NOT NULL,
  contact_id text,
  channel text DEFAULT 'email',
  address text,
  status text DEFAULT 'sent',
  error text,
  sent_at timestamp DEFAULT now(),
  opened_at timestamp,
  clicked_at timestamp,
  unsubscribed_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_recipient_company_idx ON marketing_recipients (company_id);
CREATE INDEX IF NOT EXISTS marketing_recipient_campaign_idx ON marketing_recipients (campaign_id);
