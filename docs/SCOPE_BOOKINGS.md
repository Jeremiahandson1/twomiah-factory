# Twomiah Bookings — Product Scope

A Calendly-killer for service businesses. Customer picks a slot on the
business's public site, books, gets confirmed by email + SMS, business
sees the booking in the CRM with the right crew already assigned.

Last updated: 2026-06-05. Status: scoping, pre-build.

## Why we're building it

- "But we already use Calendly" is the #1 objection from service-business
  prospects today. Replacing it kills that objection.
- Every Twomiah primitive needed exists: scheduling table + UI, SendGrid,
  Twilio, multi-user auth, public website + section composition.
- Generic Calendly doesn't know about service zones, crews, buffer times,
  or job-type durations. Ours will. Specifically: we can auto-assign the
  best crew to a booking based on location + availability + skills.
- Closes the loop: ads → landing page → contact form OR direct booking,
  not "form → email → wait for callback → maybe book."

## What it is, in one paragraph

Owner sets weekly availability + service types (e.g. "Deep clean = 3 hrs,
$240") + crews + service zones. Public `/book` page on their site shows
real available slots for the next 14 days, filtered by service type and
customer ZIP. Customer picks a slot, fills name/email/phone/address,
books. Server creates a `bookings` row, assigns best crew, sends a
confirmation email + SMS to customer, sends notify SMS + dashboard entry
to crew. 24h before, automatic SMS reminder to both sides. After job,
automatic SMS review request.

## Phases

Decision (2026-06-05): ship a "complete" Phase 1 that includes
multi-crew, service zones, and Google/Outlook calendar sync — not the
stripped-down MVP. Rationale: actively selling against a cleaning
company that's using LeadConnector + Showit + a separate booking tool;
we don't get a second chance to make this look incomplete. We launch
to all 7 premium verticals simultaneously (contractor canonical first
in code, propagated to siblings before launch).

### Phase 1 — Complete launch (5-6 weeks)

**Scheduling primitives:**
- `booking_services` table (name, duration_minutes, price_cents, description, slug, buffer_before_minutes, buffer_after_minutes)
- `booking_availability_rules` table — per-crew weekly recurring (day_of_week, start_minute, end_minute, user_id)
- `booking_blackouts` table — per-crew or tenant-wide one-off exceptions
- `booking_service_zones` table — per-crew zone (ZIP list or geo-radius)
- `bookings` table (service_id, start_at, end_at, customer info, status, assigned_user_id, confirmation_token, reminder_24h_sent_at)

**Public site (in all 7 premium templates):**
- `/book` — service picker page
- `/book/:service-slug` — date picker → slot picker → customer form
- `/book/confirm/:id` — thank-you page with calendar download
- Customer enters ZIP early so we filter to crews that serve that area
- Slot picker shows only slots where at least one qualifying crew is available

**Public self-service:**
- Confirmation email + SMS contain a one-click reschedule/cancel link
- `/booking/:token` page lets customer move themselves (subject to cutoff rules)

**Admin UI (in all 7 premium template SPAs):**
- Bookings nav item: list + detail + manual create/reschedule/cancel
- Services list (CRUD)
- Availability editor (per-crew weekly grid + blackouts)
- Crews list (uses existing CRM users, role=crew)
- Service zones editor per crew
- Settings: cancellation cutoff, max-reschedule count, default buffer

**CRM integration:**
- Bookings appear on existing `SchedulePage` alongside jobs
- Drag-to-reschedule, reassign crew
- Auto-creates a job record in the connected CRM

**Notifications:**
- Email confirmation to customer + owner (SendGrid via existing lib)
- SMS confirmation to customer + crew (Twilio via existing CRM service)
- 24h-prior SMS reminder, fired by hourly cron
- Post-job review-request SMS (reuses existing fieldservice reviews service)

**Calendar sync (two-way):**
- Google Calendar OAuth per crew member (per-tenant client; we don't proxy creds)
- Outlook OAuth per crew member
- Bookings push to crew's external calendar with attendee = customer
- External calendar busy events count against availability for slot generation
- Webhook subscription so external changes (crew blocks 2-3pm) propagate within a minute

**Concurrency/correctness:**
- Postgres unique constraint on `(start_at, assigned_user_id) where status='confirmed'` blocks double-booking
- Slot generator unit tests (deterministic; lock the clock)
- Race retry on the public form: if INSERT fails the constraint, return "that slot just filled — pick another"

### Phase 2 — Polish (post-launch, ongoing)

- Recurring bookings ("every other Tuesday at 10am, 6 weeks")
- Stripe deposit at booking time
- Group bookings (1 slot, N customers — for classes/events)
- Embed widget for non-Twomiah sites (iframe)
- A/B testing slot picker layout (ties into Twomiah Ads experiments product)
- AI-assisted service description generation (matches Twomiah's existing AI composer pattern)

## Data model — Phase 1

```sql
booking_services (
  id uuid pk,
  slug text unique not null,
  name text not null,
  description text,
  duration_minutes int not null,
  price_cents int,
  is_active boolean default true,
  display_order int default 0,
  created_at timestamptz default now()
)

booking_availability_rules (
  id uuid pk,
  day_of_week int not null check (day_of_week between 0 and 6),  -- 0=Sun
  start_minute int not null,  -- minutes from midnight; e.g. 540 = 9am
  end_minute int not null,
  is_active boolean default true,
  created_at timestamptz default now()
)

booking_blackouts (
  id uuid pk,
  date date not null,
  start_minute int,  -- null means full-day blackout
  end_minute int,
  reason text,
  created_at timestamptz default now()
)

bookings (
  id uuid pk,
  service_id uuid references booking_services(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  customer_address text,
  customer_notes text,
  status text not null default 'confirmed',  -- 'confirmed'|'cancelled'|'completed'|'no_show'
  assigned_user_id uuid references users(id),
  source text default 'public_form',  -- 'public_form'|'admin_manual'
  confirmation_token text unique,  -- for Phase 3 self-service link
  reminder_24h_sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

create index bookings_start_idx on bookings(start_at) where status != 'cancelled';
create unique index bookings_no_overlap_idx on bookings(start_at) where status = 'confirmed';
```

The unique index is the cheapest correctness gate for concurrency — two
customers racing to book the same slot, the second insert fails and the
client retries. Better than table-level locking.

## API surface — Phase 1

**Public (no auth):**
- `GET /book` — service picker page (HTML)
- `GET /book/:service-slug` — date picker (HTML)
- `GET /book/:service-slug/slots?date=2026-06-15` — JSON, available slots for the day
- `POST /book/:service-slug` — body `{ start_at, customer_* }`, creates booking
- `GET /book/confirm/:id` — thank-you page (HTML)

**Admin (`/api/admin/*`, auth required):**
- `GET /booking-services` / `POST` / `PATCH /:id` / `DELETE /:id`
- `GET /booking-availability` / `PUT` (replaces whole ruleset atomically)
- `GET /booking-blackouts` / `POST` / `DELETE /:id`
- `GET /bookings?from=&to=&status=` / `GET /bookings/:id`
- `PATCH /bookings/:id` — reschedule, change status, reassign crew
- `DELETE /bookings/:id` — soft-delete (sets status=cancelled)
- `POST /bookings/:id/send-reminder` — manual SMS

**Internal cron:**
- Hourly job: for each `confirmed` booking with `start_at` within next
  24h and `reminder_24h_sent_at IS NULL`, send SMS reminder, stamp the
  sent-at column

## UI surface — Phase 1

### Public site

Three pages added to premium template:

1. **`/book`** — Hero, service cards (image, name, duration, price, "Book this" CTA), trust signals (testimonials or "X bookings this month")
2. **`/book/:service-slug`** — Date picker (calendar grid, next 14 days, days with availability highlighted). On day click, slot list appears (8am, 9am, 10am…). Slot click jumps to step 3.
3. **`/book/:service-slug/confirm`** — Form (name, email, phone, address, notes), summary card showing service + date + time + price, "Confirm booking" button
4. **`/book/thanks/:id`** — Confirmation page with booking details, calendar links (Add to Google Calendar / Add to Apple Calendar via .ics download)

All four pages share the existing premium-site EJS + base.ejs layout.
Section-composition style — variants for hero, service-card layout, etc.

### Admin SPA

New nav item: **Bookings**.

- **`/bookings`** — List view, table with date, customer, service, status, assigned crew. Filters: date range, status.
- **`/bookings/:id`** — Detail view, all booking info, reschedule control, status dropdown, manual SMS button, audit history
- **`/booking-services`** — CRUD list, create/edit modal
- **`/booking-availability`** — Weekly grid (Mon-Sun × hourly cells). Click-drag to mark available windows. Below the grid: blackout date list with date picker + reason.

Existing **`SchedulePage`** in CRM gets new layer — bookings appear as
events alongside jobs, can be dragged to reschedule, dispatched to crew.

## Tricky parts (be honest about them)

1. **Slot generation correctness** — for date D and service S of
   duration M minutes: list all candidate slots (every 30min within
   availability rules for that weekday), subtract blackouts, subtract
   existing bookings ± buffer (Phase 1: zero buffer), drop slots whose
   end_at would extend past availability window. Worth a unit test
   suite from day one — easy to get wrong, hard to notice it's wrong.

2. **Timezones** — Tenant has a `timezone` setting (already in settings
   table? if not, add). Slots displayed and accepted in tenant timezone,
   stored in UTC. Customer sees their own browser-local time on the
   public site (display only — the booking commits to tenant time).
   Twilio/SendGrid reminders fired in tenant timezone.

3. **Concurrency** — Two customers click the same slot at the same
   moment. The unique index `bookings_no_overlap_idx on (start_at)
   where status = 'confirmed'` makes the second insert fail with
   constraint violation; we catch the error and return "slot just
   filled, please pick another."

4. **No-shows** — Manual button to mark no-show. Future: heuristic
   auto-flag if no SMS delivery / customer doesn't confirm 24h-prior
   message.

5. **Public booking spam** — Reuse the existing honeypot + dwell-time
   logic from `/api/leads`. Also rate-limit `/book/:service-slug` POST
   to 3 per IP per hour. A "did we send a confirmation email?" check
   makes bot-spam useless anyway.

## Pricing

Built-in for the website-premium tier (no extra cost). The whole point
is killing the Calendly objection. Customers paying $75/mo already; this
makes that $75/mo more defensible against any competitor.

Future: optional standalone Bookings tier for tenants who don't want a
website ($25/mo, embeddable widget for their existing site).

## Effort estimate

| Phase | Scope | Engineer-weeks |
|-------|-------|---------------|
| 1 | Complete launch — multi-crew, zones, cal sync, self-service, all 7 verticals | 5-6 |
| 2 | Polish (recurring, deposits, embed widget, A/B) | ongoing |

5-6 weeks is the load-bearing number — not a 3-week MVP that then needs
two more drops of "real features" to be sold credibly.

## Settled decisions (2026-06-05)

1. **Product name**: Twomiah Bookings
2. **Default slot grid**: 30-minute slots, owner can override per service
3. **Launch breadth**: all 7 premium verticals at the same time
   (contractor canonical, propagated byte-identically to siblings)
4. **Calendar sync**: shipped in Phase 1, not deferred — the cleaning
   company prospect already uses Google Cal; can't show up to that
   demo without it
