# Home care parity: private pay billing

Researched 2026-10-30 from public help and product pages only. All wording is paraphrased. Page contents were read through a summarising fetch step, so re-open a link before building to a detail.

## Leaders checked

- AxisCare (help.axiscare.com blocked here): https://axiscare.com/features/billing/ , https://axiscare.com/axiscare-bill-and-collect/ , https://axiscare.com/solutions-by-payer-source/
- WellSky Personal Care: https://info.wellsky.com/WellSkyPersonalCare.html
- AlayaCare: https://alayacare.com/private-pay/
- Stripe docs (for our payment rail): https://docs.stripe.com/payments/setup-intents.md , https://docs.stripe.com/payments/cards/save-and-reuse
- Reference: MetLife LTC provider invoice guide (payer-side requirements).

## Capability table

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Families view invoices, pay online and store a bank (ACH) or card on file in a secure portal | AxisCare | https://axiscare.com/features/billing/ | TBD |
| Autopay that billing staff schedule, receipts sent after; clients/family can add and update payment details; ACH plus cards, next-day funding for qualified merchants | AxisCare (Bill & Collect) | https://axiscare.com/axiscare-bill-and-collect/ | TBD |
| Payment details held in a per-client wallet; Bill & Collect payments sync to QuickBooks automatically | AxisCare | https://axiscare.com/?p=14521 | TBD |
| Family Portal payments auto-applied to matching invoices; staff can also take payments in the web app (Canadian methods via a processor integration) | AlayaCare | https://alayacare.com/private-pay/ | TBD |
| Billing contact can be client or family, client flagged self-pay, invoice sent to up to five emails, bulk update of billing contact across services | AlayaCare | https://alayacare.com/private-pay/ | TBD |
| One-click batched invoicing; per-service-line billing rules | AlayaCare | https://alayacare.com/platform/overview/whats-new/ | TBD |
| Card payments via a partner processor (Worldpay) and e-claims via a clearinghouse partner; no private-pay or autopay detail | WellSky Personal Care | https://info.wellsky.com/rs/596-FKF-634/images/WS-PC027-Maximize-WellSky-Personal-Care.pdf?version=0 | TBD |
| Autopay retries after a decline: not documented by any leader | none found | https://axiscare.com/axiscare-bill-and-collect/ (page silent) | TBD |
| Failed-payment notice to payer: not documented by any leader | none found | https://axiscare.com/axiscare-bill-and-collect/ (page silent) | TBD |
| LTC insurance: generates the claim and care notes and faxes them to the payer from inside the product | AxisCare | https://axiscare.com/solutions-by-payer-source/ | TBD |
| LTC insurance claim submission handled for the agency; LTCI listed as a supported feature in the FAQ (no workflow given) | AlayaCare | https://resources.alayacare.com/videos/long-term-care-insurance | TBD |
| Client file stores LTC policy number, claim number and daily cap; caregivers tick ADLs at clock-out as documentation insurers want (sponsored article about AlayaCare) | AlayaCare | https://homehealthcarenews.com/2021/01/how-long-term-care-insurance-billing-systems-boost-care-outcomes/ | TBD |
| What an LTC carrier wants in a packet: typed invoice on provider letterhead, insured name, each charge by date, service type, hours and rate, plus agency timesheets; submit by mail, fax or email; only after services delivered | Payer requirement (MetLife), not a leader | https://qa1.metlife.com/content/dam/metlifecom/us/homepage/ltc/documents/provider-payment-guide-and-invoice-home-care.pdf | TBD |
| Split billing: one client's charges divided across several payers and invoices | AxisCare | https://axiscare.com/solutions-by-payer-source/ | TBD |
| Split by policy cap: a 500 invoice against a 400 daily cap yields one insurer invoice (400) and one client invoice (100) | AlayaCare (sponsored article) | https://homehealthcarenews.com/2021/01/how-long-term-care-insurance-billing-systems-boost-care-outcomes/ | TBD |
| QuickBooks sync: appointments, invoices, timesheets and visits grouped into billing/payroll batches and pushed one way into QuickBooks on demand; no fee from AxisCare | AxisCare | https://axiscare.com/?p=14521 | TBD |
| Stripe SetupIntent saves a payment method with no charge; usage defaults to off_session so the bank authenticates once up front | Stripe | https://docs.stripe.com/payments/setup-intents.md | TBD |
| Stripe off-session consent: need a mandate/terms covering permission, expected frequency and how amounts are decided; a properly saved card is then flagged merchant-initiated | Stripe | https://docs.stripe.com/payments/setup-intents.md | TBD |
| Stripe charge of a saved card off-session: PaymentIntent with off_session true and a stored-credential usage type (recurring, unscheduled or installment) declared; save-time usage type is set on the SetupIntent | Stripe | https://docs.stripe.com/payments/cards/save-and-reuse | TBD |
| Stripe: if authentication is demanded later, build a recovery flow that brings the customer back online | Stripe | https://docs.stripe.com/payments/setup-intents.md | TBD |
| Stripe retries (invoices/subscriptions): Smart Retries recommended default 8 tries in 2 weeks, window 1 week to 2 months; or custom up to 3 retries; hard declines wait for a new payment method; ACH retries only for insufficient funds (2 retries, 40 days) | Stripe | https://docs.stripe.com/billing/revenue-recovery/smart-retries.md | TBD |
| Stripe failure notices: email on failed card payment, email about a month before card expiry, hosted link to confirm a payment needing authentication with optional reminders | Stripe | https://edge-docs.stripe.com/billing/revenue-recovery/customer-emails | TBD |
| Stripe one-off invoices: reminder schedule before/on/after due date, hosted invoice page link on failure, mark uncollectible after 30/60/90 days | Stripe | https://docs.stripe.com/billing/automatic-collection | TBD |
| Stripe `invoice.payment_failed` webhook carries attempt count and next attempt date; end-of-retries action cancel, mark unpaid, leave past due or pause | Stripe | https://docs.stripe.com/billing/revenue-recovery/smart-retries.md | TBD |

## Gaps and uncertainty

- AxisCare Bill & Collect page does not mention retries or failed-payment notices; the full help centre (blocked) may. Not found for all three leaders.
- AxisCare autopay: the page only says staff can schedule it; whether it is per-invoice, recurring, or opt-in by family is not found.
- WellSky Personal Care: private-pay autopay, LTC billing, split billing and QuickBooks not found. WellSky's LTC revenue-cycle page covers long-term care facilities, not home care, so it was left out.
- AlayaCare: autopay, split billing (private-pay page silent) and QuickBooks not found. The split-by-cap example is from a vendor-sponsored article about one customer. The LTCI claim transmission method (fax, portal, clearinghouse) is not found.
- "Claim packet" as a named product feature: not found anywhere; the closest is AxisCare faxing claims with care notes. The packet contents above come from one insurer (MetLife); other carriers differ.
- AxisCare QuickBooks: whether customer records, credits or payments in the reverse direction sync is not stated; the page says data flows one way.
- Stripe retries and emails are documented for Billing subscriptions and invoices. For a bare off-session PaymentIntent we would need our own retry and notice logic (my reading, not stated on the Stripe pages). Stripe's exact error handling text for off-session declines was not retrievable (the page returned only an index).
- Stripe pages were fetched as markdown copies; dollar figures in the split example are rounded as written in the article.
