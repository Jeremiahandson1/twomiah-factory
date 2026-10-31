# Bar 9 - Tip pooling and tip-out

Feature ids: `bar_tip_pooling` (hidden, not ready); `bar_declared_tips` (hidden); `bar_tip_import` (hidden); `bar_payroll_export` (hidden, the payroll export).
Tests: `apps/unified/tests/bar-payroll-export.test.ts` (payroll export), `apps/unified/tests/bar-tip-pooling.test.ts`, `bar-declared-tips.test.ts` (3), `bar-tip-import.test.ts` (5); phone: `tests/mobile/bar-shift-requests.test.ts`.

Leader: 7shifts Tip Pooling - https://kb.7shifts.com/hc/en-us/articles/4417505157779

| Leader capability | Ours | Mark |
|---|---|---|
| Pool rules by hours worked | Rules by hours and by role percentage | matches |
| Tip-out percentages by role | Role percentages | matches |
| Nightly tip-out shown at close | Tip-out card on the close-out, managers only; recorded when the feature is on | matches |
| Report of payouts | Tips page with payout table (declared and imported parts shown) | matches |
| Declared (cash) tips at clock-out | Staff declare at clock-out on the phone, the counter tablet and the website; a manager sees and corrects (the first figure is kept); they join the pool and the tip-out; a closed night is worked out again after a correction. Cash tips rung on our register are shown beside the box and never declared twice | matches |
| Declared tips in the payroll export | `declaredByPerson(companyId, from, to)` in `server/crm/bar/barTips.ts` gives declared cents per person per day. The payroll export (`bar_payroll_export`, `server/crm/bar/barPayroll.ts`, `tests/bar-payroll-export.test.ts`) reads it: declared cash and the register's own cash tips are shown as cash already received and taken off the paycheck tips, and each tip is counted once (the total comes from the closed nights' payouts only) | matches for the figures and the three files (Gusto, ADP, spreadsheet). **Partly** in that no file has been uploaded to a real Gusto or ADP account and their tip columns are not confirmed - see restaurant-8-kitchen-stock-schedule.md |
| POS integrations (Toast, Square) supply tips | Connect Toast (the venue's own read-only credentials) or Square (OAuth); tips per business day join the same pool; staff matched by email or by hand; unmatched tips are listed, not shared | partly - built up to each provider's approval, never run against a live account (see below) |
| Tip-out as a share of SALES with tips from another register | Sales on another register are not read, so a sales-based tip-out uses this register's sales only (the night says so) | not built - needs sales from the other register |
| Tips reported by the other register that change after the night is closed | A closed night is left as frozen; closing it again reads the register again | partly |

## What was and was not confirmed about Toast and Square

Read from the providers' own developer pages (2026-10): Square OAuth (authorize, token, refresh, 30-day token, renew at 7 days), `GET /v2/payments` (begin_time, end_time, location_id, cursor, limit 100), `POST /v2/team-members/search`; Toast login, `ordersBulk` (businessDate, page, pageSize), `labor/v1/employees`, the Toast-Restaurant-External-ID header, and how a venue makes Standard API credentials.

Not confirmed from a page that could be read, so built to the best reading and listed here:
- Square: that `tip_money` is on the payment object (the list page's sample omits it; it is in Square's Payment object); the revoke endpoint (we never call it: disconnecting deletes our copy of the keys and the owner removes the app in Square); whether an app used by other sellers needs Square's review (Square's pages do not say).
- Toast: the production API hostname (the pages show a placeholder), so the venue types the host Toast gave it and the server accepts only `*.toasttab.com`; the full list of `paymentStatus` words (voided, denied, cancelled, error and fully refunded payments are skipped, the rest count); that `tipAmount` is in dollars (read as dollars, rounded to whole cents); rate limits (not stated).
- Both: the tests use fakes of the documented shapes. Nothing was run against a live Square or Toast account.

## Owner's check: connecting Toast and Square (steps only the owner or Twomiah can do are marked)

Turn on `Tips From Another Register` for the venue (it is hidden until the owner has tested it).

Square
1. (Twomiah, once) Create the developer application at developer.squareup.com and note its Application ID and secret. Put them in the venue's settings as `SQUARE_OAUTH_CLIENT_ID` and `SQUARE_OAUTH_CLIENT_SECRET` (`SQUARE_OAUTH_SANDBOX=true` to use Square's sandbox).
2. (Twomiah, per venue) In the application's OAuth settings add the redirect address shown at the bottom of Tips > Other register (it ends `/api/tip-sources-return/square/callback`). Square only redirects to addresses registered by hand.
3. (Owner) Tips > Other register > Connect Square. Sign in with the Square account that takes the payments and allow Payments and Team (read-only).
4. Check: the Square card says Connected; the "Who is who" list shows the Square team members, matched by email where the address is the same. Match anyone left over by hand.
5. Take a test payment with a tip on Square. Open Tips > A night. The tip shows under the matched person ("from another register"), and tips from anyone unmatched appear in the night's notes. Open the same night twice: the figure does not change.
6. Remove the app in Square (Apps) and open the night again: the card changes to "Needs your attention" and the night says Square tips are not up to date. Connect again to restore it.
7. Per-employee tip pooling inside Square itself needs Square for Restaurants Plus; that is Square's own feature and is not needed here.

Toast
1. (Owner) In Toast Web: Integrations > Toast API access > Manage credentials > Create new credentials > Standard API (read-only). Allow orders and employees for the location. This needs a Toast Restaurant Management Suite subscription (Essentials or higher) and the Manage Integrations permission at every location. Toast emails the restaurant ID; the client ID and secret are shown once.
2. (Owner) Tips > Other register > Toast: type the API address Toast gave you (ends in toasttab.com), the restaurant ID, the client ID and the client secret. The keys are tried once before they are kept; a typo is caught on the spot. The secret is kept scrambled and is never shown again.
3. Toast partner access (a listing for other venues to find, or access beyond read-only standard credentials) needs Toast's integration team to review and approve an application. That is Toast's step, outside this build, and is not needed for one venue's own read-only credentials.
4. Check as Square steps 4 to 6 (to break it: delete the credentials in Toast Web).
