-- Client signable documents (home care).
--
-- Home care had no way for a client or their responsible party to sign
-- anything. The form builder's "signature" is a typed name captured from a
-- logged-in STAFF user (routes/forms.ts is behind authenticate) with no IP,
-- user agent, consent or document hash — and no client ever sees it. Service
-- agreements, client rights, HIPAA acknowledgments and consent to care were
-- all paper.
--
-- Evidence model matches the quote/change-order e-signature work in the other
-- templates: signature image + typed name + explicit consent + IP + user agent
-- + SHA-256 over the exact document text that was signed.
--
-- The document body is SNAPSHOT onto the row when it is sent. Editing a
-- template afterwards must never change what somebody already signed.

CREATE TABLE IF NOT EXISTS "client_document_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "requires_relationship" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "client_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "template_id" text,
  "document_key" text NOT NULL,
  "title" text NOT NULL,
  -- the exact text that was presented; never rewritten after sending
  "body" text NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "viewed_at" timestamp,
  "signed_at" timestamp,
  "signed_by" text,
  "signer_relationship" text,
  "signed_ip" text,
  "signed_user_agent" text,
  "signature_image" text,
  "consent_at" timestamp,
  "document_hash" text,
  "declined_at" timestamp,
  "decline_reason" text,
  "voided_at" timestamp,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "client_documents"
    ADD CONSTRAINT "client_documents_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "client_documents"
    ADD CONSTRAINT "client_documents_template_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "client_document_templates"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "client_documents_client_id_idx" ON "client_documents" ("client_id");
CREATE INDEX IF NOT EXISTS "client_documents_status_idx" ON "client_documents" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "client_document_templates_key_idx" ON "client_document_templates" ("key");
