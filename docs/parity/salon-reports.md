# Salon #11 — Reports: retention, rebook rate, retail

## Sources (help-centre pages actually read)

- Timely — How to use the client retention report: https://help.gettimely.com/hc/en-gb/articles/34276624537751-How-to-use-the-client-retention-report
- Boulevard — Detailed reports (list of reports and what each shows): https://intercom.help/joinboulevard/en/articles/15609033-detailed-reports
- Fresha — Reports and Insights glossary: https://www.fresha.com/help-center/knowledge-base/reports/270-reports-and-insights-glossary

What those pages say, so nothing below claims more:

- Timely: retention % is "a percentage of clients from your selected date range who have booked again in the future"; new = booked in the range and not before; returning = booked before and in the range; bookings that were cancelled, declined, deleted or no-shows are excluded; the figures are per client and can be sliced by staff, service, location. Rebooking is a separate figure it points to its Executive Summary for.
- Boulevard: lists Client retention (return rates compared across time windows), Staff client retention (how well each staff member brings clients back over several return windows), Retail sales and Staff retail sales (product performance; each team member's retail), and Commission summary / line items. It lists no dedicated rebooking report.
- Fresha: a Client summary of new, returning and walk-in clients; a Sales summary that **excludes gift card sales**. Its glossary page does not define rebooking or retention.
- Vagaro and GlossGenius: no help-centre page reached.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| New vs returning clients in a period (Timely, Fresha) | Active clients in the period split into new (first visit ever in the period) and returning | **Matches** |
| Retention % = clients who booked again (Timely) | "Booked again": of the clients who came in, the share holding an appointment from today on (cancelled and no-shows excluded) | **Matches** |
| Retention over time windows (Boulevard) | "Came back": of the clients who came in the period just before, the share who came in this one. One window only (the period before) | **Partly** |
| Visit frequency | Visits per client, a once / twice / 3–4 / 5+ split, and the average days between visits for clients who came more than once | Built (no vendor page read to compare) |
| First-timers who return | New clients who have had a second visit or hold a booking | Built (no vendor page read to compare) |
| Clients who have slipped away | Not in for N days and nothing booked; N is the win-back days set in Automatic messages (default 90) | Built |
| **Rebook rate per stylist** (the brief: no vendor page names one) | Of the visits a stylist did, the share that left with a next appointment: another appointment after the visit, not cancelled or a no-show, booked no later than a day after the visit (or already on the books). Also the whole-salon rate | Beyond what the pages read show |
| Staff retention by return window (Boulevard) | Per-stylist rebook rate above; no per-stylist return windows | **Partly** |
| Retail sold by item (Boulevard) | Retail lines on paid sales in the period, by item: units and money (before tax) | **Matches** in kind |
| Retail by stylist (Boulevard "Staff retail sales") | Retail by the stylist of the visit the sale closed. No discounts / refunds per person | **Partly** |
| Retail by brand / category / supplier / SKU, margins, inventory (Boulevard) | No | **Not built** |
| Commission report (Boulevard "Commission summary") | The Commissions page (#8): statements and the list, per stylist | Lives on the Commissions page |
| Gift-card sales out of sales totals (Fresha) | See below | **Decision for the owner** |

## Decisions and limits to know

- **Off by default.** The feature id `salon_reports` is registered not-ready (hidden), mounted at `/api/salon-reports`, and each report asks `reports:read`.
- Dates are the salon's own calendar days; a period is up to two years; the default is the last 90 days. A period with more than 50,000 visits is said to be cut (never silently).
- **Visits are the service records** a completed visit writes; a visit with no stylist recorded is grouped as "No stylist recorded".
- **Retail** needs retail lines on sales (line type `retail`). Until checkout at the chair (#7) adds them, they come only from lines the desk types onto a sale, so this report is empty for most salons today.
- **Revenue and gift cards.** These reports do not count money, except retail. The invoice-based revenue totals elsewhere count a gift card's sale and the later service paid with it (see `salon-gift-cards.md`).
- Proving test: `apps/unified/tests/salon-reports.test.ts` (5) — closed until the feature and seat rights; range validation and zeros for an empty salon; retention figures against a hand-worked set of seven clients; rebook rate per stylist including a cancelled booking that must not count; retail paid-only, by item and by stylist. It fails without the change (no routes).
- The screen is type-checked and built but **not click-tested in a browser**.
