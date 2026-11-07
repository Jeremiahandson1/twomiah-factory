# Contractor payments / POS — parity with Buildertrend Payments, JobTread Payments and Jobber Payments

Brief row 12 (contractor, 10/31 round). Written 2026-11-07 from the leaders' own pages (sources at the end), checked against our
payments (`packages/tenant-backend/src/payments/stripe.ts`, the portal, `apps/unified/server/crm/billing/`). Marks: **built** ·
**partly** · **not built**. Everything new is hidden until the owner has tried it.

| Leader feature | Ours before row 12 | Mark after |
|---|---|---|
| Card and ACH on every invoice (all three; Jobber: ACH on by default in the US, 1%) | `online_payments`: card, and bank where the business turns it on in Stripe | built |
| Choose card, bank or both per quote / invoice (Jobber) | none | built (12b) — `payment_method_choice`: per invoice, Stripe is asked for that method alone |
| Draws / payment schedule paid online (BT draws, BT Payments) | — | built in row 10b (payment schedule released into invoices, paid in the portal) |
| Pass the card fee to the client where lawful (BT: account default; JobTread via Truss) | roofing only (`card_surcharge`: capped by state, never debit / prepaid, shown before paying, on the receipt) | built (12a) — opened to the contractor CRM |
| Partial payments (Jobber, per invoice) | roofing only (`portal_pay_options`: the customer picks the amount) | built (12a) — opened to the contractor CRM |
| Payment plans (installments on an invoice) | none | built (12b) — `payment_plans`: installments that add up to the total; the due date follows the next one, so the reminders remind for each; the portal offers that installment |
| Deposits on approval (Jobber "Approve and Pay Deposit") | built (quote deposit raised on approval, paid online) | built |
| Automatic payment reminders (Jobber, until paid) | built (`invoiceReminders`, every vertical: due soon, overdue steps, late fee) | built |
| Text an invoice's pay link, now or on a schedule; receipts for every payment | roofing only (`invoice_text_requests`) | built (12a) — opened to the contractor CRM |
| Tips (Jobber tips on invoices) | the salon's desk / reader only | built (12b) — `invoice_tips`: none / 10 / 15 / 20 % / typed on the pay page, kept as the payment's tip, never money toward the invoice; also on the surcharge path, never surcharged |
| Tap to Pay on the phone | built (`tap_to_pay`, lists `crm`; the phone's invoice screen is gated by the switch alone) | built |
| Payouts view (what is on its way to the bank) | roofing only (`payments_overview`) | built (12a) — opened to the contractor CRM, with its menu item |

Row 12 is built: every row above is marked built.

## Steps only the owner (or an outside party) can take

- **ACH**: turn on "US bank account" payments in the business's Stripe account (Stripe's own review). Without it, "bank only" on an
  invoice cannot be paid and Stripe says so on the pay page.
- **Card surcharges**: card-network registration before surcharging (Visa / Mastercard ask for notice in advance), and the state
  rules — the app caps by state and refuses where it is not allowed, but the business confirms its own state's rule.
- **Tap to Pay on iPhone**: Apple's Tap to Pay entitlement for the app (listed in the Tap to Pay build checks).
- **Consumer financing** (Wisetack and the others): the partner agreement — built last, per the owner (field service brief item 11;
  `consumer_financing` already lists `crm`).

## Sources

- Jobber: bank payments (ACH) — https://help.getjobber.com/en/articles/bank-payments-ach/ ; collecting payment on an invoice — https://help.getjobber.com/en/articles/how-to-collect-payment-on-an-invoice/ ; ACH guide — https://www.getjobber.com/academy/accept-ach-payments/
- Buildertrend: Payments FAQs — https://buildertrend.com/help-article/buildertrend-payments-faqs/ ; receiving client payments — https://buildertrend.com/help-article/buildertrend-payments-receiving-client-payments/
- JobTread: collect payments — https://www.jobtread.com/collect-payments ; Truss–JobTread FAQ — https://articles.trusspayments.com/en/articles/14020094-truss-jobtread-faq
