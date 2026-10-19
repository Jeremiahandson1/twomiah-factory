# Roofing's screens into the unified app — how each one moves

Step 4 of `docs/UNIFIED_ROOF_PLAN.md`. Roofing's own pages (`templates/crm-roof/frontend/src`) move into
`apps/unified/web/src/crm/pages/roof/<group>/`, in the four groups below, each owned by one hand. Read
`docs/RULEBOOK.md`, `docs/UNIFIED_MOVE_GUIDE.md` §4 and the "Roofing" section of `docs/CUTOVER_LEDGER.md` first. The
behaviour must not change except where this page says so, and every change is reported.

Roofing's screens are closer to the unified app than home care's were: 48 of its 51 page files already carry dark-theme
classes and use the shared UI (`'../../shared'` in the template is `'../../../../shared'` here).

## What is already in place (do not change; report if it is wrong)

- `crm/verticals/roof.tsx` puts the groups together for a roofer only (`isRoofing`, from the vertical's screens
  `home: 'roofing'`): each group's `routes`, `nav`, `routePermissions`; `dashboard` (the jobs group's) is the roofer's
  `/crm/dashboard` (`crm/screens.tsx` HOMES). Roofing's routes are registered BEFORE the CRM's in `App.tsx`, so
  `/crm/jobs`, `/crm/jobs/:id` and `/crm/reports` are roofing's pages for a roofer and the CRM's for everyone else.
- `crm/pages/roof/lib/`: shared by every group — `AddressAutocomplete.tsx` (its Google key is served with the page:
  `verticalScreens().mapsBrowserKey`; empty means a plain box), `MapProvider.tsx` (callers pass the key —
  `verticalScreens().mapsBrowserKey`), `user.ts` (`displayName`), `supplier.ts`. Dates: `crm/date.ts` `formatDate` (the
  template's `utils/date.ts`, identical). `maplibre-gl` and `three` are dependencies of the app.
- The server: every route is in `apps/unified/server/crm/roof/**` (and the CRM's shared modules). Read the route a
  screen calls before changing the screen.

## What the server answers now (read the route to confirm each)

- **A job** (`server/crm/roof/jobs.ts`): `number` (was jobNumber), `address` (was propertyAddress) and `title` (the
  address), `estimatedValue` (was estimatedRevenue); `contact` is `{ id, name }` on the list and the whole record on
  `/:id`. The list is `{ data, pagination }` with NO `moneyWithheld` / `costWithheld`: a screen hides money tiles with
  `can('invoices:read')` (revenue, the claim's figures) and `can('margin:read')` (material and labour cost) — the same
  permissions the server applies. `/types`, `/:id/photos`, `/:id/timeline` are lists. Every read asks `jobs:read`.
- **A contact** is the CRM's: one `name`, `mobile` (was mobilePhone), `source` (was leadSource), `propertyType`.
  Customers' pages are the CRM's shared screens — link to `/crm/contacts/:id`.
- **Quotes and invoices** are the CRM's shared screens (`/crm/quotes`, `/crm/quotes/:id`, `/crm/invoices`,
  `/crm/invoices/:id`). A quote for a job: `POST /api/quotes` with `jobId` (accepted for roofing), and
  `GET /api/quotes?jobId=` lists a job's. Totals: `GET /api/invoices/stats` (`totalAmount`, `paidAmount`, `outstanding`;
  `invoices:read` + `revenue:read`) replaces roofing's `/api/invoices/summary`.
- **People** (a rep picker, the roster): `GET /api/company/users` (roofing's `/api/users`); a crew is `/api/crews`.
- **Lists are `{ data, pagination }`**: crews, canvassing sessions / stops / map / scripts, storm events, storm-radar
  events and matches, a claim's supplements and activity, adjusters, measurements (`pagination.pages`, was
  `totalPages`), roof reports. Materials carry no `moneyWithheld` (use `can('margin:read')`).
- **Insurance** (`/api/insurance`): approve / deny a supplement ask `insurance:approve` (the template's role list) —
  `can('insurance:approve')`, never a role check. The Xactimate files are `GET /api/insurance/claims/:id/files/:file`
  (`invoices:read`).
- **Roof reports / estimator**: `PUT /api/settings/estimator` (the template's estimator page called
  `PUT /api/company/estimator`, which never existed); Stripe returns to `/crm/roof-reports`; the PDF is the print-ready
  page (`GET /api/roof-reports/:id/pdf` answers HTML — the browser prints it to PDF).
- A refusal is `{ error, code? }`; a validation failure `{ error, fields }`.

## The rules for each moved file

1. **Every call reads what the unified server answers** (above; read the route). Fix every field read, every `.map`
   over a list, every `.length`.
2. **The app's API client and providers**: `import { api } from '../../../../api'` (`api.get(path, params?)`,
   `api.post/put/patch/delete`, `api.upload(path, formData)`, `api.request(path, init)` for a raw response); `useAuth`,
   `usePermissions` (`can`), `useToast`, `useConfirm`, `useMayWrite` from `'../../../../shared'` (read their signatures in
   `packages/tenant-ui/src`). The template's `services/api`, `api/client`, `contexts/AuthContext`, `contexts/ToastContext`
   and `lib/authToken` go: no tokens, the session is the server's cookies.
3. **Permissions, never rank**: a control is shown to whoever its route lets use it (`can('jobs:update')`, …). The
   template's `minRole` / role lists become the permission the route asks.
4. **Strict TypeScript**: no `@ts-nocheck`, no `@ts-ignore`; props and the rows read get interfaces.
5. **Both themes**: every ink has its ground in both themes (a `dark:` partner on each light colour, read at 4.5:1).
   The template's existing `dark:` classes were seen in a browser — keep them; check any you add.
6. **Dates** through `crm/date.ts` `formatDate`; an appointment time (inspection, install, a canvassing appointment) is
   on the company's clock on the server — send what a `datetime-local` box gives (no zone).
7. **The group's `index.tsx`** exports `routes` (`<Route key path element />`, path relative to /crm, element a
   `page(() => import('./X'))` from `'../../../lazy'`), `nav` (`{ to, icon (lucide-react), label, section?, features?,
   permission? }` — the template menu's feature and the permission the page's main API asks), and `routePermissions`
   for every route. The template's menu (`components/layout/AppLayout.tsx`) is the order and the gates.
8. **Only what the template rendered.** A dead file is listed in the report, not moved.
9. **The shared app's screens replace these; don't move them**: Contacts, Quotes, Invoices, the customer portal
   (`pages/portal/*`, `CustomerPortal`), Lead Inbox and Lead Sources, Ads, AI Receptionist, Reviews, Financing,
   Documents, Import, Settings and its sub-pages (features, email, email domain, billing, inbox), Google Reviews, Account,
   Audit Log, Contact Twomiah, the paywall, sign-in, onboarding, the layout. A link to one goes to its `/crm/…` path.
10. **Your folder only.** Write only under `crm/pages/roof/<your group>/` (and add to `crm/pages/roof/lib/` only with the
    Edit tool, small additions, saying so). Anything else a screen needs — a server change, another group's file, the
    wiring — goes in your report with the reason.
11. **A server mismatch is reported, not worked around** (a screen calling a route the server lacks, or a shape it
    can't use). Don't change the server.
12. **Check before you finish**: `bun run scripts/check-unified-types.ts` (0 in the app — `bunx tsc` printing nothing is
    not proof) and `bun run scripts/check-unified-rules.ts`, from the repo root. Don't run the suites or `build:web`.

## The groups

| Group | Template files (`templates/crm-roof/frontend/src/`) | Pages (`/crm/…`) |
|---|---|---|
| `jobs` | `pages/roofing/{PipelineBoard, JobsPage, JobDetailPage, ReportsPage}` | `pipeline` (and `dashboard`: export `dashboard`), `jobs`, `jobs/:id`, `reports` |
| `insurance` | `pages/roofing/{InsuranceClaimPage, AdjusterDirectoryPage}` | `jobs/:id/insurance`, `adjusters` |
| `reports` | `pages/roofing/MeasurementsPage`, `pages/roofReports/{RoofReportsPage, RoofReportDetail, Roof3DViewer, Roof3DMesh, MapEdgeEditor}`, `pages/{EstimatorPage, EstimatorTrialPage}`, `pages/settings/EstimatorSettingsPage` | `measurements`, `roof-reports`, `roof-reports/:id`, `estimator`, `estimator-trial`, `settings/estimator` |
| `field` | `pages/roofing/{CanvassingDashboard, CanvassingView, StormLeadsPage, StormRadarPage, CrewsPage, MaterialsPage}` | `canvassing`, `storm-leads`, `storm-radar`, `crews`, `materials`; `CanvassingView` is full-screen at `/canvass` in the template — export it as `canvassView` from the group index and say where it should mount |

## The report each group returns

The files moved (template → unified) and not moved (why); every server mismatch; every behaviour change and fix (a
contrast pair, a wrong field read); the routes, menu items and permissions registered; what anything outside the folder
needs; the type check and rules check results.
