-- Toll-free SMS as an alternative to A2P 10DLC. Same wallet/enable, but a
-- different registration path: buy a toll-free number → Toll-Free Verification
-- (no A2P brand/campaign, no ~$19 registration, no ~$10/mo campaign fee).
--
--   a2p_channel: 'a2p' (local 10DLC, default) | 'tollfree'
--   a2p_tollfree_sid: the Twilio Toll-Free Verification SID
--
-- The existing a2p_status / a2p_messaging_service_sid / a2p_phone_number /
-- a2p_number_monthly_cents columns are reused for both channels.
-- Apply manually on the live Supabase DB before deploying.

alter table tenants
  add column if not exists a2p_channel text not null default 'a2p',
  add column if not exists a2p_tollfree_sid text;

alter table tenants drop constraint if exists tenants_a2p_channel_check;
alter table tenants add constraint tenants_a2p_channel_check
  check (a2p_channel in ('a2p', 'tollfree'));
