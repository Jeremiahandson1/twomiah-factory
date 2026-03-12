# Lead Inbox — SendGrid Inbound Parse Setup

## Overview

The Lead Inbox receives leads from external platforms (Angi, Thumbtack, HomeAdvisor, Google LSA, Houzz) via two mechanisms:

1. **Email parsing** — Platforms forward lead notification emails to `leads+{companyId}-{platform}@inbound.twomiah.com`, which SendGrid Inbound Parse routes to our webhook
2. **Direct webhooks** — Platforms that support webhooks send JSON payloads directly to `{tenant-url}/api/leads/inbound/webhook/{platform}`

## DNS Configuration (one-time)

Add an MX record for the `inbound.twomiah.com` subdomain:

```
Type: MX
Host: inbound.twomiah.com
Priority: 10
Value: mx.sendgrid.net
```

This tells mail servers to route all email addressed to `*@inbound.twomiah.com` to SendGrid.

## SendGrid Inbound Parse Configuration (one-time)

1. Log in to SendGrid → Settings → Inbound Parse
2. Click "Add Host & URL"
3. Configure:
   - **Receiving Domain**: `inbound.twomiah.com`
   - **Destination URL**: `https://twomiah-factory-api.onrender.com/api/v1/factory/inbound-email`
   - **Check "POST the raw, full MIME message"**: No (use parsed mode)
   - **Check "Check incoming emails for spam"**: Yes
4. Save

## Factory API Inbound Email Router

The factory API at `/api/v1/factory/inbound-email` receives the parsed email from SendGrid, extracts the company ID prefix and platform from the `To:` address, then forwards the payload to the correct tenant's `/api/leads/inbound/email` endpoint.

The To address format is: `leads+{companyIdPrefix}-{platform}@inbound.twomiah.com`

Example: `leads+abc12345-angi@inbound.twomiah.com` routes to the tenant whose company ID starts with `abc12345`, platform `angi`.

## Per-Tenant Setup (done in CRM by tenant admin)

1. Go to **Lead Sources** in the CRM sidebar
2. Click **Add Source** and select a platform (Angi, HomeAdvisor, Thumbtack, Google LSA, Houzz)
3. The system generates:
   - An inbound email address for that platform
   - A webhook URL with a unique secret
4. Follow the platform-specific setup instructions shown in the UI

## Platform-Specific Setup Instructions

### Angi (Angie's List)
1. Log in to your Angi for Pros account
2. Go to Settings > Lead Notifications > Email
3. Set your notification email to the inbound address shown in the CRM
4. Angi will forward all new lead emails to your CRM

### HomeAdvisor
1. Log in to your HomeAdvisor Pro account
2. Go to My Account > Notification Preferences
3. Add the inbound email address as a notification recipient
4. Enable "New Lead" email notifications

### Thumbtack
1. Log in to your Thumbtack Pro account
2. Go to Settings > Notifications
3. Add the inbound email to receive lead notifications
4. Alternatively, set up email forwarding from your registered email

### Google Local Services Ads (LSA)
1. Google LSA leads arrive via phone calls and messages
2. Set up email forwarding from your Google LSA notification email
3. Forward all "New lead" emails to the inbound address
4. Alternatively, use the webhook URL with Zapier or Make

### Houzz
1. Log in to your Houzz Pro account
2. Go to Settings > Email Notifications
3. Forward lead notification emails to the inbound address
4. Houzz does not support direct webhooks — email forwarding is recommended

## Testing

To test the email parsing pipeline:

```bash
# Simulate an Angi lead email via SendGrid Inbound Parse
curl -X POST https://{tenant-url}/api/leads/inbound/email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "leads+abc12345-angi@inbound.twomiah.com",
    "from": "notifications@angi.com",
    "subject": "New Lead from Angi: John Smith - Roof Replacement",
    "text": "Customer: John Smith\nPhone: (555) 123-4567\nEmail: john@example.com\nService: Roof Replacement\nLocation: Dallas, TX 75201\nDescription: Need full roof replacement after hail damage"
  }'
```

```bash
# Simulate a Thumbtack webhook
curl -X POST "https://{tenant-url}/api/leads/inbound/webhook/thumbtack?secret={webhookSecret}" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": { "name": "Jane Doe", "email": "jane@example.com", "phone": "(555) 987-6543" },
    "request": { "category": "Roof Repair", "location": "Austin, TX", "budget": "$5,000-$10,000", "details": "Leaking roof in master bedroom" }
  }'
```
