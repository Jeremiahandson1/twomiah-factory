CREATE TABLE IF NOT EXISTS "support_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text,
	"type" text DEFAULT 'internal' NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"sla_response_due" timestamp,
	"sla_resolve_due" timestamp,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"escalated_at" timestamp,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"ai_category" text,
	"ai_priority_score" integer,
	"rating" integer,
	"rating_comment" text,
	"contact_id" text,
	"assigned_to_id" text,
	"created_by_id" text,
	"company_id" text NOT NULL,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_message" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"attachments" json DEFAULT '[]'::json NOT NULL,
	"ticket_id" text NOT NULL,
	"user_id" text,
	"contact_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_knowledge_base" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"is_faq" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"company_id" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"response_time_minutes" integer NOT NULL,
	"resolve_time_minutes" integer NOT NULL,
	"escalate_after_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_ticket_id_support_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_ticket"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_knowledge_base" ADD CONSTRAINT "support_knowledge_base_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_knowledge_base" ADD CONSTRAINT "support_knowledge_base_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_sla_policy" ADD CONSTRAINT "support_sla_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_company_id_idx" ON "support_ticket" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_status_idx" ON "support_ticket" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_priority_idx" ON "support_ticket" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_assigned_to_idx" ON "support_ticket" USING btree ("assigned_to_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_contact_id_idx" ON "support_ticket" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_category_idx" ON "support_ticket" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_message_ticket_id_idx" ON "support_ticket_message" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_kb_company_id_idx" ON "support_knowledge_base" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_kb_category_idx" ON "support_knowledge_base" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sla_policy_company_id_idx" ON "support_sla_policy" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");
