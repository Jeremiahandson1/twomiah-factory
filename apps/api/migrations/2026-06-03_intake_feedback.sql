-- Customer-side change requests on a show-first website preview.
--
-- When a prospect opens their preview at /api/v1/factory/public/intake/:id/preview,
-- the rendered HTML carries a floating "Request changes" widget. Submissions
-- land here. Staff triages, adjusts the intake (or hand-edits later), re-runs
-- the preview, and the prospect refreshes to see v2.
--
-- One intake → many feedback rows (versioned change log, never overwritten).

create table if not exists intake_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  message text not null,
  contact_email text,
  preview_generated_at timestamptz,  -- snapshot of which preview version this was against
  status text not null default 'pending' check (status in ('pending', 'addressed', 'wontfix')),
  created_at timestamptz not null default now(),
  addressed_at timestamptz
);

create index if not exists intake_feedback_tenant_id_idx on intake_feedback (tenant_id);
create index if not exists intake_feedback_status_created_idx on intake_feedback (status, created_at desc);
