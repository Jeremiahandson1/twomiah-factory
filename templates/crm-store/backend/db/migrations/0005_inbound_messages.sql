CREATE TABLE "inbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_local_part" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"spf_verdict" text,
	"dkim_verdict" text,
	"raw_headers" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "inbound_message_received_at_idx" ON "inbound_message" USING btree ("received_at");