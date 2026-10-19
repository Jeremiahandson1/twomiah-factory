# Home care's screens into the unified app — how each one moves

Step 4 of `docs/UNIFIED_HOMECARE_PLAN.md`. Home care's frontend (`templates/crm-homecare/frontend/src`, about 58,000
lines) moves into `apps/unified/web/src/crm/pages/homecare/<group>/`, in the eight groups below, each owned by one
hand. Read `docs/RULEBOOK.md` and `docs/UNIFIED_MOVE_GUIDE.md` §4 first. The behaviour must not change except where
this page says so, and every change is reported.

## What is already in place (do not change; ask if it is wrong)

- `crm/verticals/homecare.tsx`: puts the groups together. `MENU` is the menu's paths, order and headings (the
  template's `AdminDashboard.tsx` NAV_SECTIONS). Home care's routes are registered before the CRM's, only for the
  home-care vertical, inside `HomecareFrame`. `/crm/dashboard` is `office.OfficeHome` for whoever holds
  `care-schedule:update`, else `visits.CaregiverHome` (the template's role split).
- `crm/pages/homecare/publicApp.tsx`: the public pages (no sign-in). `people/public.tsx` renders `/careers`,
  `/careers/:slug` and `/onboarding/:token`; `portals/public.tsx` renders `/portal/*`, `/family/*`, `/pay/:invoiceId` and
  `/payment-success`. Each reads the address with `useLocation()`: there is one level of routes.
- `crm/pages/homecare/lib/`: shared by every group.
  - `http.ts`: `api` (the app's client), `downloadBlob(endpoint)`, `saveBlob(blob, name)`, `rows(reply)` (a list
    reply's rows), `errorMessage(err)`, type `RequestOptions`.
  - `HomecareFrame.tsx`: the `.hc` wrapper, the second brand colour, the agency's clock.
  - `homecare.css`: the template's `index.css`, scoped to `.hc`, with theme tokens (read its header).
  - The template's `utils/*` unchanged (`date`, `datetime`, `agencyClock`, `biweekly`, `cancelReasons`,
    `serviceTypes`, `shiftTimes`, `timezone`, `visitPhoto`, `sandata`), `incidentOptions` (its API helpers now take no
    token), `usePolling`, `usePageTitle`, `SignaturePad`.
- Server: every route is in `apps/unified/server/crm/homecare/<group>/`, raw SQL in `server/data/homecare*.ts`.
  `docs/CUTOVER_LEDGER.md` "Home care (step 6, routes)" lists what changed.

## The rules for each moved file

1. **Every call reads what the unified server answers.** For each endpoint a screen calls, open its route in
   `server/crm/homecare/**` (and the data function it calls) and read the reply. Lists are `{ data, pagination }`
   (`rows(reply)`); rows are **camelCase** everywhere (the template's raw-SQL replies were snake_case: `first_name`
   is now `firstName`, `client_id` is `clientId`). A record is the object; `done` is `{ success: true, message? }`; a
   refusal is thrown as an Error carrying the server's sentence. Fix every field read, every `.map` over a list,
   every `.length`. A JSON column's inside keys are as stored (not renamed). Request bodies: send what the route reads
   (read it; most kept the template's names).
2. **No tokens.** The session is the server's cookies. Replace `apiCall(…, token)`, `fetch(\`${API_BASE_URL}…\`)`,
   `getX(token)` and `localStorage.getItem('accessToken')` with `api.get(path, params?)`, `api.post/put/patch(path,
   body)`, `api.delete(path)`, `api.request(path, init)`, `api.upload(path, formData)`, `downloadBlob(path)`. Drop
   every `token` prop.
3. **The app's providers.** `useAuth()` from `'../../../../shared'` (`user.id`, `user.role`, `user.email`, `company`
   (its `id` is the company's), `hasFeature`, `can`; read `AuthUser` in `packages/tenant-ui/src/auth/types.ts`); `usePermissions()` for `can(permission)`; `useToast()` and `useConfirm()` from the
   same place instead of the template's global `toast()` and `confirm()` (read their signatures in
   `packages/tenant-ui/src/ui/Toast.tsx` and `ConfirmProvider.tsx`). A role check that decides what someone may do
   becomes a permission check (`can('care-billing:update')`), never a rank.
4. **Strict TypeScript.** No `@ts-nocheck`, no `// @ts-ignore`. Give props and the rows you read interfaces.
   `apps/unified/web/tsconfig.json` must report 0 errors: `cd apps/unified && bunx tsc -p web/tsconfig.json --noEmit`.
5. **Both themes.** The template was light-only; the app has a dark theme, and every home-care screen must read in
   both. In every file:
   - rename the classes whose families the app's own stylesheet also defines: `btn`, `btn-*`, `card`, `card-*`,
     `badge`, `badge-*`, `table`, `table-*`, `stat-*` → `hc-btn`, `hc-btn-primary`, `hc-card`, … (homecare.css already
     uses these names). Dynamic names too (`badge-${status}` → `hc-badge-${status}`).
   - a raw colour in a `style` or a class gets a light and a dark value: the frame's tokens
     (`var(--hc-surface)`, `--hc-ground`, `--hc-subtle`, `--hc-line`, `--hc-ink`, `--hc-ink-soft`, `--hc-muted`,
     `--hc-success-bg/-ink/-line` and the same for `warning`, `danger`, `info`, `--hc-red-ink`, `--hc-green-ink`,
     `--hc-blue-ink`, `--color-teal`, `--color-teal-dark` (brand ink), `--hc-brand-deep`), or a Tailwind light/dark
     pair (`bg-white dark:bg-slate-900`, `text-gray-900 dark:text-slate-100`).
   - an ink and its ground are a pair: change both or neither; each reads at 4.5:1 or better in both themes (white on
     a fixed-colour button is fine when that colour is dark enough in both).
   - the `dark:` classes already in a file were never seen in the template (it never set `dark`): check each pair.
6. **Dates and times** go through `lib/date`, `lib/datetime`, `lib/agencyClock` as the template's did — never a bare
   `new Date(dateOnly)` or `toLocaleString()` on an instant.
7. **The group's `index.tsx`** exports `routes` (each `<Route path="<relative to /crm>" element={<X />} />` with
   `X = page(() => import('./X'))` from `'../../../lazy'`, key set), `nav` (one item per MENU path the group owns:
   `{ to, icon (lucide-react), label (the template's), permission }`), and `routePermissions` (`{ '/crm/<path>':
   permission }` for every route, menu or not). The permission is the one the page's main API asks for. Where a
   caregiver also holds that permission (they hold `care-schedule:read`, `care-clients:read`, `evv:read/create/update`,
   `care-portal:read`, `my-pay:*`), an office screen uses the office's verb instead so a caregiver's menu stays their
   own app, as in the template: `care-clients:update`, `care-schedule:update`, `care-portal:update`, and
   `care-schedule:update` for the EVV and visit-documentation screens.
8. **Only what the template rendered.** Move a file only if the template reached it (from `App.tsx`,
   `AdminDashboard.tsx`'s `renderPage`, `CaregiverDashboard.tsx`, or a file those import). A dead file is listed in
   the report, not moved. The 8-line `pages/*Page.tsx` wrappers are not moved.
9. **The shared app's screens replace these; don't move them:** the lead inbox and lead sources, paid ads, Contact
   Twomiah, branded email, Google reviews, the email domain and inbox, the AI receptionist (`/crm/ai-receptionist`),
   two-factor (`/crm/account`), plan & billing (`/crm/settings/billing`), the lock page, sign-in, the shell
   (`AdminDashboard`, `layout/AppLayout`, `TrialBanner`), `Toast`, `ConfirmModal`, `ErrorBoundary`. A link to one of
   them goes to its `/crm/…` path.
10. **Your folder only.** Write only under `crm/pages/homecare/<your group>/`. A change anything else needs (a lib
    helper, the server, another group's file, `MENU`) goes in your report, with the reason.
11. **A server mismatch is reported, not worked around**: a screen calling an endpoint the unified server lacks, or
    one that answers a shape the screen can't use. Don't change the server.
12. **Check before you finish**: `bunx tsc -p web/tsconfig.json --noEmit` (0 errors) and
    `bun run scripts/check-unified-rules.ts` from the repo root. Don't run the test suites or `build:web` (others are
    working beside you; memory is shared).

## The groups

| Group | Template files (`templates/crm-homecare/frontend/src/`) | Pages (`/crm/…`) |
|---|---|---|
| `clients` | `components/admin/{ClientsManagement, ClientModal, EditClientModal, InsuranceCardUploader, ClientReportModal, ClientOnboarding, ClientDocuments, ReferralSources, CarePlans, CareTasksManager, ADLTracking, MedicationsManagement, VitalsTracker, FormBuilder, DocumentsManagement}` | `clients`, `client-onboarding`, `client-documents`, `referral-sources`, `care-plans`, `adl`, `medications`, `form-builder`, `documents` |
| `schedule` | `components/admin/{SchedulingHub, DragDropScheduler, MakeShiftAvailableModal, AutoFillButton, ScheduleOptimizer, RosterOptimizer, ScheduleCalendar, OpenShifts, ShiftSwaps}` | `scheduling` |
| `shifts` | `components/admin/{LiveBoard, VisitGpsMap, EmergencyCoverage, NoShowAlerts, ShiftApprovals, RouteOptimizer, CompanyOptimizer, ClientWeekHours, CaregiverAvailability, AbsenceManagement}`, `pages/{PtoPage, NoShowPage}` | `live-board`, `emergency-coverage`, `no-show-alerts`, `shift-approvals`, `route-optimizer`, `company-optimizer`, `client-week`, `pto`, `no-show` |
| `visits` | `components/{CaregiverDashboard, CaregiverClientModal, MileageTracker, OfflineBanner, CareTaskChecklist}`, `components/caregiver/*`, `offlinePunches.ts`, `hooks/{useNative, useOfflineSync}`, `components/admin/{EVVDashboard, VisitDocumentation, VisitPhotoGallery}`, `pages/{ClientsPage, SettingsPage, TimeTrackingPage}` if the caregiver app uses them | `evv`, `visit-docs`; `CaregiverHome` (the caregiver's day at `/crm/dashboard`). The web build always stubbed Capacitor (its `vite.config.js`), so `useNative` is its browser half only. |
| `billing` | `components/admin/{BillingDashboard, BillingImport, PortalClaimDays, ClaimsManagement, BillingEngine, PayersServiceCodes, AuthorizationsManagement, RevenueForecast}` | `billing`, `billing-import`, `portal-claim-days`, `claims`, `billing-engine`, `payers-service-codes`, `authorizations`, `revenue-forecast`. `PortalClaimDays` opens `clients/EditClientModal` (import it from there). |
| `people` | `components/admin/{CaregiverManagement, AddCaregiverModal, CaregiverDetail, CaregiverProfile, CaregiverHistory, EligibilityCard, PerformanceRatings, ApplicationsDashboard, ApplicationDetail, JobPostingsAdmin, OnboardingPacketsAdmin, BackgroundChecks, PayrollProcessing, PaydayVerificationSetting, ExpenseManagement}`, `pages/PerformanceReviewsPage`; public: `pages/CareersPage`, `components/{ApplicationForm, OnboardingPacketPage}` | `caregivers`, `caregivers/:id`, `caregivers/:id/history`, `performance`, `performance-reviews`, `applications`, `job-postings`, `onboarding-packets`, `background-checks`, `payroll`, `expenses`; `people/public.tsx` |
| `portals` | `components/portal/*`, `components/admin/FamilyPortalAdmin`, `components/PaymentPage` | `family-portal`; `portals/public.tsx` (the client portal with its sign-in, setup and pause, the family portal with its sign-in, paying an invoice and its receipt) |
| `office` | `components/admin/{DashboardOverview, ComplianceTracking, AuditLogs, LoginActivity, IncidentReporting, IncidentDetail, IncidentResponsesDue, ReportsAnalytics, AgencyTimezone, CommunicationLog, SMSManagement, AlertsManagement, MessageBoard, NotificationCenter, IntegrationsHub, SandataPanel, FeaturesPage, UserManagement}`, `components/{ImpersonationModal, HelpPanel}`; read `pages/OnboardingWizard` | `compliance`, `audit-logs`, `login-activity`, `incidents`, `incidents/:id`, `reports`, `communication-log`, `sms`, `alerts`, `messages`, `notifications`, `integrations`, `agency-features`, `users`; `OfficeHome` (DashboardOverview at `/crm/dashboard`, its tiles linking to the pages). Report whether home care's first-run wizard asks what the shared one (`Crm.Onboarding`) doesn't. |

`AdminDashboard` switched sections with `onNavigate(id)` / `setCurrentPage(id)`; each becomes `navigate('/crm/<path>')`
(`useNavigate`). Its `caregiver-profile` and `caregiver-history` sections become `/crm/caregivers/:id` and
`/crm/caregivers/:id/history`.

## The report each group returns

The files moved (template → unified) and the files not moved (why); every server mismatch; every behaviour change
and every fix (a contrast pair, a wrong field read); the routes, menu items and permissions registered; what anything
outside the folder needs; the type check and rules check results.
