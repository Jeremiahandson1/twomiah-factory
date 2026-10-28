# Twomiah CRM — App Store and Google Play listing

For the store app (`APP_VARIANT` unset: bundle `com.twomiah.crm`, home-screen name "Twomiah"). Every sentence here says what the app
does today — each feature named is a tab or screen in `apps/mobile` that runs against the unified server, checked by
`apps/unified/tests/mobile-app-client.test.ts` and the per-trade `mobile-*.test.ts` files. `tests/mobile/store-ready.test.ts`
checks the length limits below and that the copy names only the trades the app supports.

The app is for the trades whose crews work away from a desk: **contractor, "Other" (general service), field service (HVAC, plumbing,
electrical, cleaning, pest control and the like), home care, roofing, landscaping and RV/powersports dealers** — exactly
`src/vertical/verticals.ts` `PHONE_VERTICALS`. Salons, restaurants, bars, stores and vets use the website CRM in their phone's
browser; the app says so and opens that sign-in (`NoPhoneAppGate`).

---

## App name

- **iOS App Store name (≤30):** `Twomiah CRM`
- **Google Play title (≤30):** `Twomiah CRM`

## Subtitle / short description

- **iOS subtitle (≤30):** `Field CRM for service crews`
- **Google Play short description (≤80):** `Jobs, quotes, contacts and visits for crews who work away from a desk.`

## Promotional text (iOS, ≤170)

> Jobs, contacts, quotes and visits on your phone. For contractors, field service, roofing, landscaping, home care and RV dealers. Sign in with your company's address.

## Keywords (iOS, ≤100 characters including commas)

```
crm,contractor,roofing,hvac,plumbing,landscaping,home care,field service,jobs,quotes,invoices,crew
```

## Full description (iOS and Google Play, ≤4000)

Twomiah CRM is the phone app for businesses that run on Twomiah. It puts the work that happens away from a desk — today's jobs, a customer's phone number, a photo of the roof, a visit clock-in — in your pocket.

To sign in you need your company's Twomiah address (for example your-company.onrender.com), and the email and password your business set up for you. If your business does not use Twomiah yet, start at twomiah.com. The app does not sell anything and has no purchases.

WHAT YOU SEE DEPENDS ON YOUR TRADE AND YOUR ROLE

Contractors and general service businesses
• Dashboard with today's jobs
• Jobs: start, complete, add notes and photos
• Contacts: call, text, email or open directions with one tap
• Quotes: build a quote, send it, turn it into an invoice, record a payment, open the PDF

Field service (HVAC, plumbing, electrical and similar)
• Service calls and a day-by-day schedule
• Customer details and history at each stop
• Photos attached to the call

Roofing
• Pipeline of jobs by stage, with notes and photos on each
• Canvass mode: log doors as you walk a street, with your location, and turn interested homeowners into leads
• Contacts and quick lead entry

Landscaping
• Jobs and a daily schedule
• Contacts, notes and photos

Home care
• Today's visits and a two-week schedule
• Clock in and out of a visit with your location; works without signal and sends the visit when you reconnect
• The visit's task checklist, medication log, vitals and photos
• Ask a coworker to swap a shift, ask the office to move one, or tell them you can't make it
• Open shifts, messages with the office, documents to sign, mileage, incident reports
• If your agency uses Sandata, the app reminds you to open the Sandata app after you clock in and out

RV and powersports dealerships
• Inventory search, customers and the day's numbers

FOR EVERYONE
• Alerts when a job is assigned or changed (and, for the office, when a lead comes in)
• Two-factor sign-in is supported
• Light and dark appearance

Your business owner decides who can see and do what: the app shows only what your role allows. The app is a companion to the Twomiah website CRM, which has everything else.

NOT FOR EVERY BUSINESS
Salons, restaurants, bars, stores and veterinary practices use the Twomiah website CRM in their phone's browser. If you sign in to this app with one of those accounts, it tells you so and opens the website sign-in for you.

## What's new (release notes, ≤4000)

> First release. Sign in with your company's Twomiah address to see your jobs, contacts, quotes and visits on your phone.

## Categories

- **iOS primary:** Business — **secondary:** Productivity
- **Google Play:** Business

## Age rating

- 4+ / Everyone. No objectionable content; sign-in required; no purchases, no ads, no user-to-user content outside a business's own team.

## URLs (all three answer 200 as of 2026-10-28)

- **Privacy policy:** `https://twomiah.com/privacy`
- **Support:** `https://twomiah.com/support` (support@twomiah.com)
- **Marketing:** `https://twomiah.com`

## Demo account for App Review

Reviewers sign in for real; without working credentials the app is rejected. The owner creates a sandbox business (READY.md §3):
the **roofing** or **contractor** trade, with a few jobs today, a contact, a quote, and one photo. Server URL, email and password go in
App Store Connect → App Review Information and Google Play → App access. Rotate the password after each review.

## Notes for whoever submits

1. iOS keywords need no spaces after commas; every character counts (the list above is 98).
2. Don't name other products (QuickBooks, ServiceTitan, Jobber…) in the listing or keywords.
3. Screenshots must show the real app, signed in to the demo business: roofing pipeline, a job with photos, contacts, a quote, and a
   caregiver's Today and Clock screens from a home care demo (READY.md §4).
4. Sizes: iOS 6.9"/6.7" (1290×2796), 6.5" (1242×2688 or 1284×2778), 12.9"/13" iPad; Google Play phone 1080×1920 minimum, plus 7" and
   10" tablet if you want tablet placement.
5. The app has no account creation, so Apple's "delete account in the app" rule does not apply: accounts are made by the business
   owner on the website. Say so in the review notes.
