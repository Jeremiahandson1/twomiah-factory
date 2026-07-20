-- Per-tenant A2P 10DLC registration state.
--
-- Twomiah acts as the Twilio ISV and registers each tenant's own Brand +
-- Campaign (their EIN/legal identity) so tenant SMS is compliant 10DLC traffic
-- and Twomiah can bill for it. This adds the registration record to `tenants`,
-- consistent with how intake_data / preview / launch_followup were added.
--
-- a2p_data holds the tenant's EIN and legal/authorized-rep details ENCRYPTED
-- at rest (AES-256-GCM via apps/api/src/lib/crypto.ts) — never store the raw
-- EIN in plaintext. The *_sid columns are the Twilio Trust Hub / Messaging
-- resource IDs the provisioning step machine records as it advances.
--
-- Run on the live Supabase DB before deploying the A2P endpoints, or inserts/
-- updates will fail with 42703 (undefined column).

alter table tenants
  add column if not exists a2p_status text not null default 'not_started',
  add column if not exists a2p_data jsonb,
  add column if not exists a2p_profile_sid text,
  add column if not exists a2p_trust_bundle_sid text,
  add column if not exists a2p_brand_sid text,
  add column if not exists a2p_messaging_service_sid text,
  add column if not exists a2p_campaign_sid text,
  add column if not exists a2p_phone_number text,
  add column if not exists a2p_rejection_reason text,
  add column if not exists a2p_submitted_at timestamptz,
  add column if not exists a2p_approved_at timestamptz;

-- Status lifecycle written by the app:
--   not_started  — no A2P data collected yet (default)
--   collected    — EIN/legal data captured + encrypted, not yet submitted
--   provisioning — step machine is creating Twilio resources
--   pending      — submitted to Twilio/TCR, awaiting vetting (hours–days)
--   approved     — brand + campaign approved; messaging service ready
--   rejected     — vetting failed; see a2p_rejection_reason, then resubmit
--   error        — provisioning call errored mid-flight; resumable
alter table tenants drop constraint if exists tenants_a2p_status_check;
alter table tenants add constraint tenants_a2p_status_check
  check (a2p_status in ('not_started','collected','provisioning','pending','approved','rejected','error'));

-- Cheap lookup for the poller: only rows mid-flight need status refresh.
create index if not exists idx_tenants_a2p_pending
  on tenants(a2p_submitted_at)
  where a2p_status in ('provisioning','pending');
