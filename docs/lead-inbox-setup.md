# Lead Inbox — inbound routing

## Overview

The Lead Inbox (shared module `packages/tenant-backend/src/leads` + `packages/tenant-ui/src/leads`, one implementation for
every CRM) receives leads two ways:

1. **Email** — a platform forwards its lead-notification email to the tenant's lead address
   `{factoryTenantId-without-dashes}-leads-{platform}@parse.twomiah.com`.
2. **Webhooks** — Zapier / Make / any platform that can POST sends JSON or form-encoded payloads to
   `{tenant-url}/api/leads/inbound/webhook/{platform}?secret={webhookSecret}`.

Which platforms a vertical offers lives in each template's `frontend/src/leadsConfig.ts` (labels, colours, setup steps —
also the source of the Integrations-page guides) and `backend/src/routes/leads.ts` (`options.platforms`, the allow-list).
The trades set (Angi, HomeAdvisor, Thumbtack, Google LSA, Houzz) has platform-specific email parsers; every other
platform uses the generic label-based parser (`Name:`, `Phone:`, `Email:`, `Message:` …).

## Email path (shared with branded-email aliases)

```
lead email → MX parse.twomiah.com (mx.sendgrid.net) → SendGrid Inbound Parse
          → Factory POST /api/v1/factory/inbound-parse/:secret        (apps/api/src/routes/factory/lifecycle.ts)
          → local part "<32-hex tenant id>-leads-<platform>"          → tenant POST /api/leads/inbound/email
            any other local part (support, admin …)                   → tenant POST /api/internal/inbound-email
```

- `parse.twomiah.com` is the Factory's `SENDGRID_INBOUND_PARSE_HOSTNAME`; the MX record and the SendGrid parse setting
  already exist (proven 2026-09-13: a real email to `<tenant>-probe@parse.twomiah.com` reached the contractor test
  tenant's inbound messages in ~10 s, SPF pass).
- The local-part prefix **`leads-` is reserved** for lead sources; branded-email aliases must not use it.
- The Factory posts `{platform, from, subject, text, html}` with `X-Factory-Key: tenants.factory_sync_key`. The tenant
  refuses the call without the key (401), with `FACTORY_SYNC_KEY` unset (503), for an unknown or disabled platform (404).
- Tenants can override the hostname with `INBOUND_PARSE_HOSTNAME` (default `parse.twomiah.com`).
- Stored `lead_source.inbound_email` values self-heal to the current address on the next `GET /api/leads/sources`.

History: until 2026-09-13 lead addresses were `leads+{prefix}-{platform}@inbound.twomiah.com`, handled by a separate
Factory router (`/public/inbound-email`). That hostname never had DNS, so no lead email could ever arrive; the router
was removed.

## Webhook path

- Requires the per-source secret (`?secret=` or `x-webhook-secret` header); the Lead Sources page shows the URL with the
  secret appended. A lead source can be added once per platform; unknown platform ids are refused (400).

## Per-tenant setup (tenant admin, in the CRM)

1. **Lead Sources** in the sidebar (feature `lead_inbox`) → **Add Source** → pick a platform
2. The card shows the inbound email address, the webhook URL (secret included) and the platform's setup steps
3. Leads land in **Lead Inbox**; Call / Text mark them contacted; **Convert to Contact** links an existing contact with
   the same email or phone instead of creating a duplicate, and refuses a second convert

## Testing

```bash
# Real email end to end (sends one message to the parse hostname, never to a person):
#   scratchpad/parse-e2e.ts  LOCAL=leads-angi BODY="Customer: …\nPhone: …"
# Tenant endpoint directly (needs the tenant's FACTORY_SYNC_KEY):
curl -X POST https://{tenant-url}/api/leads/inbound/email \
  -H "Content-Type: application/json" -H "X-Factory-Key: {FACTORY_SYNC_KEY}" \
  -d '{"platform":"angi","from":"notifications@angi.com","subject":"New Lead from Angi: John Smith - Roof Replacement",
       "text":"Customer: John Smith\nPhone: (555) 123-4567\nEmail: john@example.com\nService: Roof Replacement\nLocation: Dallas, TX"}'

# Webhook (Zapier / Make shape)
curl -X POST "https://{tenant-url}/api/leads/inbound/webhook/thumbtack?secret={webhookSecret}" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"Jane Doe","email":"jane@example.com","phone":"(555) 987-6543"},"request":{"category":"Roof Repair","location":"Austin, TX","details":"Leaking roof"}}'
```
