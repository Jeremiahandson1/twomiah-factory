# Cutover ledger

Everything the unified app moved out of existing code instead of importing it, and
what must happen to the original at cutover, so no second copy survives
(RULEBOOK §10). Also the shared-code fixes the fence holds back until then.

## Moved; delete the original at cutover

| Unified app | Original | Notes |
|---|---|---|
| `apps/unified/server/core/brandColour.ts` (`ensureDark`, `colourOnWhite`) | `apps/api/src/services/generator.ts` `hexToRgb`, `relLuminance`, `rgbToHex`, `ensureDark` and the `primaryOnWhite` computation | Same numbers. The generator still needs them for the CRM templates until those retire. |
| `apps/unified/server/core/logger.ts` | `templates/crm*/backend/src/services/logger.ts` | |
| `apps/unified/server/core/audit.ts` (recording half) | `templates/crm*/backend/src/services/audit.ts` `log`, `diff`, `ACTIONS`, `ENTITIES`, `requestScope` | Taken from the eight identical newer copies. The read half (query, history, filter options) moves with the audit screen, through `server/data/`. |
| `apps/unified/server/core/email.ts` (machinery + password reset) | `templates/crm*/backend/src/services/email.ts` provider, transport, `send`, `sendRaw`, `inlineButtonColours`, `passwordReset` | Brand values read from the company row instead of build-time placeholders. Each module's messages move in with that module. |
| `apps/unified/server/http/errors.ts` | `templates/crm*/backend/src/utils/errors.ts` | The version naming every invalid field. |
| `apps/unified/server/http/guards.ts` | the CSP, paging guard and rate limiter in `templates/crm*/backend/src/index.ts` | The newer rate limiter (limit and retry headers). |
| `apps/unified/server/db/schema/core.ts` | `company`, `user`, `audit_log`, `mfa_devices`, `mfa_challenges` in `templates/crm/backend/db/schema.ts` | Column for column; only `primary_color`'s default differs (was a build placeholder). |

| `apps/unified/site/views/**` (section library, `base.ejs`, `home.ejs`) | `templates/website-premium-{contractor,dispensary,fieldservice,homecare,landscaping,roofing,rv,showcase,vet}/views/**` | 41 files byte-identical to every copy (`tests/site-parity.test.ts`). Merged on purpose: `before_after/slider` (contractor's control + the June filters), `contact/form-info` (vertical words, posts `message`), `base.ejs` (home care's text-size control behind a setting), `home.ejs` (passes `words`, logs a broken section instead of hiding it). |
| `apps/unified/site/public/styles/main.css`, `site/designs/*.css` | each template's `build/styles/main.css` | The base plus every section's styles once; each design's site-wide flourishes on top. Dropped as dead: the old `.before-after`/`.ba-card` slider styles and roofing's pre-July `.trust` badges. Colours filled per request from the company row instead of at build. |
| `apps/unified/server/site/*` (routes, render, context, inventory feed, enquiry handler) | `templates/website-premium-*/server-static.ts` public routes, `handleLead`, `markdownToHtml`, feed code | The enquiry goes straight into the CRM's routing (`core/enquiry.ts`) instead of a webhook. One address setting: `SITE_URL` (the site also read `SITE_ORIGIN`; the Factory sets only `SITE_URL` from cutover). |
| `apps/unified/server/core/brandColour.ts` `accentOnLight` | `apps/api/src/services/generator.ts` `accentOnLight` | `{{ACCENT_COLOR_ON_LIGHT}}`. |
| `apps/unified/web/src/site/**` (the website screens) | `templates/website-premium-*/admin/src/**` (identical in all eleven) | Pages, page editor with live preview, photos, blog, portfolio (was "projects"), website settings, the overview with visits. One list screen and one editor serve the blog and the portfolio (the site had a copy each); one "new item" dialog for all three. `confirm()` is the shared in-app dialog; every colour has its dark pair (measured, both themes). Not moved, replaced by the shared screens: sign-in, forgot/reset password, account, users, billing, email, audit, leads. Not moved yet: bookings (2d), the domain page (Factory step), email verification (see below). |
| `apps/unified/web/src/index.css`, `web/tailwind.config.ts` | `templates/crm/frontend/src/index.css` + crm-restaurant's white-surface and page-title rules; `templates/crm*/frontend/tailwind.config.js` | The brand colour is CSS variables set from the company at runtime, not baked in at build. The white-surface rule is written `[class~="bg-white"]` — see the last section. |

## Website pieces that arrive in later steps (not lost)

- Bookings (`/book`, `/booking/:token`, the iCal feed, calendar sync, deposits): step 2d, on the one booking engine.
- The website admin and its API, photo uploads and the `/media/*` proxy: step 2c (done). `/customize/:token`: not yet.
- The dispensary's live menu and pickup orders (`/menu`, `/api/order`): with the dispensary add-on (it is the CRM's own menu now).
- The roofer's instant estimator (`/estimate`): with the roofing add-on.
- A/B experiments (`scripts/ab.js`): with the CRM's ads module (step 3); until then the script isn't loaded.
- The bar and food-truck designs and their own sections (taps, tonight board, menu, hours, live map…): with their add-ons.
- The Factory's internal site endpoints (`sync-settings`, `seed-photos`, `site-bootstrap`): with the Factory step.
- Found while moving: field service sites offer the financing calculator but never had its styles (it rendered unstyled) and its default heading is "Roof financing". The styles now ship with the section for every design; the heading default is still roofing's and needs a neutral one when the composer moves.

## Held by the fence; fix when the code moves in

- **205 type errors in `packages/tenant-backend`** (never type-checked; the
  templates vendor it as source). `scripts/check-unified-types.ts` holds the count
  at 205 and fails if it rises. The largest: `inventory/inventory.ts` (47),
  `warranties/warranties.ts` (29), `contacts/contacts.ts` (15),
  `invoicing/invoices.ts` (13).
- **Shared modules that reply outside the rulebook's shapes.** The shared package's
  errors are all `{ error }` already. 22 of its replies send a bare list
  (`c.json(rows)` and the like) instead of `{ data, pagination }`. Each is conformed
  when its module is mounted in the unified app, together with the screen that reads
  it.

## Step 2c (server side)

- Website admin API (`apps/unified/server/site/admin.ts`, `/api/site`) moved from
  `templates/website-premium-*/routes/admin.ts`: pages, section types, the website's
  settings, photos, blog, portfolio, analytics. Every action now checks a permission
  (`site:read` / `site:update` / `site:delete` / `site:settings`, added to the shared
  matrix: admin `site:*`, manager content only). The company's own facts are edited
  only in company settings. Not yet moved: the customize link (with the admin
  screens), bookings (2d), domain buy/attach, CRM hand-off (gone: one app).
- `/media/*` serves only the public `photos/` prefix (the site's served any key; the
  one app's store also holds private CRM files).
- The site's own sign-in (cookie sessions table, email verification, TOTP on the
  user) is replaced by the shared sign-in with httpOnly cookie sessions (opt-in,
  `X-Auth-Mode: cookie`). Not carried over: the site's list of active sessions and
  "sign out everywhere" by session (shared sign-out revokes per device or all), and
  email-address verification. Decide whether the one app needs them.
- Feature catalogue is keyed by the CRM template name (`vertical.featureSet`); re-key
  it by vertical when the CRMs move in.

## Step 2c (admin screens)

- One React app (`apps/unified/web`, built to `web/dist`) served by the server at the
  sign-in paths and `/crm/*`, its files at `/crm-assets/*` (`server/http/adminScreens.ts`,
  a registry mount of its own kind, before the website). **The Factory's Render build
  command must run `bun run build:web`**; without the build the admin answers 503 and
  says so.
- The shared client takes its session mode from the build (`VITE_AUTH_MODE=cookie`), so
  the shared screens that import the app-wide `api` work unchanged.
- Shared screens the admin imports are listed in `web/src/shared.ts` (not the package
  index, which pulls every CRM module and its third-party libraries).
- Two optional calls answer 404 until their modules arrive in step 3, and the screens
  leave the part out: Settings › Features asks `/api/integrations/status` (the "needs a
  connection" note), Billing asks `/api/messaging-billing/status` (the texting wallet).
- The header search box and the live-updates dot are off (`ShellConfig.search`, no
  `connected`): no search endpoint or socket yet (step 3).
- Lead Inbox: the server now refuses it with `lead_inbox` off, as the menu hides it
  (the templates gated only the menu). Switching a feature on in Settings now clears the
  server's feature cache at once (it waited up to 15 s).
- The site designs are the seven distinct looks: `classic` (the contractor, RV and vet
  templates all served the base alone) plus the six with their own stylesheet.
- The editor's live preview is not counted as a visit (a same-origin frame).
- **Found in the live templates, not fixed (fenced):** crm-restaurant and crm-rv write the
  white-surface rule as `.bg-white:not([class*="dark:bg-"])`, and their `.card` does
  `@apply bg-white` — Tailwind copies the rule onto `.card`, pinning gray-900 text on
  every dark-mode card (measured 1.01:1 in the unified build before the fix). No live
  customer runs either template.
