CREATE TABLE IF NOT EXISTS "agreement_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"agreement_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"by_user_id" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"report" text NOT NULL,
	"name" text NOT NULL,
	"created_by_id" text,
	"params" json NOT NULL,
	"schedule" json,
	"last_sent_at" timestamp,
	"last_sent_for" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "service_agreement_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_agreement_id_service_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."service_agreement"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_event_agreement_idx" ON "agreement_event" USING btree ("agreement_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_event_company_kind_idx" ON "agreement_event" USING btree ("company_id","kind","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_report_company_idx" ON "saved_report" USING btree ("company_id","report");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_service_agreement_idx" ON "invoice" USING btree ("service_agreement_id");
--> statement-breakpoint
-- Plans that already exist get the history their own dates can prove: when each was made, and when each ended. Renewals,
-- suspensions and reactivations before today were not recorded and are not invented; the plan reports count them from here on.
INSERT INTO "agreement_event" ("id", "company_id", "agreement_id", "kind", "at", "by_user_id")
SELECT 'bk' || md5(a."id" || ':created'), a."company_id", a."id", 'created', a."created_at", a."sold_by_id" FROM "service_agreement" a
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "agreement_event" ("id", "company_id", "agreement_id", "kind", "at")
SELECT 'bk' || md5(a."id" || ':ended'), a."company_id", a."id",
       CASE WHEN a."ended_how" = 'expired' OR (a."ended_how" IS NULL AND a."status" = 'expired') THEN 'expired' ELSE 'cancelled' END,
       COALESCE(a."ended_at", a."updated_at")
FROM "service_agreement" a WHERE a."status" IN ('cancelled', 'expired')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- A plan's invoices were not linked to it. The ones billing wrote carry the plan's name in their line ("<name> - <frequency> billing")
-- and go to the plan's customer, so those are linked now; any invoice that matches no plan stays unlinked.
UPDATE "invoice" i SET "service_agreement_id" = m."agr"
FROM (
  SELECT DISTINCT ON (li."invoice_id") li."invoice_id" AS "inv", a."id" AS "agr"
  FROM "invoice_line_item" li
  JOIN "invoice" iv ON iv."id" = li."invoice_id"
  JOIN "service_agreement" a ON a."company_id" = iv."company_id" AND a."contact_id" = iv."contact_id"
       AND li."description" = a."name" || ' - ' || a."billing_frequency" || ' billing'
  ORDER BY li."invoice_id", a."created_at", a."id"
) m
WHERE i."id" = m."inv" AND i."service_agreement_id" IS NULL;
