-- Call tracking numbers sold by Twomiah (services/callTrackingNumbers.ts): one row per local number bought on the Twilio ISV
-- account for a business, and the business's own "Call tracking number" subscription. Run once against the Factory Supabase
-- (SQL editor). Idempotent. Nothing writes here until a business with the hidden call_tracking_numbers feature asks for one.
create table if not exists call_tracking_numbers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  twilio_sid   text not null unique,          -- PN…, the IncomingPhoneNumber
  phone_number text not null,                 -- +1XXXXXXXXXX
  label        text not null,                 -- what it is for: "Google Ads", "Yard signs"
  forward_to   text,                          -- the business's line, as asked (the CRM keeps the one it rings)
  bought_at    timestamptz not null default now(),
  released_at  timestamptz                    -- given back to Twilio; billed for its calls a few days more
);
create index if not exists call_tracking_numbers_tenant_idx on call_tracking_numbers(tenant_id) where released_at is null;

alter table tenants add column if not exists calltrack_sub_id text;

-- Each call is charged once: the hourly pass looks its 'call:<CallSid>' up in the ledger before it debits.
create index if not exists messaging_ledger_twilio_ref_idx on messaging_ledger(tenant_id, twilio_ref);

-- Row-level security ON with no policy: only the service role (the Factory's server) reads or writes it.
alter table call_tracking_numbers enable row level security;
grant select, insert, update, delete on table call_tracking_numbers to service_role;
