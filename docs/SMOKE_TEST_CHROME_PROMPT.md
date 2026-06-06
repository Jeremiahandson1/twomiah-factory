# Claude-in-Chrome smoke test prompt

Paste the prompt below into Claude in Chrome. It walks through every
step of the manual smoke test that the CLI walkthrough can't automate
(Google OAuth consent flow + verifying the booking lands on a real
Google Calendar).

The prompt is self-contained — Claude in Chrome has no shared context
with the CLI session, so everything it needs is in the prompt itself.

The tenant URLs / credentials below are for the throwaway test tenant
we provisioned (`da13b411-1788-4c52-bb23-56ee187f7660`). Replace them
when you re-provision.

---

```
You are helping me verify Twomiah Bookings is working end-to-end on a
live tenant. This is a paid SaaS platform that generates booking
websites for service businesses. I am the owner.

CONTEXT YOU NEED
- Test customer + admin email: twomiah14@gmail.com
  (Have Gmail open in another tab logged in as this email.)
- Owner password for the admin: Premium-test-pw-01584d!
- Tenant public site:  https://premiumtest-mq2fc4pb-a1ca-site.onrender.com
- Tenant admin URL:    https://premiumtest-mq2fc4pb-a1ca-site.onrender.com/admin
- This is a throwaway test tenant — feel free to click anything;
  nothing is destructive that I care about.

The booking-related routes in this admin SPA are:
  /admin/bookings           — bookings list
  /admin/booking-settings   — services, availability, calendar sync
  /admin/booking-calendar   — week/month calendar view
The sidebar may NOT have a top-level "Bookings" entry depending on
which navigation snapshot is rendered. If you can't find it in the
sidebar, navigate to /admin/booking-settings directly.

WHAT TO VERIFY (in order)

Step 1 — Sign in
1. Open https://premiumtest-mq2fc4pb-a1ca-site.onrender.com/admin
2. Log in with twomiah14@gmail.com / Premium-test-pw-3c6fc8!
3. REPORT: did login succeed? What page did it land on?

Step 2 — Connect Google Calendar
1. Navigate to /admin/booking-settings (use the URL bar if no sidebar
   link exists)
2. Scroll to the "Calendar Sync" card
3. Click "Connect Google"
4. You'll land on Google's OAuth consent screen
5. Pick the twomiah14@gmail.com account if Google asks which one
6. Click Allow on every permission
7. If Google blocks with "App not verified", click "Advanced" → "Go
   to Twomiah Bookings (unsafe)" — that's expected; the OAuth app is
   in Testing mode
8. After redirect, you should land back on /admin/booking-settings
   showing "Connected as twomiah14@gmail.com" on the Calendar Sync
   card
9. REPORT: did the connection succeed? Paste the exact text the
   Calendar Sync card shows now.

Step 3 — Add a service
1. Still on /admin/booking-settings, find the Services card
2. Click "Add Service" (or whatever the equivalent button is — "New
   Service", "+", etc.)
3. Fill in:
   - Name: "Smoke Test Clean"
   - Slug: smoke-test-clean (or whatever it auto-generates)
   - Duration: 60 minutes
   - Price: $100
4. Save
5. REPORT: did the save succeed? Is the service visible in the list?

Step 4 — Set availability
1. On the same page, find the Availability card
2. Set Monday-Friday 9:00am-5:00pm if not already set
3. Save
4. REPORT: success?

Step 5 — Submit a public booking
1. Open a new tab to https://premiumtest-mq2fc4pb-a1ca-site.onrender.com/book
2. Click the "Smoke Test Clean" service card
3. Pick a date that's 7+ days from today
4. Pick any available slot (probably 9:00am or 10:00am)
5. Fill out the form:
   - Name: "Smoke Test Customer"
   - Email: twomiah14@gmail.com
   - Phone: 555-555-0142
   - Address: 123 Smoke Test Lane
   - Notes: "Claude smoke test, please ignore"
6. Submit
7. You should see a "Booking confirmed" / thanks page
8. REPORT: did it confirm? What date/time did you pick?

Step 6 — Verify the email arrived
1. Switch to the Gmail tab (twomiah14@gmail.com)
2. Refresh
3. There should be a NEW email subject ~ "Booking confirmed: Smoke
   Test Clean" or similar
4. Open it
5. REPORT: did the email arrive? Does it have a .ics attachment? Paste
   the visible body text (first ~10 lines).

Step 7 — Verify the Google Calendar event
1. Open https://calendar.google.com (logged in as twomiah14@gmail.com)
2. Navigate to the date you booked
3. Look for an event matching "Smoke Test Customer" or "Smoke Test
   Clean"
4. If not there, wait 30 seconds and refresh — calendar push is async
5. REPORT: is the event on the calendar at the right time? If not,
   paste a screenshot if you can.

Step 8 — Cancel and verify cleanup
1. Go back to the confirmation email
2. Click the "Manage / Cancel" link in the email body
3. On the management page, click Cancel
4. Confirm
5. Refresh Google Calendar — the event should be GONE
6. REPORT: did the cancel remove the calendar event?

FINAL REPORT
Give me a numbered summary of all 8 steps:
  Step N: PASS / FAIL / SKIPPED — one-line detail
If anything failed, quote the exact error text and the URL you were
on. Screenshot if your tools allow it.

DO NOT:
- Pay anything if a Stripe checkout pops up — just close the tab and
  mark "deposit required" as PASS without paying. This tenant has no
  Stripe key configured so it shouldn't appear.
- Disconnect any existing Google Calendar connections from other
  Google accounts you might be signed into.
- Modify anything on tenants that don't have the URL prefix
  "premiumtest-mq2fc4pb-a1ca" — those are real customers.

Take your time — accuracy matters more than speed. If you're not sure
what page you're on, pause and ask me before clicking anything
critical.
```

---

## Notes for me (Jeremiah)

- Have Gmail logged in as `twomiah14@gmail.com` in a tab before starting
- Be ready to help Claude through 2FA / login confirmation prompts
- "App not verified" warning is expected — the Google OAuth app is in
  Testing mode (publishing to production = a separate Google review
  process you can do later). Claude should click Advanced → Go to
  Twomiah Bookings (unsafe).
- When you're done, run:
  ```
  cd apps/api && bun run scripts/cleanup-test-premium.ts da13b411-1788-4c52-bb23-56ee187f7660
  ```
  to tear down the throwaway tenant.
