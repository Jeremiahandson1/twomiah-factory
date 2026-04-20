-- Inbound Parse messages for CRM-mode aliases.

CREATE TABLE IF NOT EXISTS "inbound_message" (
  "id" text PRIMARY KEY NOT NULL,
  "to_local_part" text NOT NULL,
  "from_email" text NOT NULL,
  "from_name" text,
  "subject" text,
  "text_body" text,
  "html_body" text,
  "spf_verdict" text,
  "dkim_verdict" text,
  "raw_headers" text,
  "received_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_received_at_idx" ON "inbound_message" ("received_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_from_email_idx" ON "inbound_message" ("from_email");
