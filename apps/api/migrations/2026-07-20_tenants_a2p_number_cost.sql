-- Store the ACTUAL monthly rental Twilio charges for each tenant's number
-- (captured from Twilio's live pricing at purchase), so the wallet debits the
-- real cost per number instead of a flat estimate. Null → fall back to the
-- TWILIO_NUMBER_MONTHLY_CENTS config default (e.g. for manually-attached numbers).
--
-- Apply manually on the live Supabase DB before deploying.

alter table tenants
  add column if not exists a2p_number_monthly_cents integer;
