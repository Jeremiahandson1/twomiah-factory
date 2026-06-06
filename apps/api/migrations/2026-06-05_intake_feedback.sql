-- Customer-facing feedback on premium-website previews. A customer
-- viewing /public/intake/<id>/preview-premium can hit a "Request
-- changes" widget and tell us what they want different. Each submission
-- creates a row here. Staff sees the queue in the premium-review page
-- and can either edit manually or trigger a recompose with the feedback
-- threaded into the composer input.

CREATE TABLE IF NOT EXISTS intake_feedback (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message    text NOT NULL,
  -- 'new' | 'reviewed' | 'recomposed' — drives the staff queue + lets
  -- us avoid re-acting on feedback we've already processed.
  status     text NOT NULL DEFAULT 'new',
  -- Optional: when staff/auto-recompose triggers a new preview from
  -- this feedback, point at the resulting preview_premium_generated_at
  -- so we can audit the loop.
  recomposed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_feedback_tenant_id_idx ON intake_feedback (tenant_id);
CREATE INDEX IF NOT EXISTS intake_feedback_status_created_idx ON intake_feedback (status, created_at);
