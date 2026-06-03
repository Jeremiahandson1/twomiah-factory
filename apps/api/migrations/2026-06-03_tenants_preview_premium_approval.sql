-- Staff approval gate on the premium preview.
--
-- The show-first promise is "1 business day", not "immediate". We compose
-- the preview right after intake (so staff has something to review fast),
-- but the public link doesn't render until staff approves it. Prevents
-- the AI from showing prospects content that's off-brand or wrong about
-- the business.
--
-- approved_at is the gate. approved_by is the platform user id who clicked
-- approve (for audit). Both null = pending.

alter table tenants
  add column if not exists preview_premium_approved_at timestamptz,
  add column if not exists preview_premium_approved_by uuid;
