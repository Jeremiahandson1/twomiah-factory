# Intended behaviour — things that look like bugs and are not

**Purpose:** a QA-facing list of behaviours that get reported as defects every test round, with the reason each one
is deliberate and what the product guarantees *instead*. If a finding matches an entry here, it should be closed as
"by design" rather than re-reported. If you disagree with an entry, say so — these are product decisions, not laws,
and each one names the trade-off it is making.

Every entry follows the same shape: **what a tester sees** → **why it is that way** → **what we guarantee instead**.

---

## Jobs / service calls

### A job can be saved without a customer

**Seen:** `POST /api/jobs` with no `contactId` returns 201; the job list shows a row with no customer.

**Why:** plenty of real work has no customer — regrinding mower blades, servicing the trailer, spraying the shop
lot, a make-good visit logged against nothing. Requiring a customer pushes staff into inventing a placeholder
contact ("Internal", "N/A", "Shop"), which then pollutes the customer list, the customer count on the dashboard,
and every report that groups by customer. The cure is worse than the complaint. Jobber, ServiceTitan and Housecall
Pro all allow customer-less internal work for the same reason.

**Instead:** the job list shows **"No customer"** in muted italics rather than an empty cell, so a job that is
missing its customer *by mistake* is easy to spot and fix. (Landscaping T21 L2, #215)

### A job can be scheduled in the past

**Seen:** `POST /api/jobs` with `scheduledDate` in 2020 returns 201, and the job then shows as Overdue.

**Why:** backdating is how work that already happened gets recorded. A crew finishes on Tuesday and the office
enters it on Thursday; a job gets reconstructed from a paper ticket weeks later. Refusing past dates makes that
impossible, and the workaround — dating everything "today" — destroys the history the reports are built on.
An old job that is still open genuinely *is* overdue, so the badge is telling the truth.

**Instead:** impossible dates *are* refused — 30 February, 31 April, month 13, 32 January — because those are data
errors, not a calendar a business can operate in. A date-only value must round-trip its own year-month-day.
(Landscaping T21 M5 + L3, #215)

### Job status is not a locked sequence

**Seen:** a job can be marked Complete without ever being Started, and a Completed job can be moved back to
Scheduled or started again.

**Why:** the dispatch board is a correction tool, not a workflow engine. Crews forget to press Start constantly —
they do the work and mark it done at the end of the day — and a mis-tapped Complete on the wrong job has to be
undoable. Enforcing Start → Complete traps both of those, and the usual result is staff leaving jobs in the wrong
state entirely because the system will not let them fix it.

**Instead:** the *record* stays honest however the status moves. Completing a job stamps the real completion time
whichever way it was completed (the Complete action, an edit, or a bulk change), and moving a job back out of
Completed clears that stamp instead of leaving a stale one behind — so a reopened job never keeps claiming it was
finished, and payroll, invoicing and reporting stay correct. (Landscaping T14 L13 + T21 L4, #213)

---

## Documents

### `GET /api/documents/:id/markups` returns "Route not found" on most CRMs

**Seen:** the markups endpoint 404s, and the string `/markups` is visible in the app bundle.

**Why:** plan markups are annotation layers drawn over construction drawings. Only the contractor CRM has the
`plan_markup` table and turns the tool on (`docsConfig` `markup: true`); no other vertical ships it. Every CRM
serves the *same* shared Documents page code, so the markup component — and its endpoint strings — are present in
the bundle of CRMs that never render it.

**Instead:** the Markup button is gated on that config, so on a CRM without markups it never renders and the app
never calls the path. Verified on the deployed landscaping bundle: the shipped Documents config carries no `markup`
key, `markup:true` appears nowhere in the bundle, and the button is built as `cfg.markup ? [Markup] : []`. The
route correctly does not exist because the table does not. (Landscaping T21 M3, T22)

### Version history lists the file that is live now

**Seen:** the versions list contains an entry with `"id": null`.

**Why:** the live file is part of its own history — without it the newest thing the list knew about was the copy
that had just been *replaced*, so nothing said which version you were looking at. The live entry has no version row
because it *is* the document, hence the null id.

**Instead:** it is flagged `isCurrent: true`, numbered as the newest version, and downloads from
`/api/documents/:id/download`; only superseded versions carry an id and a Restore action. (Landscaping T21 M3, #217)

---

## Money

### A refunded sale still counts as billed

**Seen:** Reports and the invoice stats still include an invoice that was fully refunded.

**Why:** "invoiced" is what was billed in the period — that is a historical fact and a refund does not un-bill it.
Dropping refunded sales out of revenue makes the period's figures disagree with the invoices themselves and hides
the refund entirely.

**Instead:** refunds are shown as their own figure (`refunded` on the revenue overview, `refundedAmount` on invoice
stats), while outstanding and overdue are computed over issued invoices only. (Landscaping T14 H4, #204)

---

## Twomiah Ads (parked)

### Every Ads route answers 403 and the Ads menu item is gone

**Seen:** `/api/ads/*` returns `403 FEATURE_NOT_ENABLED` on every tenant; Ads is absent from Settings › Features
and from the Factory build wizard.

**Why:** Twomiah Ads is not finished, so as of 2026-09-18 it is parked: the `paid_ads` feature is hidden, offered to
no template and named in no plan tier, and both Factory catalogues drop it. The code, routes, page and connector all
still exist and are still gated on that feature id — parking is a switch, not a deletion.

**Instead:** nothing in the product advertises it. A CRM with the feature off shows "Ads is not enabled for your
account." rather than sending the user out to a sales page. Findings about ad-copy previews, ad accounts or campaign
data are not actionable until Ads is unparked. (#220, #221)

---

## Real-time updates

### The live-update socket opens once per page LOAD, not per navigation

**Seen:** "a new socket connects on every page navigation" (vet T12 L10).

**Why:** it does not. The socket is opened by `SocketProvider`, which sits above the router, so it survives every
in-app navigation; a new connection is only made when the browser loads a new document (a hard refresh, or following
a link that leaves the SPA).

**Measured**, rather than reasoned about — Chrome driven over the DevTools protocol against the live vet tenant,
counting `Network.webSocketCreated`:

| | |
|---|---|
| Log in, then load `/crm` | 2 sockets — one per document load, as expected |
| Click all ten sidebar links in turn | **+0 sockets**, 0 closes |
| Hold the session open afterwards | +0 sockets; frames still arriving on the original connection |

What looks like reconnection in a network panel is socket.io's own transport traffic on the one connection.
`scratchpad/cdp-socket-count2.ts` reproduces the measurement. If a future report says otherwise, run it before
changing the provider. (#241)

---

## Refunds

### Refunding a PARTIAL payment puts the balance back — that is the point

**Seen:** a $100 invoice with $40 paid reads *partial*, balance $60. Refund that $40 and it reads *sent*,
`amountRefunded` $40, balance **$100** — the balance went UP after a refund (contractor T14 L1).

**Why:** the customer's $40 went back to them, so they owe the whole $100 again. A refund reverses a payment;
reversing the only payment on an invoice leaves the invoice unpaid, and an unpaid invoice owes its total. The
figures are self-consistent throughout: `amountPaid` stays gross, `amountRefunded` records what went back, and
the balance is what is actually collectable.

**The rule it appears to contradict** — "a refund must never create a balance owed" — is about a FULLY PAID
invoice, and there it holds exactly. Verified on this tenant: INV-00065, $189.44 paid, took a partial refund
and stayed **Paid at a $0 balance** with the refund on its own line, and only became *Refunded* once
everything was returned. INV-00073 behaves the same way.

| | invoice | paid | refunded | status | balance |
|---|---|---|---|---|---|
| partial payment, refunded | $100 | $40 | $40 | sent | **$100** — owed again |
| full payment, fully refunded | $200 | $200 | $200 | refunded | $0 |

**Decision:** left as designed (2026-09-18). A partial refund on a partly-paid invoice SHOULD restore the
balance; anything else would show money as collected that the business no longer holds. (T14 L1)

---

*Last updated 2026-09-18.*
