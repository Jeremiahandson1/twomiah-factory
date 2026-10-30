# Salon #2 — Memberships charge the card on file automatically

## Sources (help-centre pages actually read)

- MyTime — Retrying Failed Membership Charges: https://help.mytime.com/support/solutions/articles/31000174747 (the only help-centre page found that describes failed-membership-charge behaviour in detail)
- Square — Use Card on File with Square Appointments: https://squareup.com/help/us/en/article/6068-use-card-on-file-with-square-appointments (consent; it describes charging a card on file manually and says nothing about automatic membership billing)

Searches for Fresha, Vagaro, GlossGenius and Boulevard help-centre pages on automatic membership billing returned no help-centre page, so nothing below claims a match against those four.

## Where this stands

| Capability | Here | Status |
|---|---|---|
| Member's card is charged automatically each period (MyTime) | When a period's invoice is raised, the member's card on file is charged for the invoice total, on the salon's own Stripe account; the invoice is marked paid | **Matches** |
| Written authorization from the client before saving/charging a card (Square) | Turning it on needs the "client agreed" tick; who ticked it and when are kept on the membership. The card's own agreement is kept with the card (item #1) | **Matches** |
| Retry a failed charge a set number of times (MyTime: up to 3, daily) | 3 tries, 3 days apart (fixed, not a setting) | **Matches the count; interval fixed, not configurable** |
| Client emailed when a charge fails (MyTime: partly) | Emailed on every failed try, with what happens next; and a receipt on success | **Matches** |
| After the last failure the membership is suspended and benefits revoked (MyTime) | Owner's decision 2026-10-30: after the third decline the membership is PAUSED — no credits can be used, no renewal invoices are raised, the unpaid invoice stays open. The member is emailed a private link to a Stripe card page on the salon's own account; the card they save restarts the membership and pays the open invoice. A seat with payment rights can also press Resume (a card that still declines pauses it again with a new link) | **Matches** (proved in tests) |
| Staff alert on a failed charge (MyTime: email to staff with a permission) | The salon's email address is told when a membership is paused for a declined card; the Memberships row shows "Paused" and refreshes live. A staff email on each earlier decline is not sent | **Matches for the pause; earlier declines screen-only** |
| Staff "Retry now" from the member or a payments report (MyTime) | Not built; the next try runs on its own after the wait | **Not built** |
| Backup card (MyTime) | Not built | **Not doing** |
| Charged twice by a double run, a crash or a double click | One try is claimed before Stripe is asked; Stripe's idempotency key is the invoice and try number; a try that died half-way is resumed under the same key | **Beats** (proved in tests) |
| Existing members | Off by default; every existing membership keeps raising an open invoice exactly as before | **By rule** |
| Money on Twomiah's account / card taking on the phone | Never: salon's connected account only; nothing on the phone app | **By rule** |

## What parity still needs

A "Retry now" button before the third decline; a staff email on each earlier decline; a configurable retry interval.
