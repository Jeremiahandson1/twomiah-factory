-- The audit log filed /api/email-aliases as "email_aliase" (a trailing "s" stripped); the rule was fixed on 10/14.
-- Rows written before that keep the misspelling, and the Audit Log filter lists stored values — so correct them,
-- with the description the row carries ("Changed — email aliase"). Idempotent: nothing matches a second time.
UPDATE "audit_log" SET "entity" = 'email_alias', "metadata" = CASE WHEN "metadata" IS NULL THEN NULL ELSE replace("metadata"::text, 'email aliase"', 'email alias"')::jsonb END WHERE "entity" = 'email_aliase';
