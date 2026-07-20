-- AI usage billing — same v2 shape as SMS: $10/mo flat ENABLE fee (margin) +
-- Claude tokens billed AT COST from the SAME prepaid wallet as messaging
-- (messaging_wallet_cents / messaging_ledger). One usage wallet, one top-up;
-- ledger `reason` distinguishes 'ai_tokens' from 'sms_segment'.
--
-- Apply manually on the live Supabase DB before deploying the AI endpoints.

alter table tenants
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_enabled_at timestamptz,
  -- Stripe subscription id for the $10/mo AI-enable line (separate from the
  -- plan + messaging-enable subscriptions), so it can be cancelled on disable.
  add column if not exists ai_sub_id text;
