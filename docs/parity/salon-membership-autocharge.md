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
| Retry a failed charge a set number of times (MyTime: up to 3, daily) | Memberships › "When a card is declined": tries in all (1–6, the first charge counts; default 3) and days between (1–14; default 3), set by the owner or an admin | **Matches** (10/31, parity row 6) |
| Client emailed when a charge fails (MyTime: partly) | Emailed on every failed try, with what happens next; and a receipt on success | **Matches** |
| After the last failure the membership is suspended and benefits revoked (MyTime) | Owner's decision 2026-10-30: after the third decline the membership is PAUSED — no credits can be used, no renewal invoices are raised, the unpaid invoice stays open. The member is emailed a private link to a Stripe card page on the salon's own account; the card they save restarts the membership and pays the open invoice. A seat with payment rights can also press Resume (a card that still declines pauses it again with a new link) | **Matches** (proved in tests) |
| Staff alert on a failed charge (MyTime: email to staff with a permission) | An email on EVERY decline to each active seat that holds the payments permission (owner and admin): who, how much, which try of how many, why, whether a backup was tried, and what happens next. The salon's own address is still told when the membership is paused | **Matches** (10/31, parity row 6) |
| Staff "Retry now" from the member or a payments report (MyTime) | "Retry now" on the member's row and on a new "Cards that failed" list (Memberships), for the seat that takes payments (invoices:update). It makes the next try at once, counted like any other, and who pressed it is kept; refused once every try is used (Resume is the way back) and on a paused membership | **Matches** (10/31, parity row 6) |
| Backup card (MyTime) | When the main card is DECLINED, the client's other cards on file are tried in the same try, each under its own Stripe key; one that needs the client's own approval is not retried on a backup. The main card is the newest one kept on the chart; the older ones are the backups, tried newest first. There is no screen yet to choose which card is the main one (add a new card to change it) | **Built; main card = newest, no chooser** (10/31, parity row 6) |
| Charged twice by a double run, a crash or a double click | One try is claimed before Stripe is asked; Stripe's idempotency key is the invoice and try number; a try that died half-way is resumed under the same key | **Beats** (proved in tests) |
| Existing members | Off by default; every existing membership keeps raising an open invoice exactly as before | **By rule** |
| Money on Twomiah's account / card taking on the phone | Never: salon's connected account only; nothing on the phone app | **By rule** |

## What parity still needs

Nothing from the leaders' pages. A "make this card the main one" chooser is not built (the main card is the newest). Not seen in a real browser or on a phone; proved against a simulated Stripe.
