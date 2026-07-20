-- Messaging usage billing (v2 model): $10/mo flat ENABLE fee (carries margin)
-- + a prepaid WALLET that Twilio costs draw down AT COST — A2P registration,
-- monthly campaign fee, and per-message carrier fees. Per the finalized pricing
-- model: never let the flat enable fee absorb variable carrier costs.
--
-- Apply manually on the live Supabase DB before deploying the messaging-billing
-- endpoints, or inserts/updates fail with 42703 (undefined column).

alter table tenants
  add column if not exists messaging_enabled boolean not null default false,
  add column if not exists messaging_enabled_at timestamptz,
  -- Stripe subscription id for the $10/mo messaging-enable line (separate from
  -- the tenant's main plan subscription), so it can be cancelled on disable.
  add column if not exists messaging_sub_id text,
  -- Prepaid balance in cents. Cached sum of messaging_ledger; the ledger is the
  -- source of truth (balance_after_cents on the latest row must equal this).
  add column if not exists messaging_wallet_cents integer not null default 0;

-- Every credit (top-up) and debit (Twilio cost at cost) — the auditable
-- "your texts at cost" trail. amount_cents is always positive; `kind` sets sign.
create table if not exists messaging_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('credit', 'debit')),
  amount_cents integer not null check (amount_cents >= 0),
  reason text not null,                 -- e.g. 'a2p_registration', 'sms_segment', 'topup', 'monthly_campaign'
  twilio_ref text,                      -- Twilio SID/usage ref for the cost, when applicable
  stripe_ref text,                      -- Stripe payment ref for top-ups
  balance_after_cents integer not null, -- running balance after this entry
  created_at timestamptz not null default now()
);

create index if not exists idx_msg_ledger_tenant on messaging_ledger(tenant_id, created_at desc);

-- Atomic credit/debit: bumps the balance and writes the ledger row in ONE
-- transaction so concurrent per-message debits can't lose updates. Debits that
-- would overdraw raise 'insufficient balance' (unless p_allow_negative), which
-- rolls back the whole call. Returns the new balance. Call via supabase.rpc().
create or replace function messaging_wallet_apply(
  p_tenant uuid,
  p_kind text,
  p_amount integer,
  p_reason text,
  p_twilio_ref text default null,
  p_stripe_ref text default null,
  p_allow_negative boolean default false
) returns integer as $$
declare
  v_delta integer := case when p_kind = 'credit' then p_amount else -p_amount end;
  v_new integer;
begin
  if p_amount < 0 then raise exception 'amount must be non-negative'; end if;
  if p_kind not in ('credit', 'debit') then raise exception 'bad kind'; end if;

  update tenants set messaging_wallet_cents = messaging_wallet_cents + v_delta
    where id = p_tenant
    returning messaging_wallet_cents into v_new;
  if not found then raise exception 'tenant not found'; end if;
  if v_new < 0 and not p_allow_negative then raise exception 'insufficient balance'; end if;

  insert into messaging_ledger(tenant_id, kind, amount_cents, reason, twilio_ref, stripe_ref, balance_after_cents)
    values (p_tenant, p_kind, p_amount, p_reason, p_twilio_ref, p_stripe_ref, v_new);
  return v_new;
end;
$$ language plpgsql;
