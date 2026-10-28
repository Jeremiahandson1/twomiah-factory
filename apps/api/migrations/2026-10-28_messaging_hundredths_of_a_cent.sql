-- Texting at true cost: the wallet and its ledger are kept in HUNDREDTHS OF A CENT ("hc", $1 = 10,000 hc).
--
-- A text costs ~1.26¢ (Twilio $0.0083 + the carrier's fee); whole-cent columns could only charge 1¢ or 2¢ and lost the
-- difference on every text. Twilio quotes prices to four decimals of a dollar, so hundredths of a cent hold every price
-- exactly, as integers — thousands of texts add up with no rounding.
--
-- Lossless: every existing whole-cent balance and ledger row becomes exactly cents × 100. The old *_cents columns are
-- kept, now GENERATED from the hc ones (floor to whole cents), so anything that still reads them keeps working and
-- can never disagree with the exact figure. The old integer-argument messaging_wallet_apply() is replaced.
--
-- Apply on the live Supabase DB before deploying this Factory version (the code reads/writes the hc columns).

begin;

alter table tenants add column if not exists messaging_wallet_hc bigint not null default 0;
update tenants set messaging_wallet_hc = messaging_wallet_cents::bigint * 100
  where messaging_wallet_hc = 0 and messaging_wallet_cents <> 0;
alter table tenants drop column messaging_wallet_cents;
alter table tenants add column messaging_wallet_cents integer
  generated always as (floor(messaging_wallet_hc / 100.0)::integer) stored;

alter table messaging_ledger add column if not exists amount_hc bigint;
alter table messaging_ledger add column if not exists balance_after_hc bigint;
update messaging_ledger set amount_hc = amount_cents::bigint * 100, balance_after_hc = balance_after_cents::bigint * 100
  where amount_hc is null;
alter table messaging_ledger alter column amount_hc set not null;
alter table messaging_ledger alter column balance_after_hc set not null;
alter table messaging_ledger add constraint messaging_ledger_amount_hc_nonneg check (amount_hc >= 0);
alter table messaging_ledger drop column amount_cents;
alter table messaging_ledger drop column balance_after_cents;
alter table messaging_ledger add column amount_cents integer
  generated always as (floor(amount_hc / 100.0)::integer) stored;
alter table messaging_ledger add column balance_after_cents integer
  generated always as (floor(balance_after_hc / 100.0)::integer) stored;

drop function if exists messaging_wallet_apply(uuid, text, integer, text, text, text, boolean);

-- Atomic credit/debit in hundredths of a cent; returns the new balance in hc.
create or replace function messaging_wallet_apply(
  p_tenant uuid,
  p_kind text,
  p_amount bigint,
  p_reason text,
  p_twilio_ref text default null,
  p_stripe_ref text default null,
  p_allow_negative boolean default false
) returns bigint as $$
declare
  v_delta bigint := case when p_kind = 'credit' then p_amount else -p_amount end;
  v_new bigint;
begin
  if p_amount < 0 then raise exception 'amount must be non-negative'; end if;
  if p_kind not in ('credit', 'debit') then raise exception 'bad kind'; end if;

  update tenants set messaging_wallet_hc = messaging_wallet_hc + v_delta
    where id = p_tenant
    returning messaging_wallet_hc into v_new;
  if not found then raise exception 'tenant not found'; end if;
  if v_new < 0 and not p_allow_negative then raise exception 'insufficient balance'; end if;

  insert into messaging_ledger(tenant_id, kind, amount_hc, reason, twilio_ref, stripe_ref, balance_after_hc)
    values (p_tenant, p_kind, p_amount, p_reason, p_twilio_ref, p_stripe_ref, v_new);
  return v_new;
end;
$$ language plpgsql;

commit;
