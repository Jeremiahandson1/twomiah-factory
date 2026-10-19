# Home care into the unified app — the plan

Home care (`templates/crm-homecare`) was built separately, not copied from the base CRM, so it doesn't merge
the way the near-copies do (`docs/UNIFIED_MOVE_GUIDE.md`, step 3e). This is how it comes in. Measured on
branch `engine`, 2026-10-18.

## What it is

| | Home care | For comparison |
|---|---|---|
| Tables | 145 (20 share a name with the unified schema: audit, MFA, email aliases, leads, call tracking, ads, billing records) | base CRM 148 |
| Tables with no business id | 130 (one agency per database, so nothing needed one) | none in the unified schema |
| The business | `agencies` | `company` |
| People who sign in | `users`, with no business id; caregivers' facts on the row (certifications, pay rate, hire date, emergency contact, home position, IVR PIN) | `user`, `company_id` |
| Table names | 110 plural (`clients`, `schedules`, `evv_visits`…) | singular |
| Raw SQL | 978 calls across routes and services | only in `server/data/` |
| Inserts | 161 through Drizzle, 86 raw | |
| Routes | about 30,000 lines in 80+ files | base CRM ~9,000 |
| Screens | about 57,000 lines | base CRM ~13,000 |
| Its own suite | `tests/homecare`, 32 files | |

Its own billing — invoices, claims, EDI batches, remittances, payments matched to claims — is Medicaid and
private-pay billing for visits. It is a different thing from the CRM's invoices and stays its own module.

## Decisions (each follows the rulebook; none changes it)

1. **One business table, one people table (RULEBOOK §4).** `agencies` becomes `company`: the columns the
   company row lacks (legal name, licence number, NPI, Medicaid id, and the rest) are added to `company`,
   nullable. `users` becomes `user`: home care's caregiver columns are added to `user`, nullable, and every
   home-care user gets the agency's `company_id`. The cutover data move copies agency → company and users →
   user, column for column; ids are kept, so every reference to a user still resolves.
2. **Every top-level record carries `company_id` (RULEBOOK §2).** The 130 tables gain it (child rows — a
   line item, a visit's time change — reach it through their parent, as the rulebook says). Every insert
   sets it from the signed-in person's company, as all CRM code does; no default is invented for it. The
   cutover data move fills it with the agency's id.
3. **Names keep their spelling (RULEBOOK §2: "names inherited from existing tables keep their spelling").**
   The plural tables stay plural, so a tenant's rows move across unchanged. A home-care table whose name
   collides with a unified one (`invoices` beside the CRM's `invoice`, `payments` beside `payment`,
   `time_entries` beside `time_entry`, `expenses` beside `expense`) keeps its own: they are different
   records (a Medicaid visit invoice is not a contractor's invoice) and the names already differ.
4. **Raw SQL moves to `server/data/homecare*.ts` (RULEBOOK §2)**, one named function per query, returning
   camelCase. Replies through `reply.ts` (§3).
5. **Home care is a vertical (`verticals/homecare/settings.ts`) whose features switch on its add-on**
   (`server/crm/homecare/`, `web/src/crm/pages/homecare/`), behind the registry's home-care features; the
   CRM's shared modules it also uses (team, documents, leads, call tracking, AI receptionist, MFA, billing,
   email) are the engine's.

## Order of work

1. **Schema**: the agency and user columns onto `company` and `user`; home care's own tables as an add-on
   layer with `company_id`; one migration; re-measured against the template by script, as 0006 was.
2. **Sign-in and roles**: home care's roles (owner, admin, scheduler, caregiver …) onto the unified rungs
   via the vertical's role labels and extra permissions; the IVR PIN and the caregiver app's sign-in.
3. **Server**, in groups that can move in parallel, each with its suite files: clients and care plans;
   caregivers, scheduling and open shifts; EVV, IVR and GPS; authorizations, billing, claims, EDI and
   remittance; payroll (Gusto) and expenses; HR (applications, background checks, onboarding packets,
   certifications); family portal, messages and notifications; compliance, incidents and audit.
4. **Screens**, in the same groups.
5. **The suite**: `tests/homecare` on the unified app as `homecare`, every file passing or a documented
   divergence held by a unified test. Then measured in a browser, every role, both themes, phone and desktop.

Roofing, the store and the dispensary follow the same pattern after home care (SPEC §0 build order).

## How the code moves

Home care's routes lean on a common set of helpers and services (the agency's clock `services/agencyTime.ts`
in 31 routes, schedule occurrences in 24, schedule rows, visit notices, self-service, caregiver access, care
audit, authorization checks, punch rules, invoice money …). So:

1. **The foundation first, by one hand:** `templates/crm-homecare/backend/src/{helpers,services,jobs,middleware}`
   that more than one route uses → `apps/unified/server/crm/homecare/core/`, each a factory taking `CrmDeps`
   (or a pure module where it has no state), raw SQL in `server/data/homecare*.ts`. Its timers (`jobs/*`,
   shift reminders, overtime alerts, visit jobs, the WORCS poll) start from `startJobs`, never at import.
   The sign-in context is already the unified one: home care's routes read `user.userId` and
   `user.companyId` (agency id → company id), which `server/http/env.ts` provides.
2. **Then the routes, in the groups of the plan above, in parallel**, each group in its own folder under
   `server/crm/homecare/`, using the foundation, following `docs/UNIFIED_MOVE_GUIDE.md` (replies, raw SQL,
   mounts behind the registry's home-care features). Every insert sets `companyId` from the signed-in person.
3. **Screens** the same way, under `web/src/crm/pages/homecare/`.
4. **The suite** (`tests/homecare`, its own auth stub today: `tests/harness/fixtures/middleware-auth.crm-homecare.ts`)
   runs against the unified app as `homecare`.

## Foundation landed (2026-10-18): what the route-groups step must wire

`server/crm/homecare/core/` (`createHomecareCore(d)`, one per CrmDeps) is in, with its SQL in `server/data/homecare*.ts`. Each item below is open until the step that needs it closes it:

- **Timed work.** `core.startJobs()` (shift reminders and over-visit texts every 5 minutes; the WORCS poll every 30 for Wisconsin agencies) is started by nothing yet. When `verticals/homecare/settings.ts` exists, `createApp` exposes the core for the home-care vertical only and `server/index.ts` calls `services.homecare?.startJobs()` beside `services.crm.startJobs()`.
- **Signed out on the server.** Home care revokes a staff token at sign-out (`core.tokens.isStaffTokenRevoked`); the shared `authenticate` does not ask. The sign-in group wires it before any home-care screen ships.
- **View As.** `refuseViewAsWrites` mounts with the impersonation route.
- **The portal lock.** The 402 has no `lock` field (RULEBOOK §3); the portal screens read `code`. The shared `refuseWhileLocked` reads the first company row (one business per database — correct).
- **Call tracking and the AI receptionist.** Home care's copies match callers to clients, make a client on a first call and count calls on the agency's clock: a vertical switch on `server/crm/comms/calltrackingService.ts` / `aiReceptionistService.ts`, not a second copy.
- **Not moved:** `routes/saasBilling.ts` (`/api/subscription`): the Factory's billing (`modules/company.ts`) replaces it, and its `changePackage` call never existed.

Fixed in the move (tests: `apps/unified/tests/homecare-core-fixes.test.ts`): EVV units read the authorization's unit through `authUnits.ts` (hourly and per-visit authorizations were counted as 15-minute units); every home-care email escapes what it puts into its HTML; Sandata's "changed by" falls back to the real `changed_by_id`; `web-push` and `pdfjs-dist` are dependencies, not names loaded at run time.

## Routes landed (2026-10-18)

All nine route groups are in (step 3); `docs/CUTOVER_LEDGER.md` "Home care (step 6, routes)" lists them. The foundation's open items are closed: the timed work starts with the CRM's (`services.addJob`); server-side sign-out revocation and View As are in the app's sign-in for home care (`office/signIn.ts`); call tracking and the AI receptionist match callers to clients through `CrmSettings.callers`; the portal lock answers `{ error, code }`. A manager is office (`core/caregiverAccess.ts`); a person's own pay is `my-pay`.

## Screens landed (2026-10-19)

Step 4 is in: every screen the template rendered, in eight groups under `web/src/crm/pages/homecare/`, by
`docs/UNIFIED_HOMECARE_SCREENS.md`; `docs/CUTOVER_LEDGER.md` "Home care's screens" lists what moved, what didn't and
what was made to work. The home-care suite runs clean on the unified app (every divergence held by an adapted copy).

View As landed (2026-10-19): the header's View As for staff and a client's portal, read-only, its session an httpOnly
cookie beside the office's own (`docs/CUTOVER_LEDGER.md`). The caregiver Full Profile's overview is built; the screens'
whole-list pickers walk the server's pages.

Help, the suite and the gates landed (2026-10-19): home care's guides (and every vertical's own day-one help), the
suite's screen reads pointed at the moved files, a caregiver write-gate walk over the app's own route table.

The browser check landed (2026-10-19): every home-care screen and every control that opens something, as the owner,
admin, manager, caregiver and a read-only seat, light at 1440 and dark at 390 — clean (no refusal, crash, overflow or
unreadable text; the only events are a caregiver with no profile yet, 404, and no email provider on the local machine,
503). What it found on the way is in docs/CUTOVER_LEDGER.md: write controls by permission, one rule for whose records a
person reaches, the MIDAS import and remittance upload.

Before any agency moves: the mobile caregiver app reads list replies as bare arrays (asList), so it is pointed at a
unified tenant only once it reads { data, pagination } (docs/CUTOVER_LEDGER.md).
