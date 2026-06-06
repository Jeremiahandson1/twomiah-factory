# Twomiah Bookings — Go-Live Runbook

Everything you need to click before the first paying customer can use
Twomiah Bookings end-to-end. The code is shipped and live-tested
(walk-bookings.ts 24/24 on a real Render tenant, 2026-06-05, covering
the full Phase 1+2+3 surface plus polish). What's left is dashboard
config that the codebase can't do for you.

Estimated time: **30-45 minutes** of clicking, mostly in browser
dashboards.

---

## 1. Google Calendar OAuth app — ~10 min

Lets crew members connect their Google Calendar. One approved app for
the entire Twomiah platform; the Factory orchestrates the OAuth
flow for every tenant.

1. Go to https://console.cloud.google.com/
2. Create a new project (or reuse an existing Twomiah project): "Twomiah Bookings"
3. APIs & Services → Enable APIs → enable **Google Calendar API**
4. APIs & Services → OAuth consent screen
   - User type: **External**
   - App name: `Twomiah Bookings`
   - User support email: `support@twomiah.com` (or whichever you control)
   - Authorized domains: `twomiah.com`
   - Developer contact: same email
   - Scopes: add `https://www.googleapis.com/auth/calendar.events`
   - Test users: add `twomiah14@gmail.com` (for testing) — switch to "In production" once tested
5. APIs & Services → Credentials → Create credentials → OAuth client ID
   - Application type: **Web application**
   - Name: `Twomiah Bookings`
   - Authorized redirect URIs: `https://<your-factory-url>/calendar/google/callback`
     (e.g. `https://twomiah-factory.onrender.com/calendar/google/callback`)
6. Copy the **Client ID** and **Client secret**.

## 2. Microsoft Outlook OAuth app — ~10 min

Same pattern for Outlook/Microsoft 365 users.

1. Go to https://entra.microsoft.com/ → Identity → Applications → App registrations
2. New registration
   - Name: `Twomiah Bookings`
   - Supported account types: **Accounts in any organizational directory + personal Microsoft accounts**
   - Redirect URI: type **Web**, URI `https://<your-factory-url>/calendar/outlook/callback`
3. After creation, copy the **Application (client) ID**
4. Certificates & secrets → New client secret → 24 months (or your policy) → copy the **Value** immediately (you can't see it again)
5. API permissions → Add permission → Microsoft Graph → Delegated permissions
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`
6. Grant admin consent (if you have an org tenant)

## 3. Factory environment variables — ~3 min

On the Factory Render service, add these env vars and restart:

```
GOOGLE_CALENDAR_CLIENT_ID=<from step 1.6>
GOOGLE_CALENDAR_CLIENT_SECRET=<from step 1.6>
OUTLOOK_CALENDAR_CLIENT_ID=<from step 2.3>
OUTLOOK_CALENDAR_CLIENT_SECRET=<from step 2.4>
FACTORY_PUBLIC_URL=https://<your-factory-url>
```

`FACTORY_PUBLIC_URL` may already be set as `RENDER_EXTERNAL_URL`; the
Factory code falls back to that, but setting `FACTORY_PUBLIC_URL`
explicitly is clearer for ops.

## 4. Render cron jobs — ~5 min

Two new scheduled jobs needed. Both are POSTs to the Factory with the
existing `CRON_SECRET`.

### 24h booking reminders (hourly)

Render dashboard → New + → **Cron Job**:
- Name: `twomiah-booking-reminders`
- Region: same as Factory
- Schedule: `0 * * * *` (top of every hour)
- Command:
  ```
  curl -fsS -X POST "$FACTORY_URL/internal/booking-reminders" -H "x-cron-secret: $CRON_SECRET"
  ```
- Env vars on the cron service:
  - `FACTORY_URL=https://<your-factory-url>`
  - `CRON_SECRET=<same as Factory env>`

### Rebook nudges (daily)

Same pattern, different schedule:
- Name: `twomiah-booking-rebook-reminders`
- Schedule: `0 14 * * *` (14:00 UTC = 8am Central, before businesses open)
- Command:
  ```
  curl -fsS -X POST "$FACTORY_URL/internal/booking-rebook-reminders" -H "x-cron-secret: $CRON_SECRET"
  ```
- Same env vars

## 5. Existing tenant redeploy — ~10 min

Tenants deployed before this go-live don't have the new Google/Outlook
client credentials in their env. Two options:

**A. Redeploy each tenant individually** via the Factory admin
("Redeploy" button on the tenant detail page). Fastest if you have
<10 live tenants.

**B. Batch redeploy** via SQL + script:
```bash
cd apps/api
# List live premium tenants
bun -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data } = await s.from('tenants').select('id, slug').eq('status','live').contains('products',['website-premium'])
console.log(data?.map(t => t.slug).join('\n'))
"
# For each, trigger redeploy via the Factory's existing redeploy endpoint
```

New tenants from this point forward get the credentials automatically
(deploy.ts already wires them).

## 6. Smoke test the first OAuth flow — ~5 min

Pick a low-stakes tenant (or do a test signup at twomiah.com/start).

1. Sign in to the tenant's admin
2. Bookings → Settings → scroll to Calendar Sync
3. Click "Connect Google"
4. You should redirect to Google's consent screen, then back to
   `/admin/booking-settings?google=connected`
5. The Calendar Sync card should now show "Connected as <email>"
6. Repeat for Outlook

If either fails:
- Check the Factory logs around the time of the callback for the
  exchange error message
- Verify the redirect URI matches **exactly** (trailing slash, http vs
  https, the host)
- Verify the scopes are granted on the consent screen

## 7. End-to-end booking smoke test — ~5 min

1. From the same tenant admin: Bookings → Settings
2. Add a service (e.g. "Deep Clean", 120 min, $240)
3. Set Mon-Fri 9-5 availability
4. Go to the tenant's public site `/book`
5. Pick a date, pick a slot, fill the form, submit
6. Confirm:
   - You receive a customer confirmation email **with a calendar attachment**
   - The owner email gets a notification
   - The booking shows up on your connected Google Calendar
   - The Bookings list in admin shows the new booking
7. Cancel the booking via the link in the confirmation email
8. Verify the Google Calendar event is removed

## 8. Customer-facing landing pages

The marketing pages exist on twomiah.com (committed `8a754ac`):
- `/bookings` — "Stop paying for Calendly", bundled-with-premium pitch
- `/bookings-standalone` — $25/mo embed-only tier for non-Twomiah sites

If you want these linked from the homepage:
- Edit `twomiah-website/index.html` and add a nav entry
- Both pages are SEO-ready (canonical URLs, OG tags, schema.org).

---

## Quick rollback

If anything goes wrong after go-live and you need to disable bookings
temporarily without redeploying:

- On each tenant: in the admin, Bookings → Settings → set every
  service `isActive: false`. Public `/book` page renders "Bookings
  opening soon", existing bookings keep working.

If a code issue is found:
- Revert the offending commit on `feature/website-premium-contractor-scaffold-2026-06-03`
- Force re-deploy affected tenants from the Factory admin

## Useful diagnostic queries

For any tenant's Postgres:

```sql
-- Active services
SELECT slug, name, duration_minutes, is_active, rebook_interval_days
FROM booking_services
ORDER BY display_order;

-- Today's bookings
SELECT id, start_at, customer_name, status, assigned_user_id
FROM bookings
WHERE start_at::date = current_date
ORDER BY start_at;

-- Bookings that should have triggered a reminder but didn't
SELECT id, start_at, customer_email, reminder_24h_sent_at
FROM bookings
WHERE status='confirmed'
  AND start_at BETWEEN now() + interval '23 hours' AND now() + interval '25 hours'
  AND reminder_24h_sent_at IS NULL;

-- Bookings due for rebook nudge (e.g. cleaning, 21 days)
SELECT b.id, b.customer_email, b.end_at, s.name
FROM bookings b
JOIN booking_services s ON s.id = b.service_id
WHERE b.status='completed'
  AND s.rebook_interval_days IS NOT NULL
  AND b.end_at::date = (current_date - s.rebook_interval_days * interval '1 day')::date
  AND b.rebook_reminder_sent_at IS NULL;

-- Google calendar connections
SELECT u.email, c.external_account_email, c.expires_at
FROM booking_calendar_connections c
JOIN users u ON u.id = c.user_id
WHERE c.provider='google';
```

---

### Cron 3 — post-job review-request SMS (daily)

- Name: `twomiah-booking-review-requests`
- Schedule: `0 16 * * *` (16:00 UTC = 10am Central, 1-2 days after job ends)
- Command:
  ```
  curl -fsS -X POST "$FACTORY_URL/internal/booking-review-requests" -H "x-cron-secret: $CRON_SECRET"
  ```

Last updated: 2026-06-05, after walk-bookings.ts passed 24/24 on a
live Render tenant (route-order fix on /bookings/analytics shipped
the same day). Author: Claude.
