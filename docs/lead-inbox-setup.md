# Lead Inbox — inbound routing setup

## Overview

The Lead Inbox (shared module `packages/tenant-backend/src/leads` + `packages/tenant-ui/src/leads`, one implementation for
every CRM) receives leads from external platforms via two mechanisms:

1. **Email parsing** — a platform forwards its lead-notification email to the tenant's inbound address
   `leads+{tenantIdPrefix}-{platform}@inbound.twomiah.com`. SendGrid Inbound Parse posts it to the Factory, the Factory
   routes it to the right tenant and forwards it to the tenant's `/api/leads/inbound/email`.
2. **Direct webhooks** — Zapier / Make / any platform that can POST sends JSON or form-encoded payloads to
   `{tenant-url}/api/leads/inbound/webhook/{platform}?secret={webhookSecret}`.

Which platforms a vertical offers lives in each template's `frontend/src/leadsConfig.ts` (labels, colours, setup steps —
also the source of the Integrations-page guides) and `backend/src/routes/leads.ts` (`options.platforms`, the allow-list).
The trades set (Angi, HomeAdvisor, Thumbtack, Google LSA, Houzz) has platform-specific email parsers; every other platform
uses the generic label-based parser (`Name:`, `Phone:`, `Email:`, `Message:` …).

## Addressing and security

- **Inbound address prefix = first 8 chars of the FACTORY tenant id** (the tenant's `TENANT_ID` env). The Factory's
  router matches on that. (Before 2026-09-13 the CRM handed out the CRM *company* id prefix, which the Factory could
  never match — inbound email never routed for any tenant. Existing `lead_source` rows self-heal on the next
  `GET /api/leads/sources`.)
- **`/inbound/email` requires `X-Factory-Key`** = the tenant's `FACTORY_SYNC_KEY` (the same key used for
  `sync-features`). The Factory sends `tenants.factory_sync_key`. Without the key the tenant answers 401; with the env
  unset it answers 503.
- **`/inbound/webhook/:platform` requires the per-source secret** (`?secret=` or `x-webhook-secret` header). There is no
  `company_id` fallback any more. The Lead Sources page shows the webhook URL with the secret already appended.
- A lead source can be added once per platform; unknown platform ids are refused (400).

## DNS configuration (one-time) — NOT DONE as of 2026-09-13

`inbound.twomiah.com` has **no DNS record** today (`Resolve-DnsName inbound.twomiah.com -Type MX` → name does not exist),
so the email half cannot receive mail until this is added:

```
Type: MX
Host: inbound.twomiah.com
Priority: 10
Value: mx.sendgrid.net
```

## SendGrid Inbound Parse configuration (one-time)

1. SendGrid → Settings → Inbound Parse → "Add Host & URL"
2. Receiving Domain: `inbound.twomiah.com`
3. Destination URL: `https://twomiah-factory-api.onrender.com/api/v1/factory/public/inbound-email`
4. "POST the raw, full MIME message": No (parsed mode); "Check incoming emails for spam": Yes

## Factory router

`apps/api/src/routes/factory/intake.ts` → `POST /public/inbound-email` accepts SendGrid's form-encoded or JSON post,
extracts the tenant-id prefix + platform from the `To:` address, finds the tenant whose id starts with the prefix, and
forwards `{to, from, subject, text, html}` as JSON to `{render_backend_url}/api/leads/inbound/email` with
`X-Factory-Key: {factory_sync_key}`.

## Per-tenant setup (tenant admin, in the CRM)

1. **Lead Sources** in the sidebar (feature `lead_inbox`) → **Add Source** → pick a platform
2. The card shows the inbound email address, the webhook URL (secret included) and the setup steps for that platform
3. Leads land in **Lead Inbox**; Call / Text mark them contacted; **Convert to Contact** links an existing contact with
   the same email or phone instead of creating a duplicate, and refuses a second convert

## Testing

```bash
# Tenant endpoint directly (needs the tenant's FACTORY_SYNC_KEY and the FACTORY tenant id prefix)
curl -X POST https://{tenant-url}/api/leads/inbound/email \
  -H "Content-Type: application/json" -H "X-Factory-Key: {FACTORY_SYNC_KEY}" \
  -d '{"to":"leads+{tenantIdPrefix}-angi@inbound.twomiah.com","from":"notifications@angi.com",
       "subject":"New Lead from Angi: John Smith - Roof Replacement",
       "text":"Customer: John Smith\nPhone: (555) 123-4567\nEmail: john@example.com\nService: Roof Replacement\nLocation: Dallas, TX"}'

# Through the Factory router (what SendGrid does)
curl -X POST https://twomiah-factory-api.onrender.com/api/v1/factory/public/inbound-email \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "to=leads+{tenantIdPrefix}-angi@inbound.twomiah.com" --data-urlencode "subject=New Lead" \
  --data-urlencode "text=Customer: Jane Doe
Phone: (555) 987-6543"

# Webhook (Zapier / Make shape)
curl -X POST "https://{tenant-url}/api/leads/inbound/webhook/thumbtack?secret={webhookSecret}" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"Jane Doe","email":"jane@example.com","phone":"(555) 987-6543"},"request":{"category":"Roof Repair","location":"Austin, TX","details":"Leaking roof"}}'
```
