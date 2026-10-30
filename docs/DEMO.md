# The free "Try the demo" (cloud/crm-demo)

The real CRM screens, running entirely in the visitor's browser: no server, no database, nothing to pay for each month.
Six sample businesses (contractor, roofing, home care, salon, restaurant & bar, store), all invented, people are they/them.
Off until the owner links it: twomiah.com does not point here yet (`docs/demo/twomiah-website.patch` is the change, not applied).

## How it works
- `bun run build:demo` (apps/unified) builds the SAME web app (`web/src`, unchanged) for a static host: `web/dist-demo`.
  `web/demo/bootstrap.ts` starts first, locks the page, loads the trade's recorded data, then starts the CRM.
- **An in-app fetch layer, not a service worker.** It works on the first load (no registration, no reload), and it can be
  made a hard guarantee: `web/demo/guard.ts` replaces fetch, XHR, WebSocket, EventSource, sendBeacon, window.open and link
  clicks before any CRM code runs; the page's CSP allows only its own origin; the build rewrites every Twomiah / Stripe /
  Twilio / Cloudflare / Render / Netlify / map-service address out of the code (`web/demo/outside.ts`) and swaps the two
  Stripe packages for stand-ins.
- `web/demo/router.ts` + `store.ts` answer every `/api/*` call in the page: reads from the recorded data; adds, edits,
  deletes and status moves on in-memory rows (same response shapes as the real server); anything that would reach out (email,
  text, card, domain, invite, QuickBooks/Gusto…) answers "In the demo this is not sent." and does nothing else; any other
  route answers "This is not available in the demo." (404/501, `DEMO_UNAVAILABLE`), which every screen already shows cleanly.
- Changes live in the page's memory only: **Reset demo** drops them, a new tab never had them, nothing is written to storage.

## Recorded, not hand-written
`bun run record:demo [trade…]` boots the real unified server per trade (the test harness, in-memory Postgres), seeds it
through the server's own routes (`demo/seed/<trade>.ts`), replays the reads the real screens make (`demo/routes/<trade>.json`,
found by `scripts/discover-demo-routes.ts`, which walks the real screens in a browser; hand additions in `<trade>.extra.json`)
and writes `demo/public/demo-data/<trade>.json`. Dates move by whole days to the visitor's today.
**Keeping it current:** `tests/demo-drift.test.ts` re-records every trade and fails when any answer's shape changed
(field added/gone, type changed, route refused) until `bun run record:demo` is run and the data committed.

## Tests
- `tests/demo-drift.test.ts` — shapes against a fresh recording, all trades.
- `tests/demo-writes.test.ts` — each in-browser write/status move against the real server; reset returns the recorded answers.
- `tests/demo/outbound.test.ts` — no forbidden address in the build; in a browser every way of reaching out is refused.
- `tests/demo/walk.test.ts` — every reachable screen of every trade renders (no error page, no script error), every /api
  call is answered in the page, nothing requested from another host; desktop light and phone dark.
- `tests/demo/reset.test.ts` — a change shows, survives moving around, is gone on Reset, a second tab never had it; a job
  added through the real form appears and is gone after Reset.
- CI: job `unified-demo` in `.github/workflows/unified.yml`. By hand: `bun demo/walk.ts`, `bun demo/clickthrough.ts`,
  `bun demo/sheets.ts` (pictures, written outside the repo).

## Hosting
Static files only. Proposed: its own Netlify site on the Twomiah Netlify team (e.g. demo.twomiah.com), deploy the
`web/dist-demo` folder. Netlify reads the `_redirects` and `_headers` inside it (twomiah.com is a Render static site, where
rewrites are dashboard rules), and a separate origin keeps the demo's storage and CSP apart from the marketing site.
A visit loads about 2 MB (gzip); no functions, forms or database.
