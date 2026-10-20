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

- Bookings: step 2d — the engine, the owner's API, the public pages and messages are moved (section below); card deposits, Google/Outlook calendar sync, texts and the embed script are not yet.
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

## Step 2d (one booking engine)

| Unified app | Original | Notes |
|---|---|---|
| `apps/unified/server/db/schema/booking.ts` | `templates/website-premium-*/db/schema.ts` booking tables; `templates/crm*/backend/db/schema.ts` `booking_settings`, `bookable_service`, `online_booking` | The site's model (per-person hours with several windows, days off, buffers, ZIP zones, series, waitlist, bans, webhooks) with the CRMs' per-company time zone, notice, window and pending-deposit status. Money numeric dollars like the CRM. The booking links its contact; a job will be made from it (SPEC §4.7). |
| `apps/unified/server/booking/slots.ts`, `recurrence.ts` | `website-premium-*/lib/booking-slots.ts`, `lib/booking-recurrence.ts` | Pure, tested under three server zones. Fixed: deposit holds block, a class yields to other bookings, a booking keeps its own clean-up, visits keep local time across clock changes. |
| `apps/unified/server/booking/engine.ts` | `packages/tenant-backend/src/booking/service.ts` (+ the site's create/reschedule/cancel in `server-static.ts`) | One loader for the slot list, the booking check and the reschedule (the site's three disagreed). A deposit that can't be taken leaves the booking confirmed (the CRMs' engine left it pending and its own expiry cancelled it). A banned address is refused plainly (the site faked a success). |
| `apps/unified/server/booking/{extras,emails,happenings,webhooks,pages}.ts`, `modules/booking.ts`, `site/public/scripts/book-flow.ts` | the site's admin booking routes, `lib/email.ts`, `lib/webhooks.ts`, the `/book`, `/booking` pages and `build/scripts/book-flow.js`; the CRMs' `/api/booking` routes and `booking-widget.js` | Every change goes through one listener (messages, webhooks, waitlist): a customer's own cancel now tells the waitlist and a customer's reschedule now fires its webhook. Webhook addresses must be public https (`core/outboundUrl.ts`). Pages reached by the private token, not the id. Days from the server. The reschedule page runs (the site's script stopped on it). New: "your booking has a new time" and cancellation emails. |

| `apps/unified/web/src/booking/**` (the owner's booking screens) | `templates/website-premium-*/admin/src/pages/Booking*.tsx`, `components/BookingOnboarding.tsx`; `packages/tenant-ui/src/booking/BookingsPage.tsx`, `BookingSettingsTab.tsx` | The book, one booking, the calendar (drag to move, checked), settings (switches, services, hours per person, days off, areas, wording, feed, webhooks, bans), waitlist, insights (numbers + customers), a repeating booking. Every date and time on the business's clock — the site's screens used the viewer's. Staff see who a booking is with without reading the team list. Measured in a browser: both themes, phone and desktop, owner / manager / staff. |

**Still to come, not lost:**
- **Card deposits** need the CRM's payments (Stripe Connect): `createBookingEngine({ deposits })` is the seam. Until then a service's deposit is stored and not charged.
- **Google / Outlook calendar sync** (busy times and pushing bookings to people's calendars): `externalBusy` is the seam; the OAuth is the Factory's. Tokens go in `calendar_connection`, encrypted.
- **Texts** (confirmation, reminder, review request) with the CRM's messaging; email only until then.
- **The embed** (`book-embed.js`, the CRMs' `booking-widget.js`).
- **The Factory** must call `POST /api/internal/booking-jobs` hourly (reminders, rebook, review requests) and switch on `online_booking` for website tenants that take bookings. Its old per-site cron endpoints (`booking-reminders`, `booking-rebook-reminders`, `booking-review-requests`) go.
- **The website's security policy** allows inline scripts (`http/guards.ts` SITE_CSP), as the live sites do; moving the layout's and sections' inline scripts to nonces is a later hardening.

**Found in the live templates while moving, not fixed (fenced):**
- The premium sites' policy (`server-static.ts` pagePolicy / `lib/security.ts`) doesn't list Google Tag Manager, Analytics, Ads, the Facebook pixel or Clarity, so the tracking IDs owners paste into Settings print a snippet that can't load.
- The premium sites' reschedule page never worked: `book-flow.js` sets a field only the new-booking form has, and stops.
- The premium sites show a booking's email and address at `/book/thanks?id=<id>`.
- The CRMs' engine cancels a booking 30 minutes after a deposit fails to start (status left `pending`, then expired).

## Step 3 (the CRM layer)

| Unified app | Original | Notes |
|---|---|---|
| `apps/unified/server/db/schema/{crm,construction,field,marketing,account}.ts`, migration `0004_crm` | `templates/crm/backend/db/schema.ts`, every table not already moved (135) | Column for column and index for index (checked by script against the original). Four differences, each for the rulebook or the spec: `job.booking_id` added (SPEC §4.7, a job made from a booking); `ai_receptionist_settings` gets the standard `id` with `company_id` unique (RULEBOOK §5; a moved row is given an id); the three `ads_experiment*` tables' timestamps lose their zone (RULEBOOK §2; the moved values convert as UTC); the commission partial-index conditions live in `server/data/indexWhere.ts` (RULEBOOK §2). The CRM's `booking_settings`, `bookable_service` and `online_booking` are replaced by the bookings layer. The drizzle `relations()` blocks are not moved: no code reads them (no `db.query.*`). |
| `apps/unified/server/crm/messages.ts` | `templates/crm/backend/src/services/email.ts` templates (all but passwordReset/teamInvite, already in `core/email.ts`) and its named senders | Company name and colour from the sending company, not build placeholders. `raw` (an inbox reply) is a registered message instead of being patched onto the template table at import. |
| `apps/unified/server/crm/pdf.ts` | `templates/crm/backend/src/services/pdf.ts` | Unchanged. |
| `apps/unified/server/crm/services.ts` | `templates/crm/backend/src/services/{sms,stripe,reviews,marketing,recurring,agreements,inventory,quickbooks,fleet,warranties,commissionEarner,bulk,fileUpload,jobHooks,messagingUsage}.ts`, the `createEmailLogger` call in `index.ts` | Each shared service built once; the timed jobs start from `server/index.ts` (not in tests). |
| `apps/unified/server/core/sanitize.ts` | `templates/crm*/backend/src/utils/sanitize.ts` | Unchanged. |
| `apps/unified/server/core/realtime.ts` | `templates/crm*/backend/src/services/socket.ts` (events and `emitToCompany`) | The socket.io transport is not wired: Bun.serve has no Node server for it to attach to. The only listeners were the lead inbox and the "connected" dot; both read on load until a transport is chosen. |
| `apps/unified/server/modules/crm.ts` | `templates/crm/backend/src/routes/{contacts,jobs,quotes,invoices,team,dashboard,time,expenses,tasks,photos,recurring,tech,commissions,locations,equipment,inventory,fleet,warranties,agreements,documents,reporting,pricebook,ads,adsPublic,onboarding,messagingBilling,emailDomain,gbp,inboundParse,inboundMessages,sms,stripe,marketing,quickbooks,reviews,integrations}.ts` and their gates in `index.ts` | Every gate through the registry. New: the core CRM (contacts, jobs, quotes, invoices, team, dashboard) is behind its own feature, so a website-only business has none of it at the server. |

**Not moved, because one app makes them unnecessary:** the CRMs' `/api/booking` (the bookings layer), `/api/bookings/external` (the website's bookings were fetched from the site), `/auth/handoff` and `/api/internal/seed-from-premium` (site and CRM sign-in were separate), `/api/internal/send-sms` (the website asked the CRM to text).
| `apps/unified/server/crm/siteRecords/*` | `templates/crm/backend/src/routes/{rfis,submittals,dailyLogs,punchLists,inspections,changeOrders}.ts` | Through the registry with the template's gates. Refusals keep sentence and code; extra fields dropped (RULEBOOK §3). New: RFIs, daily logs, punch lists and inspections check their read permission. |
| `apps/unified/server/crm/projects/*`, `server/data/{projects,purchaseOrders,bills}.ts` | `routes/{projects,ganttCharts,bids,purchaseOrders,bills,lienWaivers,drawSchedules,aiaForms}.ts` | `/api/projects/:id/activity` is a list reply. The over-billing refusal states the figures and the way on in its sentence. |
| `apps/unified/server/crm/field/*`, `server/data/{takeoffs,selections,jobCosting}.ts` | `routes/{takeoffs,selections,jobCosting,routing,maps,geofencing,weather,payroll}.ts`, `services/{takeoffs,selections,jobCosting,routing,geocoding,geofencing,weather}.ts` | Payroll is gated on `time_tracking` (its only screen is the Time page). Several bare-array lists became list replies. The geocoder's User-Agent reads the company row (was a build placeholder). |
| `apps/unified/server/crm/comms/*`, `server/data/{calltracking,aiReceptionist,comments,support}.ts` | `routes/{calltracking,aiReceptionist,comments,search,support,platformSupport}.ts`, `services/{calltracking,aiReceptionist,comments,search}.ts` | Call tracking and the AI receptionist are public mounts that sign people in after their signed webhooks. Comments reply in camelCase. Raw inserts use the standard id. Search needs each record's own feature and links under /crm. |
| `apps/unified/server/crm/office/*`, `server/data/{export,pricebookPresent}.ts` | `routes/{export,import,bulk,migration,wisetack,financing,vendorPortal,pricebookPresent}.ts`, `services/{export,import,migration,wisetack,financing}.ts`, `utils/upload.ts` | Exports need the permission of their own list page; the audit-log export needs audit:read. |
| (not moved) | `templates/crm/backend/src/routes/webhooks.ts` (`POST /api/webhooks/leads`) | The website is the same app; its enquiry goes straight into the CRM (`core/enquiry.ts`). |
| `apps/unified/web/src/crm/screens.tsx`, `crm/vertical.ts`; `VerticalSettings.screens` | `templates/crm/frontend/src/pages/*` wrappers, `components/detail/*` wrappers, `*Config.ts`, `shellConfig.ts`, `App.tsx` routes | One wrapper file; each vertical's screen settings in its settings.ts, written into the page. The CRM's menu needs its features, so a website-only business sees none of it. |
| `apps/unified/web/src/crm/pages/*`, `crm/ui/*`, `crm/date.ts`, `crm/useDebounce.ts` | `templates/crm/frontend/src/pages/*` (template-only pages), `components/ui/*`, `components/common/*`, `components/detail/ProjectDetailPage.tsx`, `components/features/AIReceptionistPage.tsx`, `utils/date.ts`, `hooks/useDebounce.ts` | Browser alert/confirm/prompt became the app's toasts and dialogs. The onboarding gate covers only the CRM pages and only owners/admins. The draw-request form now sends the fields the API takes. |
| `tests/unified/harness/*`, `tests/unified/crm/*` | — | The base CRM suite runs unchanged against the unified app (CI). Divergences are registered with where each behaviour is held. |

**Step 3 — still to come, not lost:**
- **Live updates** (`core/realtime.ts`): events are emitted; no transport yet (Bun.serve has no socket.io server). The lead inbox and the "connected" dot read on load.
- **Near-copy verticals** (bar, basic, fieldservice, landscaping, restaurant, rv, salon, vet): each as settings + add-ons, each suite on the unified app.

**Found in the live templates while moving, not fixed (fenced):** the pricebook presenter 500s on every item (missing imports); import drops email addresses containing "s" before the @ (lost backslashes); export date/contact filters 500 on joined exports; the vendor invite email is never sent (calls a method that doesn't exist); migrated invoices lose their tax (`tax:` column doesn't exist); Wisetack financing sends the wrong field names; any role can export invoices, quotes, team pay and the audit log (dashboard:read); RFI/daily-log/punch-list/inspection reads check no permission; the draw-request form sends field names the API refuses; Help's "Show as FAQ" never saves; search Recent links have no /crm prefix. Fixed in shared code on this branch (so the templates get it at merge): a missing vehicle/agreement/warranty answered 500; "Stripe not configured" answered 500; empty SMS-template and warranty-from-template saves answered 500; a settings save stored display-only keys.

## Step 3e (the near-copy CRMs)

| Unified app | Original | Notes |
|---|---|---|
| `apps/unified/server/db/schema/{trades,landscaping,appointments,salon,vet,rv,events,bar,loyalty}.ts`, the added columns in `{core,crm,field}.ts`, migration `0006_verticals` | `templates/crm-{basic,fieldservice,landscaping,bar,restaurant,rv,salon,vet}/backend/db/schema.ts`, every table and column the base CRM lacks (65 tables, 25 columns) | Column for column; where CRMs share a table (appointment: salon + vet; event*: bar + restaurant; loyalty_*: bar + salon; site and the trades tables: basic, field service, landscaping, bar) the union, each column the one definition they share (checked: none required in one and absent in another). Decided: `job.job_type` defaults to 'service' (basic, bar) in the database; field service and landscaping's 'repair' is their vertical's default when a job is made. Their old booking tables are replaced by the bookings layer. |
| `apps/unified/verticals/fieldservice/settings.ts`; `CrmSettings` in `server/core/vertical.ts`, read by `server/modules/crm.ts` and `server/crm/services.ts` | `templates/crm-fieldservice/backend/src/routes/{contacts,jobs,quotes,equipment,tech,agreements,documents,portal,mfa,auth}.ts`, `services/jobHooks.ts`, `middleware/permissions.ts`, the 6-hourly agreement scan in `index.ts`, `frontend/src/*Config.ts` | Each difference from the base copy is a switch the engine reads (service sites, job photos, billing a job, arrival texts, quote texts, recurring agreements, checklist, portal sections), never code in the vertical. Taken for every vertical (fixes one copy had): pay periods on the shop's days (payroll), a quote's declined/converted-to-job, revenue and commission through invoice.job_id, the pricebook-trial page not gated behind pricebook. Gates as the field-service copy had them, for everyone: documents on `documents`, geofencing on `gps_tracking`, agreements on service_agreements or maintenance_contracts, inventory on inventory or parts_tracking — cutover switches `documents` on for every CRM business (the base CRM never gated it). Stale in the copy, not taken: projects.ts (the base's money-visibility fixes are newer). |
| `apps/unified/verticals/vet/settings.ts`; `server/crm/vet/{patients,appointments,visits,vaccinations,prescriptions,labResults,wellnessPlans,wellnessBillingService,reminders,dashboard,species,drugClasses}.ts`; `server/data/vet{Appointments,Visits,Reminders,Dashboard}.ts`; `web/src/crm/pages/vet/*`; CrmSettings `patients`, `dashboard: 'practice'`, `appointments: 'practice'`, `support.assistant`; VerticalSettings `roleMapping` | `templates/crm-vet/backend/src/routes/{patients,appointments,visits,vaccinations,prescriptions,labResults,wellnessPlans,reminders,dashboard,contacts,documents,invoices,portal,leads,search,support,mfa,auth}.ts`, `services/{wellnessBilling,search,import}.ts`, `config/{species,drugClasses}.ts`, `middleware/permissions.ts`, `frontend/src/pages/vet/*`, `components/vet/*`, `lib/{staff,appointmentTypes,printable}.ts`, `frontend/src/*Config.ts` | The vet's own modules, each behind its screen's menu gate (the template mounted all eight ungated). Shared modules switched by settings: an owner's patients on contacts (and the delete guard), patient links on documents and invoices, the portal's Pets, the practice dashboard, the practice book on /api/appointments and /api/reminders (the salon's otherwise). Taken for every vertical: patient search (gated by patient_records), CSV formula-safe contact import (R2-06). Tasks on `projects` or `patient_records` (the vet had it ungated). Replies in the rulebook's shapes: list reads became `{ data, pagination }`; refusals lost their extra fields (`conflict`, `allergy`/`acknowledgeWith`, `invoiceId`/`total`, `vaccine`) and gained codes. Not carried: online booking making a patient chart and an appointment row (the bookings layer replaces it), `DELETE /api/support/tickets/:id` (no screen calls it), the customer-landing `CustomerPortal.tsx` (the unified '/' is the website). |
| `apps/unified/verticals/basic/settings.ts`; CrmSettings `fleet.gps`, `leads.platforms`; VerticalSettings `booking.requireAddress`; screens `onboarding` | `templates/crm-basic/backend/src/routes/{documents,jobs,quotes,leads,booking,mfa}.ts`, `services/{fleet,aiUsage}.ts`, `frontend/src/*Config.ts`, `pages/OnboardingWizard.tsx`, `pages/CommissionsPage.tsx` | Basic is field service without tech.ts: settings only, no modules or screens of its own. Taken for every vertical: AI support usage reported to the Factory wallet; job photos behind `photo_capture` on both sides. |
| `apps/unified/verticals/landscaping/settings.ts`; `server/crm/landscaping/{recurringRoutes,areaPricing,snowBilling,sites,inUse}.ts`; `web/src/crm/pages/landscaping/*` | `templates/crm-landscaping/backend/src/routes/{recurringRoutes,areaPricing,snowBilling,sites}.ts`, `frontend/src/pages/landscaping/*`, `*Config.ts` | Each module behind its feature (`/api/sites` on any of the three; the template left it open). Fixed in the move: a stop could name another company's property; a property, or a customer, with route stops or snow contracts was deleted with them (now refused through every door, `inUse.ts`); rate changes and deletes were not audited; a stop was removed from any route; every job was stored as a 'repair' (T58). |
| `apps/unified/verticals/restaurant/settings.ts`; `server/crm/restaurant/{events,eventSpaces,menuPackages,eventsDashboard,eventBooking,eventLedger,eventImport,eventImportColumns}.ts`; `server/data/restaurantEvents.ts`; `web/src/crm/pages/restaurant/*`; CrmSettings `events`, `dashboard: 'events'` | `templates/crm-restaurant/backend/src/routes/{events,eventSpaces,menuPackages,dashboard}.ts`, `services/{eventBooking,eventLedger,import}.ts`, the venue import, `frontend/src/pages/restaurant/*` | Mounted once and serving the bar too (the bar's copies were byte-identical). Gated on `event_bookings` / `event_spaces` / `catering_menus` on both sides (the template left them open). Refusals carry codes (`space_held`, `name_taken`, `in_use`) instead of ids. |
| `apps/unified/verticals/bar/settings.ts`; `server/crm/bar/*`; `server/data/bar.ts`; `web/src/crm/pages/bar/*`; CrmSettings `websiteForms: 'bar'` | `templates/crm-bar/backend/src/routes/bar*.ts`, `services/bar*.ts`, `routes/webhooks.ts` (the party and Regulars forms), `frontend/src/pages/bar/*` | Register, grill, stock, schedule, gift cards and Regulars each behind its feature. A manager's OK is `code: 'NEEDS_MANAGER'`. The website's two forms answer through the site's own enquiry (`crm/bar/enquiry.ts`). Fixed in the move: an empty special or game edit answered 500. |
| `apps/unified/verticals/rv/settings.ts`; `server/crm/rv/*`; `server/data/rvDealership.ts`; `web/src/crm/pages/rv/*`, `crm/verticals/rv.tsx` | `templates/crm-rv/backend/src/routes/{units,salesLeads,repairOrders,alerts,rentals,accounting,fi,titleReg,floorplan,laborGuide,oemParts,partsOrders,recalls,syndication,scheduleEvents,aiLeads,aiReports,aiTrade,valuation,dashboard,webhooks}.ts`, `services/{deal,leadContact,aiReportTotals,valuation}.ts`, `index.ts` seed-units, `frontend/src/pages/rv/*`, `lib/deal.ts`, `*Config.ts` | Every mount behind the dealership's features (the template left all open). Fixed in the move: the AI, valuation, schedule and dashboard routes asked no permission (now each asks the one of what it shows or spends, menu and API alike); rentals and AI reports leaked revenue and cost to seats without `invoices:read` / `margin:read`. The shared registry now offers crm-rv `jobs`, `quotes`, `invoices` and `scheduling`, which its menu always showed. Not moved: the RV lender adapters (unconfirmed stubs, no caller). |
| `apps/unified/verticals/salon/settings.ts`; `server/crm/salon/*`; `server/data/{salon,salonLoyalty}.ts`; `web/src/crm/pages/salon/*`; migration `0009_salon_visit_once` | `templates/crm-salon/backend/src/routes/{clients,serviceMenu,serviceRecords,memberships,appointments,reminders,loyalty,dashboard}.ts`, `services/{salonDate,clientTypes,stylist,checkout,formulas,loyaltyAward,membershipBilling,rebookingDue,appointmentReminders,reviewSubject}.ts`, `frontend/src/pages/salon/*`, `*Config.ts` | Each module behind its screen's feature. The salon's two database guards (one bill per visit; one points award per visit) are in the schema for every vertical. Taken for every vertical: a support ticket needs a subject; review requests are counted; an untyped CSV row takes the caller's type. |
| migration `0008_invoice_number_live` | `templates/crm-vet/backend/db/migrations/{0029,0034}*.sql` (the index; the heal of old duplicates is a cutover data step) | No two live invoices share a number, for every vertical (the vet's T41 race shared numbers twice). |

## The Factory's side (alongside steps 2–5)

New, in `apps/api/src/unified/` (RULEBOOK §10, owner's yes 2026-10-18). Nothing live imports it; at cutover the Factory's signup, Update Code and teardown routes call it for unified tenants, and the template pipeline below is deleted with the templates.

| Unified | Replaces at cutover | Notes |
|---|---|---|
| `apps/api/src/unified/hosts.ts` (`createDatabase`, `findDatabase`, `databaseUrl`, `deleteDatabase`), `build.ts` step 2 | `services/deploy.ts` `createRenderDatabase`, `getDatabaseConnectionInfo` | Every tenant its own Render Postgres server, `<slug>-app-db`, at today's plan (`UNIFIED_DB_PLAN`, default basic_256mb) and disk, closed to every outside address (`ipAllowList: []`). Ownership as for services: recorded ids only; a server with the name that is not recorded stops the build. The build waits for it to be available before anything connects. |
| `apps/api/src/unified/tree.ts` | `services/generator.ts` `generate`, `copyTemplate`, `vendorSharedCode`, `injectTokens` and the `seed.template.ts` tokens | The repo is the unified app and the two shared packages exactly as tested, with the monorepo's lockfile cut to them (installed `--frozen-lockfile`). Nothing about the business is written into code: no free text in source, no password hash in a repo. `apps/unified/VERSION` names the engine commit. |
| `apps/api/src/unified/hosts.ts` | `services/deploy.ts` `createGitHubRepo`, `getGitHubRepo`, `findRenderByName`, `createRenderWebService`, `updateRenderEnvVars`, `updateRenderServiceSettings` | One service, rootDir `apps/unified`, health check `/health`. Bun pinned to the version CI tests (`UNIFIED_BUN_VERSION`, default 1.3.14) — the templates install whatever Bun is newest at build time. |
| `apps/api/src/unified/build.ts` | `services/deploy.ts` `deployCustomer`, `preflightDeploy` | Every name judged against the tenant's records before anything is made. Live means `/health` answers with the pushed commit (not Render's "live"). Then `POST /api/internal/provision`. Secrets are made once and kept on a rebuild. The integration settings (Twilio, email, Maps, Stripe Connect, QuickBooks) are passed in: at cutover the block that builds them inside `deployCustomer` becomes one exported function both use, then the old caller goes. |
| `apps/api/src/unified/update.ts` | `services/deploy.ts` `updateCustomerCode`, `checkUpdateOwnership` | Same push for every tenant; one at a time, stopping at the first failure; waits for the pushed commit to answer. |
| `apps/api/src/unified/teardown.ts` | the template paths in `services/testCleanup.ts` | Removes the tenant's service, repo and its own database server — each only when recorded as the tenant's; anything else is left and reported. |
| `apps/unified/server/modules/provision.ts`, `server/core/starter.ts` | `templates/crm*/backend/db/seed.template.ts` | Written once, in one transaction, by the Factory's call; the seed ran on every boot. Starter content only: the sample customers, pets, units, events and invoices are not carried (a real business's books start empty), nor `settings.jobStatuses` (written, never read). |

**To decide or do at cutover:**
- `services/resourceOwnership.ts` records the unified database server's id (`record.databaseId`) like a template tenant's.
- `externalNamesForSlug` / `slugIsFree` learn the `-app` names (`names.ts`).
- **The vertical id the build passes (`build.ts` `VERTICAL`) is the unified app's, not the Factory's** (found 2026-10-19): `config/industryRouting.ts` `verticalFor` answers `veterinary`, `events`, `roofing`, `showcase`, `foodtruck`, `contractor`…, while `loadVertical` knows `vet`, `restaurant`, `roofing`, `basic`, `contractor`… — and production refuses to start on an id it doesn't know. One map, Factory vertical → unified id (named after the CRM template, as `crmTemplateFor` already does), used by the signup's build call; every Factory vertical either maps or is refused at signup, never at boot.
- `services/tenantBackup.ts` lists the account's databases once (`/postgres?limit=100`) and never pages: past 100 databases on the account, tenants beyond them are silently not backed up. With a database server per tenant the account passes 100. Paged before cutover (live code; not touched from this branch).

**Found in the live templates, not fixed (fenced):** the RV seed gives every new dealership three sign-in accounts (`*.demo@dealer.test`) with one password written in the code, plus sample customers, units and invoices; salon, vet and restaurant seed sample clients and records into a real business's books.

## Behaviour to build before a vertical's customers move (found merging the near-copies)

Each is something a live template does that the unified app does not do yet. Not divergences: nothing holds them.

- **Bar — Amber Inn's website forms: the behaviour is built** (`crm/bar/enquiry.ts`, `CrmSettings.websiteForms 'bar'`, held by `apps/unified/tests/bar-website-forms.test.ts`). Still to build with the bar's site design: the two forms on the page (the party request and the Regulars sign-up) posting `formType` to `/api/leads`.
- **Vet — online booking.** The vet's booking made the pet's chart and an appointment row (`appointmentCalendar`, `requirePet`). The unified booking engine makes neither. `modules/booking.ts` still decides the vet's answers by its id.
- **RV — the chat's enquiry.** The unified enquiry form needs an email and does not take `unitOfInterest`, so a phone-only lead and the link from a stock number to its unit are lost.
- **Live updates.** The bar's register, grill and floor refresh on a timer (10–15 s) where the template pushed changes at once; the RV's alert to one salesperson is emitted but reaches no browser. Both wait for the live-updates transport (`core/realtime.ts`).

## Home care (step 6, routes)

`templates/crm-homecare/backend/src/routes/*` moved into nine folders under `apps/unified/server/crm/homecare/` (clients, scheduling, planning, visits, billing, payroll, hr, portals, office), each with its raw SQL in `server/data/homecare*.ts`, mounted only for the home-care vertical (`CrmSettings.homecare`). Every route asks a permission (`care-*`, `my-pay`, `evv`; `packages/tenant-backend/src/auth/permissions.ts`), never a rank; a caregiver is narrowed to their own clients and shifts as the template did. Lists are `{ data, pagination }`, rows camelCase. Each group's report, with its route → file table, is the source for these rows; the tests that hold them are `apps/unified/tests/homecare-*.test.ts`, and the home-care suite runs on the unified app (adapted copies in `tests/unified/homecare/`).

| Unified | Replaces | Notes |
|---|---|---|
| `server/crm/homecare/{clients,scheduling,planning,visits,billing,payroll,hr,portals,office}/*`, `server/data/homecare*.ts` | `templates/crm-homecare/backend/src/routes/*` (106 files) | Paths kept. Where a unified mount shared the path (/api/dashboard, /api/reports, /api/documents, /api/expenses, /api/payroll, /api/stripe, /api/billing, /api/portal, /api/sms, /api/clients, /api/alerts) the home-care vertical takes its own: a switch or a skipped mount, never two. |
| `server/crm/homecare/core/disqualifiers.ts` | `0018_staff.sql`'s seeded `caregiver_disqualifiers` rows | The Wisconsin bar list is code: a new agency's table was empty, so a disqualifying record read as review. The table stays unread. |
| migration `0010_homecare_guards` | the template's `0015`–`0017` sequence and partial indexes | One open visit per caregiver; one active recurring pattern; the invoice number sequence; five partial indexes. 0007 had left them out. |
| `packages/tenant-backend/src/company/seats.ts` | the seat check inside `company.ts` | One seat rule for every login made: the team screen, a caregiver, a hire, an office admin. |
| `CrmSettings.callers: 'clients'` (call tracking, AI receptionist) | home care's own `services/{calltracking,aiReceptionist}.ts` | A switch on the shared services, not a copy. |
| (not moved) | `routes/{saasBilling,webhooks,help,failsafe}.ts` | Replaced by /api/billing, the site's enquiry, /api/support; failsafe was a stub. |

**Home care's screens (step 4, 2026-10-19):** `templates/crm-homecare/frontend/src` → `apps/unified/web/src/crm/pages/homecare/{clients,schedule,shifts,visits,billing,people,portals,office}` and `lib/` (`docs/UNIFIED_HOMECARE_SCREENS.md`): one menu item per section of the template's office (`crm/verticals/homecare.tsx` MENU), the caregiver's app at `/crm/dashboard` for whoever doesn't run the schedule, the public pages (portals, invoice payment, onboarding, careers) served only for home care (`server/http/adminScreens.ts` HOMECARE_PAGES). Light and dark (`lib/homecare.css` tokens; the template was light-only). Not moved, as the shared app's: lead inbox and sources, paid ads, Contact Twomiah, branded email, Google reviews, the email domain and inbox, the AI receptionist, two-factor, plan & billing, sign-in, the shell. Not moved, dead in the template: `ClientModal`, `CaregiverAvailability`, `AbsenceManagement`, `AutoFillButton`, `ScheduleCalendar`, `OpenShifts`, `ShiftSwaps`, `MileageTracker`, `OfflineBanner`, `useOfflineSync`. `PerformanceReviewsPage` (it could never save) → `/crm/performance`.

**Controls the template showed that never worked, made to work (each held by a homecare-*.test.ts):** a recurring schedule's End Date; time off of every kind the payroll screen offers (personal, bereavement, jury duty, unpaid were refused); Remove on a caregiver's care-type rate; a no-show alert closed as a false alarm; the expense form's vendor, payment method and flags and the service-code form's revenue code, prior-authorization flag and notes (migration `0011_homecare_form_fields`); deleting a texting template (it fell through to the CRM's router and answered success); a blank low-units threshold (500); an emergency contact with no phone (500); the Users screen listing managers; the Billing page's totals over every invoice (it summed the first 200; `GET /api/billing/invoices/totals`); the ADL, medication and vitals filters and every "today" stamp on the agency's clock (`apps/unified/tests/homecare-agency-day.test.ts` holds the rule).

**Owner's yes to the recommendations (2026-10-19):** the caregiver Full Profile's overview is built (`GET /api/caregivers/:id/summary`: hours this month, week and ever, clients served, recent visits, the schedule from today on, and — to the person or the payroll only — this month's approved pay from payroll's own rule and the base-rate history; its visit history's From / To now filter, on the agency's days); the No-Show log page that read a route no server had is retired (`/crm/no-show` opens No-Show Alerts); the Smart Matching screen's controls that did nothing are gone (the Client Needs tab, the optimizer's week, mode and options, Apply All, and the no-op `POST /api/matching/{capabilities,apply-schedule}` routes). Client onboarding stays the working checklist. **Left off by the owner for now (2026-10-19):** paying by care type (the Gusto CSV carries one rate per person, and mixed rates in a week change how overtime is figured — care-type rates stay a record payroll does not read), and importing from CareSmartz360 / HHAeXchange.

**View As (2026-10-19):** the office opens the app as a member of staff, or a client's portal, from the header (`users:read` / `care-portal:update`). The View As session is its own httpOnly cookie (`tw_view_as`, `packages/tenant-backend/src/auth/cookieSession.ts`), so no script on the page ever holds it; the office's own session stays beneath it and Exit (`POST /api/auth/logout` inside a View As) drops only the View As. A stale View As cookie is cleared and the office carries on. A strip under the header on every page says whose app it is. The portal preview runs the client portal on its read-only token in memory, never stored. Measured in a browser (both themes, 1440 and 390).

**Screens asked for pages the server refuses (found in the browser, 2026-10-19):** 22 home-care calls asked `?limit=1000`, over the server's 500 cap (`server/http/guards.ts`), so the scheduler's, the Schedule Hub's, the billing screens' and other pickers came up empty. Each now walks the pages (`lib/http.ts listAll`); `apps/unified/tests/web-page-limit.test.ts` holds every screen to the cap.

**Home care's guides (2026-10-19):** a new agency's Help holds 25 home-care guides (`verticals/homecare/settings.ts` HOMECARE_STARTER): the template's 24 built-in articles rewritten against the moved screens, every claim checked in the code (the old text named "Deactivate", "Reveal SSN", "Submit WORCS Check", a 32/37-hour badge rule that is 25/35, an Operations › Referrals page). `apps/unified/tests/homecare-guides.test.ts` holds every "Section › Item" they name to the menu. The help assistant is told it serves a home-care agency (it was "a business management CRM" with the contractor's articles). Every vertical had been given the contractor CRM's starter articles; each template seeded its own — the other verticals' are next.

**Found by checking the guides against the code, and fixed (2026-10-19):** the dashboard's Coverage Gaps tile and its "Find Coverage →" were a fixed 0 (the template's too) — they count the call-outs Emergency Coverage lists; a caregiver's visit history never offered "View Route" (no GPS point count in the reply) — it carries the count and the client's address; report exports ignored the screen's caregiver and client pickers, the six GET reports were sent neither, and both pickers showed on reports that read neither — each report now offers only the filters it honours and its CSV and PDF match it (the revenue PDF summed invoices alone, the payroll CSV priced hours at its own $18 default — now payroll's rule; CSV columns titled for a spreadsheet); a satisfaction rating counted on the day it was typed in, not its own date; the payroll screen's weekend / night differentials were read by nothing and its "withholding estimate" printed flat, invented tax lines (state 7.65% was the FICA rate) on a "Pay Stub" — removed; the statement shows the earnings and says withholding is the payroll provider's; the Background Checks cards counted the filtered list and Expired / Expiring Soon did not filter — the cards count everything and filter by expiry; the Caregivers page and three pickers stopped at the list's first 50.

**The suite reads the screens that ship (2026-10-19):** every home-care adapted copy's screen and server reads point at the moved files (`tests/unified/harness/adapt.ts`; 2,248 assertions, 0 failed) — they had read `templates/crm-homecare`, so they checked code the unified app does not ship. Nothing the moved screens protect was lost. The files with no adapted copy (account-lock, session-fetch, first-sign-in-token, hire-credentials) are held by `homecare-office.test.ts` and `homecare-hr.test.ts`; the template's static requireAdmin walk is `apps/unified/tests/homecare-write-gates.test.ts`, which calls all 378 home-care write routes as a caregiver (both stored seats) and requires 403 for all but 58 named self-service routes (mutation-checked). Found and fixed on the way, in the shared sign-in (every vertical): a locked agency could open /crm/billing* (home care's visit invoicing) instead of the lock page — each app now names its own ways out (`setTrialBypassPaths`, whole path segments); the lock page now sends an unlocked company back in; sign-in says "Your session ended" after a session runs out.

**Write controls follow the server's permission (2026-10-19):** the template had two kinds of people (office, caregiver), so its screens never asked whether someone may change a thing — the office manager, who reads billing and changes none of it, was offered every billing button and got 403s. Every home-care screen now shows a write control only to whoever its route lets use it (`lib/useMay.ts`: `care-*:create / update / delete`), verified in the browser by a seat granted every home-care read and no write. Found the same way and fixed: the Sandata payer presets (they fill the payer form) asked `evv:delete`, which a billing seat need not hold — they now ask the payer form's own `care-billing:create / update`; the printed invoice's "INVOICE" title went white on the white sheet in dark mode. Migrate and Import (the contractor CRM's data importers) are off home care's Settings. The Integrations page's two imports never worked: **Import MIDAS CSV** posted to a route no server had (now `POST /api/authorizations/import-csv`: each row matched to the client by Medicaid ID, the payer the client's own, a row that can't be placed skipped with its line and reason), and the remittance upload posted to `/api/remittance/upload`, which no server had (it now reads a check or statement image through the payments check reader).

**Whose records — one rule (owner's yes, 2026-10-19):** a caregiver is the field seat (stored `field`, `caregiver` or `user`) and is always narrowed to their own shifts, pay, files and served clients, even if an owner grants them more; anyone else reaches everyone's record in an area with that area's permission for the act (`server/crm/homecare/core/caregiverAccess.ts` `actsForAnyone`). It was two rules: "the office" was a list of roles (owner, admin, manager), so a seat an owner grants read access to (a bookkeeper, an auditor) was refused every caregiver's file and shown a caregiver's home screen; and the scheduling and visits routes asked only "not a caregiver?", so the same seat, holding nothing but `care-schedule:read`, could claim an open shift in another caregiver's name, file, answer or withdraw anyone's shift swap, resolve visit change requests, and sign any client's document. A manager no longer opens caregivers' HR files (profile, certifications, background check, pay) — they hold no `care-hr`, and the Caregivers page was already off their menu; they keep the schedule side (availability, blackout dates, time off). Held by `apps/unified/tests/homecare-whose-records.test.ts` (7 of its 10 fail on the old code). The home screen draws the same line: a caregiver's day for a caregiver, the office's overview (each tile by its permission) for everyone else.

**For the owner — not changed (2026-10-19):** (1) the agency's time zone and the mileage rate are saved through the company record, which only an admin may change (a role, not a permission), so an owner can't hand those two to anyone else; (2) a report's PDF or CSV can need a different permission from the report on screen (the Overview PDF needs payroll); (3) the AI features run on older Claude models (`claude-sonnet-4-20250514` for the check reader; Haiku 4.5 and Sonnet 4.6 elsewhere) — moving up is a cost choice.

**Home care's menu gains Call Tracking** (owner's yes, 2026-10-19): agencies on the business tier paid for `call_tracking` but the template had no screen for it; the shared Call Tracking page (callers matched to clients, `CrmSettings.callers`) is on their menu.

**Not a switch-over blocker — nobody uses the phone app (owner, 2026-10-19).** Kept for whenever apps/mobile is picked up again: **the caregivers' phone app (apps/mobile, live code — not changed in this build).** It reads list replies as bare arrays (`src/care/careApi.ts` asList, 15 calls with no `data` key: the care plan, recent visits, documents, swaps, requests, notifications, open shifts, messages, mileage, coworkers…), and the unified app answers `{ data, pagination }` — so on a unified tenant every one of those lists is empty. Two screens also pick caregivers by `role === 'caregiver'`, and a new agency stores `field`. The app must read both shapes (asList taking `data`; backward-compatible with today's arrays, so it can ship first) and both seats, and its reads must be audited for camelCase fields, before the first home-care cutover.

**Cutover data steps for home care:** `login_activity` rows → `audit_log` (the compliance monitor reads the audit log); `help_articles` → `support_knowledge_base`; agency → company and users → user with company_id (decision 1); every company_id filled with the agency's id (decision 2). `incidents.incident_number` and `client_document_templates.key` are unique per database, which is one company's.

**Fixed in the move (each held by a homecare-*.test.ts):** bodies spread into rows (caregivers, profiles, background checks with a plain-text SSN, rates, service codes, ratings, the company row, communication log) could set any column including the company or permissions; a caregiver could read every colleague's training, every client's documents (with SSN and portal hash), every client's relatives' contacts, every invoice's Stripe payment, and every schedule and absence; prospect convert always failed its foreign key; the phone line billed min(actual, scheduled) and flagged nothing; office edits of visit times were unaudited; dates on UTC's day instead of the agency's (hires, rates, payments, the phone line, certification scans).

## Roofing (step 6, `docs/UNIFIED_ROOF_PLAN.md`)

Roofers use the CRM's own customers, jobs, quotes, invoices, payments and portal (owner, 2026-10-19: "do it the right way"); roofing's own parts are its add-on.

**Schema (migration `0012_roof`, additive only — no drop, rename or type change):** roofing's 16 own tables (`server/db/schema/roof.ts`, column for column); roofing's job columns on `job` (sales rep, crew, roof age / type / stories, the insurance block, revenue and cost, inspection and install dates, measurement report, squares, lost reason, closed-at), `contact.property_type`, `quote.job_id`, `job_photo.photo_type` (every other vertical's photo is `general`), roofing's imagery and AI columns on `roof_report`, `company.report_credits` / `report_price_per_report`. Re-measured by script against `templates/crm-roof/backend/db/schema.ts`: no roofing table missing; what differs is mapped below.

**Cutover data steps for roofing (each a step of the data move, not a schema difference):**
- `contact`: `name` = `first_name || ' ' || last_name`; `mobile_phone` → `mobile`; `lead_source` → `source`.
- `job`: `job_number` → `number`; `property_address` → `address`; `estimated_revenue` → `estimated_value`; `title` = the property address (the CRM's job requires one; roofing's had none).
- `quote` / `invoice`: **`tax_rate` × 100** — roofing stored the rate as a fraction (8.25% as 0.0825; `routes/quotes.ts` and `routes/invoices.ts` write `taxRate / 100`), the CRM stores the percentage; copied as it is, every roofing document's tax would read 1/100th. `quote_number` / `invoice_number` → `number`; `quote.expires_at` → `expiry_date`; each JSON `line_items` entry → a `quote_line_item` / `invoice_line_item` row in order, totals kept as stored; `invoice.balance` is not copied (the CRM derives it from total and paid).
- `job_photo.uploaded_by` → `uploaded_by_id`.
- `insurance_claim.xactimate_scope_url` / `xactimate_export_url`: `/media/insurance/<co>/<claim>/<file>` → `/api/insurance/claims/<claim>/files/<file>` (the stored objects keep their keys). The template's `/media/insurance/*` handler checked only sign-in and company, so a crew seat could read the priced scope roofing withholds from it (T63); the new route asks `invoices:read`.

| Unified | Replaces | Notes |
|---|---|---|
| `server/crm/roof/jobs.ts` | `routes/jobs.ts` | On the CRM's job table (plan decision 2); numbers by the shared `nextNumber` (the template's text MAX would repeat ROOF-10000); money by the one rule; every read asks `jobs:read` (the template's asked only for a session); photos by their bytes; lists are `{ data, pagination }` and the job list no longer carries `moneyWithheld` (the screen reads the same permissions). |
| `server/crm/roof/reports/{measurements,roofReports,roofReportService,estimator,osmFootprint}.ts`, `server/data/roofReports.ts` | `routes/{measurements,roofReports,estimator}.ts`, `settings.ts`' estimator, `index.ts`' `/api/internal/roof-reports`; the template's roof-report services | The engine is `packages/roof-core` (nothing copied). **A public shared report could serve any file on the server**: `/finalize` saved whatever `aerialImagePath` the client sent and the public `/:id/aerial.png` read it off disk — imagery now lives in the file store under the company's own keys, which also stops aerials vanishing at every deploy. A measurement credit is spent in one statement that takes it only if one is left (two orders at one credit went to −1). Stripe sent a paying roofer back to `/roof-reports`, a page that doesn't exist, so the paid report was never made — `/crm/roof-reports`. `$0.00` recorded for a hand-drawn report (the template wrote $9.99 on every one). The PDF is the print-ready page (the template's Puppeteer path never had a browser on Render; a headless browser would overrun a 512 MB Starter). `/api/measurements` is behind `measurement_reports` with its menu item and the job page's card (owner, 2026-10-19 — see "Not-ready features"; it was ungated here at first, as the template's API and menu). |
| `server/crm/roof/field/{storms,stormData,stormRadar,stormRadarService,canvassing,crews,materials,dashboard,roofJob}.ts` | `routes/{storms,stormRadar,canvassing,crews,materials,dashboard}.ts`, `services/{stormData,stormRadar}.ts` | Every roofing job is made by one function (`jobs.ts` `insertRoofJob`): storms took the text MAX of the number and canvassing counted jobs + 1 (a number reused after a delete). Converting one storm lead twice at once converts it once; a canvassing stop's contact, job, stop and counts are one transaction. Radar matches and syncs wrote duplicates (`onConflictDoNothing` with no unique index). A company with no storm service area uses its own zip. The dashboard counts a cancelled job as closed and owed money by the CRM's `invoiceBalance`. A crew's "active jobs" leave out finished and closed ones (the template listed every job). |
| `server/crm/roof/insurance/{insurance,xactimate}.ts` | `routes/insurance.ts`, `services/xactimate.ts` | `requireManager` (a rank list) → `insurance:approve` (the same three seats, and grantable). Supplement numbering and the approve / deny total under a lock on the claim (two at once could both be SUP-002, or lose one approval). Adjuster edit took the body whole (it could move an adjuster to another company) — now field by field. 500s on bad dates, negative figures and blank required names are 400s naming the field; `approvedAmount: ''` no longer approves at $0. Write replies withhold the figures from a seat without `invoices:read`, as the reads did. The export's dates print on the company's clock. |
- The shared modules' rows (SMS, reviews and review requests, financing applications, document versions): each mapped when its module's diff lands (plan step 3f).

**The company's clock is one rule** (`packages/tenant-backend/src/time/businessDay.ts` `companyTimeZone`): the unified app keeps the zone in `company.timezone` — what the Factory provisions and the owner sets — but the shared modules read only `settings.timezone` (the templates'), so every unified tenant's invoices, timesheets and dashboards counted days on the state's zone, or UTC. The column comes first now (a template database without it still answers), then the settings value, then the state (`apps/unified/tests/company-clock.test.ts`). Roofing's appointment times — a job's inspection and install, a canvassing appointment — are the time a person picked on the company's clock (`server/crm/roof/validation.ts` `onCompanyClock`): a browser's datetime-local box sends no zone, and the server read "10:00" as UTC, so a 10:00 Chicago inspection was stored as 05:00 and dropped off the day's count. The date of loss stays a calendar day.

**Roofing on the shared modules (plan step 3f), each measured by roofing's own suite (`tests/unified/harness/roof.ts`; every file passes or is a divergence held by a named test — `unified-divergences.ts` `roof`):**
- The vertical's id is **`roofing`**: what the mobile app recognises a roofer by (`apps/mobile/src/vertical` — given anything else it fell back to the contractor's tabs), what the template's sign-in reported and what the Factory calls it. The sign-in answer drops roofing's plan `limits` (nothing read them; the plan is the Factory's seats and features).
- Logins are the company module's (`/api/company/users`, the same rules — not yourself, not the owner, not the last admin); roofing had forked them onto `/api/users` with no delete. A record's audit history is `/api/audit?entity=&entityId=`.
- Invoiced / collected / outstanding are `/api/invoices/stats` (roofing's `/api/invoices/summary`), under `invoices:read` and `revenue:read`.
- Reviews are the CRM's module (a request is about a job and is sent for the business; reviews come from Google Business). Roofing's manual review log — mark sent, a review typed in by hand, a delete, a Google sync that only said "not connected yet" — is not carried; asking for a review is still `marketing:create`.
- A forged or tampered QuickBooks state sends the browser back to Settings with `invalid_state`, before any exchange (roofing answered a bare 400).
- **Fixed for every vertical, from roofing's copy:** a text from a number that belongs to no contact yet is filed under the contact the first time their own Messages panel is read (the CRM linked it only when the whole inbox was read).
- **Cutover:** a roofer's own Twilio number sending inbound texts to `/api/sms/webhook` is repointed to `/api/sms/webhook/incoming`. And the Factory never sets a number's inbound address itself (`services/a2p.ts` makes the messaging service with none): for unified tenants it should, so a tenant's texts arrive without hand setup.

**The browser's Google Maps key is its own (found moving roofing's screens, 2026-10-19).** The templates' build puts the server's key into every page (`services/deploy.ts`: `VITE_GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY"`), and a key the server also uses can't be restricted to the tenant's web addresses — anyone can lift it from the page and spend on it. **In the live templates today** (not changed from this branch; the owner's to weigh). The unified app serves a separate browser key with the page at run time (`GOOGLE_MAPS_BROWSER_KEY` → `screens.mapsBrowserKey`, `server/app.ts`), never the server's; without one, address search is a plain box and the roof-report map has no satellite tiles. **The Factory must provision `GOOGLE_MAPS_BROWSER_KEY`** — a key restricted to the tenant's addresses — for unified tenants.

**Roofing's screens (step 4, `docs/UNIFIED_ROOF_SCREENS.md`):** roofing's own pages under `web/src/crm/pages/roof/{jobs,insurance,reports,field}`, registered for a roofer before the CRM's (its `/crm/jobs` is the page for its `/api/jobs`); the CRM's contacts, quotes, invoices, portal, leads, settings and the rest for everything else. A roofer's menu is in roofing's order (`crm/verticals/roof.tsx` `roofingMenu`). Found and fixed on the way:
- the shared quote form offers a job when a vertical asks (`quoteJobs`; roofing) and opens filled in from a job's "New quote" — without it a roofing quote could never name its job, and a job's quote list stayed empty;
- the instant-estimate widget is served at `/estimator.js` (the template served it from its frontend; nothing in the unified app did), and the website's estimator section no longer waits for a CRM origin no one set — the site and the CRM are one app;
- Settings shows a vertical's own pages (`extraSubPages`, by permission and feature): roofing's Instant Estimator Widget;
- the roof-report editor's satellite preview is a `data:` URL MapLibre fetches — `connect-src` allows `data:`;
- the pricebook trial request went to the business's OWN help desk (`/api/support/tickets`), where Twomiah never saw it — now `/api/platform-support/tickets`, as roofing's estimator trial;
- the materials date filter, a crew's active-job count on the list and a storm-radar match's contact name are answered by the server (the screens sent or needed them; nothing answered);
- found in the browser: roofing sells no Call Tracking, so its call log and CallRail key ride the AI Receptionist (the template's `['/api/calltracking', 'ai_receptionist']`) — the unified app gated them on Call Tracking, a switch a roofer can never turn on, so a roofer's Call Log was refused and the CallRail key had no screen. One setting now (`CrmSettings.callTrackingSwitch`), read by the API's gate and the AI Receptionist page, whose Settings tab holds the key for a roofer (`tests/call-tracking-switch.test.ts`);
- found in the browser: two headers ran off a phone's screen (Measurements, Canvassing), the credit-pack picker's chosen amount was pale on purple in dark mode, and two restaurant toggles had the same fault (a trailing dark class over the chosen colours); grey labels on a chosen card's brand tint (contacts' type cards, storm events) read below 4.5:1.
- the pricebook and estimator trial pages have no link in — the templates linked them from the landing page's promo cards, which the unified app doesn't have — and need none: the Pricebook is offered to roofing and the owner switches it on in Settings › Features (no request to Twomiah), and the Instant Roof Estimator is a not-ready feature offered to no one until the owner decides (below). The pages stay at their addresses for an old link.

**Roofing — for the owner before roof reports, the estimator and storm alerts are offered** (all three are not-ready features, offered to no one; owner, 2026-10-19: "none of those roof features should be on"). Roof reports and the estimator were already marked not-ready; storm radar was still offered — any roofer's owner could switch it on in Settings › Features over placeholder providers — and is marked not-ready now (`featureRegistry.ts` `storm_radar_overlay`). Storm leads stay: a storm the roofer enters by hand, matched against their own customers, with no outside feed.
- Buying measurement credits adds them with no payment (the template's "demo mode", always on): any admin can add 1,000. It needs a Stripe checkout and confirmation like the report purchase.
- The public instant estimator has no rate limit, and every call is a billed Google Solar request and a new contact.
- A paid roof report is made only when the roofer's browser comes back from Stripe; there is no Stripe webhook, and two confirmations at once can make it twice.
- The daily NOAA storm check (`runDailyStormCheck`) was never started by the template; its feed URL and parsing are unverified, and starting it would write storm events from that feed. Moved, not scheduled.
- Storm radar providers are stubs, as in the template.

**A job's money is one rule** (`packages/tenant-backend/src/jobs/jobMoney.ts`): the quoted value under `quotes:read`, roofing's revenue and claim money under `invoices:read`, its costs under `margin:read`. Two copies of the rule existed (the shared jobs module's and roofing's); with roofing's columns on the shared table, any route returning a whole job row was a side door. A walk of every GET route as a seat without those permissions (`apps/unified/tests/job-money-walk.test.ts`, 700 calls, mutation-checked) found and closed seven: the jobs module's own write replies (create, edit, start, complete, dispatch — a field seat got RCV and costs back from Start), the technician's view and its moves, a subcontractor's portal "complete", a warranty claim's status reply, quote → job conversion, a project's job list, and route optimisation (which also asks no permission at all — noted, not changed). Roofing's job photos are read by their bytes for every vertical now (the shared module fell back to the declared type), and an upload with no photo store set up is a plain 503, not a failed send. **Open:** live updates (`emitToCompany` JOB_CREATED / JOB_UPDATED) broadcast the whole row; the transport isn't wired yet (`core/realtime.ts` is in-process), and when it is, each recipient's payload must be shaped by the same rule.

## Not-ready features and the Pricebook, tested (2026-10-19)

**Off until tested (owner: "none of those roof features should be on"; "ads shouldnt be on util it is tested"):** roof
reports, the instant estimator, storm radar and the Paid Ads Hub are the registry's not-ready features. No path switches
one on: the owner's Features page neither lists nor saves them, and the Factory's first setup and feature sync drop them
(`withoutNotReady`, `packages/tenant-backend/src/featureRegistry.ts`) — the Factory's admin already did. Each one's API
refuses while it is off. Two were reachable regardless: storm radar was still offered (now not-ready), and **Measurements**
— ordering a Google Solar roof measurement on Twomiah's key, and adding credits with no payment — had no switch at all,
in the template or here; it is behind `measurement_reports` now, menu, API and the job page's card alike. Held by
`apps/unified/tests/not-ready-features.test.ts` (each guard mutation-checked).

**The Pricebook** (`packages/tenant-backend/src/pricebook/pricebook.ts`, `packages/tenant-ui/src/pricebook`), tested end to
end: `apps/unified/tests/pricebook.test.ts` (13 checks over the switch, seats, categories, items, Good/Better/Best, bulk
price changes, import/export, and use on a quote) and the screens in a browser as a roofer (add an item, its options,
search, price a quote line from it, the crew rep's read-only view: 16 checks). Found and fixed:
- **an item could not be saved from the form without labour hours** — the form sends an empty box as `null` and the
  server refused it ("laborHours: Invalid input"). **The live contractor and field-service pricebooks have this fault
  today** (same code on `main`; not changed from this branch — the owner's to schedule);
- re-importing a price list to change prices wiped each item's category and set its cost to $0 when the file left those
  columns out; an import now writes only the columns a row carries, and reads back the export's taxable and active;
- a category could be set under its own sub-category, and both then vanished from the page;
- the export handed cost and margin to a seat granted the pricebook without margin:read;
- roofing sold the Pricebook but its quotes and invoices could not use it (roofing's own app had no pricebook behind the
  switch at all — only a trial card); a roofer's quote and invoice lines are priced from it now.

**Open, for the owner:** the Pricebook is also offered to home care, which has no quotes or invoices to price — a
catalogue nothing uses. And the customer "presentation" page (`/api/pricebook-present/:id`, Good/Better/Best shown full
screen) has no link from any screen, shows items that are switched off or hidden from customers, and relabels the
tiers "Sign Today / Within 30 Days / Valid 1 Year" — not what Good/Better/Best means. Neither is changed here.

## Dispensary — not in the unified app (owner, 2026-10-19)

"Lets just not put dispensaries in for now." The dispensary (`templates/crm-dispensary`, `website-premium-dispensary`)
is not moved: the build order is home care, roofing, store, then cutover. There are no dispensary customers, so nothing
moves and nothing is kept running for one. What the owner decides before cutover: whether a dispensary signup is
refused until it is built, or still built from the template. Already in the unified app and left as they are: the
site's `dispensary` design and its sections (strain, age gate, deals — part of the site library the parity test holds),
and the registry's dispensary features, which no unified vertical offers.

## Changing a password signs out every other device (owner, 2026-10-19: "do it the right way")

As Google, Microsoft and Shopify do: a password change ends every other session at once — refresh and access tokens
alike, not 15 minutes later — and keeps the device that changed it (given a new session in the reply: cookies for the
browser, the body for everyone else). A reset by email ends every session. The shared code had ended none on a change
(the store's template ended all, this device too). `user.sessions_valid_from` (migration 0014) carries the cut-off;
shared auth applies it only where the column exists, so a template keeps its old behaviour until it moves.
`apps/unified/tests/password-sessions.test.ts` (mutation-checked). The password screens show the server's sentence
("You have been signed out everywhere else").

## The store (step 6, `docs/UNIFIED_STORE_PLAN.md`)

**Moved** — originals to delete at cutover: `templates/crm-store` (back office) and `templates/website-store`
(storefront, and its copy of `templates/cms`).
- Server: `apps/unified/server/crm/store/` — `core.ts` (the shop, its settings, the merchant's payment / shipping /
  supplier accounts, dropship forwarding, a shopper as a customer, loyalty over the shared programme, the store's
  emails), `checkout/` (the storefront's public API, checkout, payment and supplier webhooks, order summary, cart
  recovery, reviews, the payment connection, the pending / abandoned-cart / review-request sweeps), `orders/` (orders,
  refunds, the label carrier, suppliers, the refund resume), `catalog/` (products, discounts, review moderation, loyalty,
  settings); raw SQL in `server/data/store{Core,Checkout,Orders,Catalog}.ts`; the payment, shipping and supplier adapters
  moved as they are. `server/modules/domain.ts` — the store's domain purchase, now the engine's for every vertical.
- Screens: `apps/unified/web/src/crm/pages/store/{orders,catalog}`, `crm/verticals/store.tsx`; a shopper's contact page
  lists their orders.
- Storefront: the site's `sections/shop/{grid,product,cart,receipt}.ejs`, `site/public/styles/store.css`,
  `site/public/scripts/cart.ts` (/scripts/cart.js), `server/site/shop.ts` (the closed-store page) — the same app, so no
  second service, no open CORS, no proxy. The JSON-file CMS and its separate admin login are not moved.
- Tests: `apps/unified/tests/store-{core,checkout,orders,catalog,site,contact-orders}.test.ts` (~100 checks), and the
  browser check — owner, manager and staff, every page and control, light 1440 and dark 390 — clean.

**Changes in what people see or may do** (each is the store matching the engine, or how the big platforms do it):
- A shopper is a customer record (owner's decision): checkout finds or makes the contact (type `customer`, source
  `online_store`), the order carries `contact_id`, and a customer with orders is kept. Loyalty is the shared programme by
  contact; the punch card counts orders in `qualifying_visits`.
- The store's seats: a manager can't create an admin login (only Manager and Staff can be given); payments stay the
  owner's — reading the payment account too (the template's GET asked nothing; found in the browser check); loyalty pages
  ask `loyalty:read` (every store seat holds it).
- Deleting something already gone is a 404, not "done".
- The store's settings page is `/crm/store-settings` (a manager may change shipping, and `/crm/settings` is the owner's);
  product reviews are `/crm/product-reviews` and the store's loyalty `/crm/store-loyalty` (the shared and salon pages
  hold the old addresses).
- For every vertical, from the store: team changes are written to the audit log in words (login added, role changed,
  access revoked or restored, invite re-sent); an expired invitation says so; a revoked login's sign-in attempt is
  recorded.

**Template defects fixed on the way** (not changed in the live templates): recovered carts and review requests linked to
pages the storefront doesn't have; abandoned-cart emails went to the placeholder `pending@checkout`; two sweeps at once
could send an email twice; Printful could never be connected (an empty email the server refused); a connected carrier's
address could never be changed; Hold / disconnect / auto-forward showed success on a refusal; a dashboard read failing
blanked every figure; pending orders couldn't be filtered; prices parsed with float maths could land a cent off; a
discount code expired at UTC midnight (the evening before in the US); photo controls were hover-only (unusable on a
phone); deletes used the browser's own confirm; image delete removed any file it was given; loyalty reads asked no
permission; several faint greys and dark-mode colours under 4.5:1.

**Cutover data steps (store):**
- `store_settings`: the business's name and support email → `company.name` / `company.email`; `onboarding_completed_at`
  → `company`; `subscription` and `loyalty` → `company.settings`; the commerce settings stay on `store_settings` with the
  company's id. `storefront_origin` is dropped (the storefront is the same app).
- `users` → `user`: `name` split into first and last, `staff` kept (read as `field`), ids kept.
- Every row gains the one company's id; uuids move across as text ids; `timestamptz` → `timestamp` (UTC), `jsonb` →
  `json`; the template's enums become text.
- `loyalty_members` (by email) → a contact for each email (found or made, as checkout does) and a shared member row;
  `qualifying_orders` → `qualifying_visits`; `loyalty_rewards.used_count` → `usage_count`; transactions keep `order_id`.
- `orders.contact_id`: filled from each order's email, as checkout does.
- Product photos: the template stored absolute `BACKEND_URL/media/...` addresses; rewrite to the app's own `/media/...`.

**Open, for the owner:** the store's onboarding had two extra steps (connect payments, add a first product); the
engine's wizard covers the rest — add them as `screens.onboarding.extra` when the store's signup is run. The domain page
exists only on a store's menu, though `/api/admin/domain` now serves every vertical.

**The store's payments, proven against the providers' own test systems (2026-10-19)** — through the local store, a
shopper checking out from the storefront's API and paying on the provider's own page, then the order page, the back
office and the provider's records: Square sandbox (its Testing Panel; Twomiah's sandbox app) 9/9 + 7/7 setup checks;
Stripe test mode (Checkout, card 4242; Twomiah's test account) 12/12; PayPal sandbox (guest card on PayPal's page;
the owner's BreakReturns sandbox app) 9/9 — each: connected (the key checked first), paid for exactly the order's
total, the order paid with its number, stock moved once, the shopper a customer contact, loyalty earned, a return
visit changing nothing, and a part refund through the provider that the provider's own records show. Found and fixed:
the order page said "Thank you … is confirmed" for an order never paid — it now says the payment hasn't come through
and keeps the cart. Not run: the providers' webhooks to a public address (a local server has none) — held by the
signed-webhook tests in `store-checkout.test.ts` and the converted suite. The loyalty row lock is proven on a real
Postgres with concurrent connections (`apps/unified/tests/store-loyalty-lock.test.ts`, runs when TEST_PG_URL is set;
fails with the lock removed).

**The store's own suite on the unified app:** `tests/store` runs as `store` (`tests/unified/harness/store.ts`, its store
mode in `runUnifiedSuite.ts`): square-orders passes unchanged; the other 18 seed the template's single-business tables and
are each held by a converted copy in `tests/unified/store` (18 files, 694 checks, every changed line marked `unified:`).
Found and fixed while converting: the audit log's "to" date dropped everything done that day (a bare end date is now the
end of that day on the company's clock, `server/data/audit.ts`); a field a seat may read but not save looked editable (the
template's disabled-field style, lost in the move, is app-wide again in `web/src/index.css`; the store settings page's
locked inputs carry their own `disabled`).
Decided on the way (the big platforms' way):
- an invite can't be sent to the owner's account, signed in or not (`owner_account`; the engine refused only after a
  sign-in) — `apps/unified/tests/owner-invite.test.ts`;
- a manager sees the team's names and roles (no emails, sign-ins or grants), as in every vertical — the store's template
  refused the whole list; the audit log stays the owner's and admins';
- staff and managers are no longer told on the dashboard that payments aren't connected: the payment account is the
  owner's to read, and the owner's dashboard says it.
**Cutover data step (store):** a saved punch-card reward named "Free service" (the service businesses' default that the
template's Loyalty screen used to save) becomes "Free item"; any other name is the owner's and stays.

## Switch-over step 1: real Factory builds on Render, every industry (2026-10-19)

Each industry built by the Factory's unified build (apps/api/src/unified/build.ts) on Render and GitHub as a test
tenant, signed in, every menu page opened in a browser, then torn down and checked gone (service, database, repo).
Store also ran Update Code (129s, data kept), a refused update for a service not its own, and a rebuild of a built
tenant ("Already provisioned"). All clean on the last run: store, vet (20 pages), home care (62), salon (20), roofing
(23), contractor (19), field service (19), restaurant, RV, bar. Teardown left nothing every time.

Found and fixed on the way:
- home care's first build got a 502 from the setup call while Render swapped the new instance in: the build now asks
  again on no answer/502/503/504, up to six times (tests/unified/factory/provision-retry.test.ts).
- field service, basic and landscaping quote pages asked the price book with the price book off; contractor's asked
  projects with projects off — refused on every visit. The quote, invoice, job and six project pages now ask a list
  only where its feature is on.
- a new business starts with what the live Factory builds that industry with (getDefaultFeaturesForTemplate, unchanged);
  the retired feature tiers (PLAN_TIERS) are gone — plans are priced by seats.
- the test harnesses blank every outside service's key from the shell (apps/unified/tests/noLiveKeys.ts): a test was
  calling the real Anthropic API.
