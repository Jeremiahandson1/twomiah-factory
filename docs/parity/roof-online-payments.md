# Roofing parity — getting paid online (gap 1)

Leaders: JobNimbus Payments, Roofr Payments, Leap Pay. Read from their own pages on 2026-10-30; where a page said nothing
about a point it is marked "not stated", never assumed.

Sources
- JobNimbus: [What is JobNimbus Payments](https://support.jobnimbus.com/what-is-jobnimbus-payments), [Accepting digital payments in JobNimbus](https://support.jobnimbus.com/how-do-i-accept-digital-payments-in-jobnimbus)
- Roofr: [How to use Roofr Payments](https://help.roofr.com/en/articles/15647213-how-to-use-roofr-payments)
- Leap: [Leap Pay](https://leaptodigital.com/solutions/leappay)

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Card (Visa, Mastercard, Amex, Discover) from the invoice — JobNimbus, Roofr, Leap | The homeowner's invoice page takes a card (for a business with Online Payments on — not offered to roofing until released); the charge is made on the roofer's own connected Stripe account, never ours (`roof-online-payments.test.ts`) | **Matches** |
| 2 | Bank payment (ACH / e-check) — all three | Offered by the same page wherever the roofer has turned bank payments on in their own Stripe account (the page uses Stripe's automatic payment methods) | **Matches**, with that condition |
| 3 | The customer pays from a link on the invoice, no login — JobNimbus, Roofr | The invoice's own `/d/<token>` page, in the invoice email and now in the Invoiced-stage text | **Matches** |
| 4 | Text-to-pay — JobNimbus (with Engage) | The Invoiced stage texts the homeowner the invoice page ("Pay online at …"). Before this change that text linked the customer *portal*, which only exists when the portal is on, so it often carried no link at all | **Matches** at the Invoiced stage |
| 5 | Email a payment request — JobNimbus, Roofr | The invoice email carries the link; sending it is the existing Send | **Matches** |
| 6 | Part payment: the customer enters an amount — JobNimbus; in person up to the balance — Roofr | The server accepts a part amount on the customer's pay request and records it as a partial payment. Whether the invoice page offers the homeowner an amount box was **not verified** | **Not claimed** |
| 7 | Record a cash/cheque payment against the invoice — JobNimbus | Record Payment on the invoice (cash, cheque, other); it counts toward Collected the same way | **Matches** |
| 8 | Void stops payment through the link — JobNimbus | A draft or void invoice answers "not found" to the pay request | **Matches** |
| 9 | Card details never handled by the contractor's software — PCI (JobNimbus, Leap) | Card details are typed into Stripe's own payment fields; nothing is stored here | **Matches** |
| 10 | Payout to the contractor's bank (next business day JobNimbus; daily Leap) | The roofer's own Stripe account pays out on Stripe's schedule to their bank; no money moves on our account | **Different by design** |
| 11 | QuickBooks sync of payments — Leap | QuickBooks is already offered to roofing | **Matches** (existing) |
| 12 | The job reaches its paid stage by itself when the money is in | When every invoice that went out on the job is paid, in full, by card or by hand, the job moves from Invoiced to Collected, with the stage note, the "payment received" text and the review request. The pages read for JobNimbus, Roofr and Leap do not describe a job stage moving on payment | **Beats** (on what the pages state) |
| 13 | Pay from an estimate — JobNimbus | Not built for roofing in this change; quote deposits are a separate path | **Not doing** |
| 14 | One-tap "text payment request" from any invoice at any time — JobNimbus, Leap (scheduled requests) | Only the Invoiced-stage text and the invoice email exist. Parity needs a "Text this invoice" action on the invoice screen that sends the `/d/<token>` link through the shared sender, and optionally a scheduled send | **Not doing** (needs an invoice-screen action) |
| 15 | Receipt to the customer and the sales rep after payment — JobNimbus; receipts — Leap | No payment-received receipt email was found in the payment code. Parity needs a receipt email on payment (invoice paid, amount, method) to the homeowner and the rep | **Not doing** (gap) |
| 16 | Collect a card in person on the phone — JobNimbus, Roofr | Not allowed: owner decision pending (rule 6, no card-taking on the phone) | **Not doing** (owner's) |
| 17 | Platform fees passed to the customer — Roofr | A card surcharge is a legal question in several states and the roofer's own Stripe terms; not built | **Not doing** (owner's) |
| 18 | Payments dashboard with funding status — Roofr; financial reporting — Leap | The roofer's own Stripe dashboard shows payouts; the CRM's invoice list and reports show what is paid | **Different by design** |

## What this change builds
- Collected on payment (`server/crm/roof/collected.ts`), run from every way money lands on an invoice: a payment typed in on the screen, a card or bank payment on the roofer's Stripe, and bulk "mark paid" (the shared bulk service takes an optional after-payment step, `packages/tenant-backend/src/bulk/bulk.ts`).
- The Invoiced text links the invoice's own page (`server/crm/roof/stageEffects.ts`).
- Proven end to end on the real server (`apps/unified/tests/roof-online-payments.test.ts`), for a roofing business that has Online Payments on.

## Release gate (owner, 2026-10-30)
Roofing is **not offered** Online Payments yet: it is built and proven but not released, and offering a feature advertises it
(signup question, Features page). The registry line carries the release steps: add `crm-roof` to `online_payments` in
`packages/tenant-backend/src/featureRegistry.ts`, drop `roofing` from `SIGNUP_PAGE_HIDES.online_payments` in
`apps/unified/tests/signup-questions.test.ts`, flip the "not offered" assertion in `roof-online-payments.test.ts`, and edit
the website signup page's `ASK_HIDDEN_FOR` (the owner's other session).

## Still needed for full parity (not in this change)
Rows 6 (verify or add the amount box), 13, 14 and 15. Rows 16 and 17 are the owner's call.
