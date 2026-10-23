// Where a template suite's assertion and the unified app part on purpose. A failed assertion is accepted only when it
// is named here; anything else failing in the same file still fails the run. Each entry says why and where the
// behaviour is held instead, so nothing listed is untested.
export interface Divergence {
  /** The failing assertions this covers, by name (the text after "FAIL"). Absent: the whole file. */
  assertions?: RegExp[]
  why: string
  /** The test that holds the behaviour on the unified app. */
  heldBy: string
}

/** The CRMs' booking module (/api/booking, bookable_service, online_booking) is replaced by the bookings layer. */
const BOOKINGS_REPLACED = (what: string, heldBy: string): Divergence => ({
  why: `Drives the CRM templates' own booking module (/api/booking and its tables), which the unified app replaces with one booking engine for site and CRM (server/booking, CUTOVER_LEDGER step 2d). What it guards: ${what}.`,
  heldBy,
})
const WEBHOOK_REPLACED: Divergence = {
  why: "Drives POST /api/webhooks/leads, the separate website's contact-form webhook. The website is the same app now; its enquiry goes straight into the CRM's routing (server/core/enquiry.ts).",
  heldBy: 'apps/unified/tests/site-routes.test.ts (an enquiry lands in the Lead Inbox as new with it on, as a lead contact with it off)',
}

/** The store's single-business template shape (no company, `users`, store_settings as the business), replaced in the unified app. */
const STORE_SHAPES = (heldBy: string): Divergence => ({
  why: "Seeds the store template's single-business tables: `users` with one `name` (the unified `user` has first and last), the shop's name and support email on store_settings (the company row's — decision 1), loyalty members by email (by contact — decision 2); and reads the template's reply shapes (RULEBOOK §3).",
  heldBy,
})

export const UNIFIED_DIVERGENCES: Record<string, Record<string, Divergence>> = {
  // The store (tests/store, run by harness/store.ts). Every file but square-orders seeds the template's single-business
  // shape — `users` with one `name`, the shop's name on store_settings, loyalty members by email — which the unified
  // schema doesn't have (docs/UNIFIED_STORE_PLAN.md decisions 1–3), so it stops at its first insert. Each is held by its
  // converted copy, every changed line marked `unified:` (run by adapted.ts store).
  store: {
    'account-lock.test.ts': STORE_SHAPES('tests/unified/store/account-lock.test.ts (26 of 26)'),
    'admin-concurrency.test.ts': STORE_SHAPES('tests/unified/store/admin-concurrency.test.ts (31 of 31)'),
    'audit-and-shipping-rates.test.ts': STORE_SHAPES('tests/unified/store/audit-and-shipping-rates.test.ts (56 of 56)'),
    'checkout-charge.test.ts': STORE_SHAPES('tests/unified/store/checkout-charge.test.ts (29 of 29)'),
    'email-domain.test.ts': STORE_SHAPES('tests/unified/store/email-domain.test.ts (11 of 11)'),
    'label-picked-rate.test.ts': STORE_SHAPES('tests/unified/store/label-picked-rate.test.ts (10 of 10)'),
    'loyalty-races-and-roles.test.ts': STORE_SHAPES('tests/unified/store/loyalty-races-and-roles.test.ts (18 of 18)'),
    'loyalty.test.ts': STORE_SHAPES('tests/unified/store/loyalty.test.ts (32 of 32)'),
    'mfa-sign-in.test.ts': STORE_SHAPES('tests/unified/store/mfa-sign-in.test.ts (36 of 36)'),
    'order-receipt.test.ts': STORE_SHAPES('tests/unified/store/order-receipt.test.ts (11 of 11)'),
    'part-refunds.test.ts': STORE_SHAPES('tests/unified/store/part-refunds.test.ts (65 of 65)'),
    'paypal-refunds.test.ts': STORE_SHAPES('tests/unified/store/paypal-refunds.test.ts (85 of 85)'),
    'qa-t1.test.ts': STORE_SHAPES('tests/unified/store/qa-t1.test.ts (81 of 81)'),
    'qa-t3-manager.test.ts': STORE_SHAPES('tests/unified/store/qa-t3-manager.test.ts (37 of 37)'),
    'refunds-through-stripe.test.ts': STORE_SHAPES('tests/unified/store/refunds-through-stripe.test.ts (47 of 47)'),
    'roles.test.ts': STORE_SHAPES('tests/unified/store/roles.test.ts (80 of 80)'),
    'store-domain.test.ts': STORE_SHAPES('tests/unified/store/store-domain.test.ts (17 of 17)'),
    'team-invites.test.ts': STORE_SHAPES('tests/unified/store/team-invites.test.ts (22 of 22)'),
  },
  // Home care (tests/homecare, run by harness/homecare.ts). Each route group adds the entries for the files it owns,
  // under its own comment, with one entry per file (a second key with the same name silently replaces the first).
  homecare: {
    // visits group (server/crm/homecare/visits). Whole-file entries: each file reads a list reply as an array or a
    // reply's snake_case keys, which throws on the unified reply and stops it before its summary.
    'evv.test.ts': {
      why: "1) Replies are camelCase (RULEBOOK §2): clock-in / clock-out answer sandataRequired (not sandata_required), the caregiver context inSandata / medicaidId / activeVisit.timeEntryId, the visit detail timeChanges, the queue's failures evvVisitId, the submission status queueStatus (and the clients group's evv-week / evv-units, the billing group's payers, likewise). 2) Lists are { data, pagination } (RULEBOOK §3): the clients group's evv-week. 3) The office's doors are permissions (requirePermission: evv:delete for Sandata, care-clients writes for the clients' and referral sources'), refused with 'Permission denied', not 'Admin access required'. Same figures, same refusals.",
      heldBy: 'tests/unified/homecare/evv.test.ts (the adapted copy, every reply read through templateShape; 184 of 184; run by adapted.ts) and apps/unified/tests/homecare-visits.test.ts (the office side refused to a caregiver, camelCase replies, the caregiver context)',
    },
    'visits.test.ts': {
      why: "1) Replies are camelCase (RULEBOOK §2): a re-tapped clock-out answers alreadyComplete, the approval queue's rows needsApproval / approvalReason, a visit change request requestedBy / caregiverId, visit documentation visitDate / scheduleId / endTime (and the scheduling, portals and clients groups' replies in the same file, likewise). 2) Lists are { data, pagination } (RULEBOOK §3): the approval queue, visit photos, change requests, the schedules, the open-shift board, the portal's visits, the client list. Same figures. The template's two partial unique indexes (uniq_active_recurring_schedule, uniq_open_time_entry_per_caregiver) are migration 0010_homecare_guards, so the adapted copy's 409 and second-open-entry checks pass.",
      heldBy: 'tests/unified/homecare/visits.test.ts (the adapted copy, every reply read through templateShape; run by adapted.ts) and apps/unified/tests/homecare-visits.test.ts',
    },
    'caregiver-visit.test.ts': {
      why: "Lists are { data, pagination } (RULEBOOK §3) and replies camelCase (§2): the caregiver's call-out list (the scheduling group's emergency my-shifts) and the medication logs are list replies, the client card camelCase; a refused second swap is { error, code: 'swap_pending' } (§3), not carrying the open swap as a field.",
      heldBy: 'tests/unified/homecare/caregiver-visit.test.ts (the adapted copy, every reply read through templateShape; 33 of 33; run by adapted.ts) and apps/unified/tests/homecare-visits.test.ts (the visit photo and the punch)',
    },
    // billing group (server/crm/homecare/billing). Whole-file entries: each file reads a reply's snake_case keys
    // (r.json.reconcile[].service_date, li.hours of line_items), which throws on the camelCase reply and stops it before
    // its summary.
    'billing.test.ts': {
      why: "1) Replies are camelCase (RULEBOOK §2): the file reads the template's raw snake_case rows (sent_at, seq_number, service_date, line_items, periods_due, billed_on …) — the template's own index.ts added those aliases to every reply (addSnakeAliases); the routes it imported bare answered snake_case. 2) Lists are { data, pagination } (RULEBOOK §3): scheduled visits, rates, missing rates, the billing schedule, claims, the denial queue. 3) A refusal is { error, code }: the no-rate fix is in the sentence (code no_billing_rate; it was a message field), an overpayment's balance due is in the sentence (code overpayment; it was a balanceDue field). 4) The office's doors are care-billing permissions, refused with 'Permission denied', not 'Admin access required'. 5) The claims aging buckets are under30 / days30To60 … (under_30 has no camelCase to come back from). Same figures. invoices.seq_number's sequence default is migration 0010_homecare_guards, so the adapted copy's sequential-number checks pass.",
      heldBy: "tests/unified/homecare/billing.test.ts (the adapted copy, reading each reply through templateShape — the template's own snake-alias pass and the list's rows — and the refusals' sentences and codes; run by adapted.ts, every assertion passing) and apps/unified/tests/homecare-billing.test.ts (the mounts, the permission map for a caregiver of either seat and a manager, one company's records, camelCase, list and refusal shapes)",
    },
    'r3-billing.test.ts': {
      why: "1) Replies are camelCase (RULEBOOK §2) and lists are { data, pagination } (RULEBOOK §3): the file reads line_items, rate_type, payment_status, the reports' snake_case keys, the EVV dashboard as { visits, total } and the billing schedule and missing rates as arrays. 2) The invoice engine's client row is camelCase: privatePayByRule, not private_pay_by_rule. Same figures.",
      heldBy: "tests/unified/homecare/r3-billing.test.ts (the adapted copy, reading each reply through templateShape, the EVV dashboard's total from its pagination and the engine's camelCase row; run by adapted.ts: 54 of 54) and apps/unified/tests/homecare-billing.test.ts",
    },
    // clients group (server/crm/homecare/clients). Two whole-file entries: each file reads a list reply as an array
    // (list.json[0].minutes_per_week, list1.json.length), which throws on { data, pagination } before its summary.
    'care.test.ts': {
      why: "1) Every list is { data, pagination } (RULEBOOK §3): checklists, care plans, revisions, templates, medications, the MAR, vitals, forms, documents, signatures, ADL logs, the client list (was { clients, total, page, pages }). 2) Keys are camelCase (RULEBOOK §2): taskName, minutesPerWeek, revisionNumber, changedByFirst, medicationName, administeredTime, caregiverFirst, documentName, uploadedAt … Same values. 3) The file imports the template's services/carePdf.ts; it is server/crm/homecare/core/carePdf.ts, taking camelCase task rows. 4) It counts the template's snapshot trigger (trg_snapshot_care_plan); the unified migrations have none — PUT /api/care-plans/:id writes the revision itself, in the same transaction, with its author.",
      heldBy: "tests/unified/homecare/care.test.ts (the adapted copy: each reply read through templateShape, the PDF text from the core, and the plan's revisions counted in the table; run by adapted.ts) and apps/unified/tests/homecare-clients.test.ts (revisions written with the change, with author and company; list replies; permissions; one company's records)",
    },
    'r4-care.test.ts': {
      why: "1) Lists are { data, pagination } and keys camelCase (RULEBOOK §2, §3): the care plans (isActive), the care tasks (timesPerWeek, minutesPerWeek, everyVisit), the medications, the vitals; the care-plan PDF text is the core's carePdf.ts. 2) A reply is an object: the family portal's \"no active care plan\" is {} (portals group), not null. 3) The vitals' recorded instant leaves in JSON's Date form, 2026-10-16T16:10:00.000Z (the template formatted …00Z by hand) — the same UTC instant.",
      heldBy: "tests/unified/homecare/r4-care.test.ts (the adapted copy: replies read through templateShape, {} for no plan, the instant with milliseconds; run by adapted.ts) and apps/unified/tests/homecare-clients.test.ts",
    },
    // scheduling group (server/crm/homecare/scheduling). A whole-file entry: the file reads a caregiver's shift list as
    // an array (before.json.some), which throws on { data, pagination } and stops it before its summary.
    'scheduling.test.ts': {
      why: "1) The shift lists are list replies ({ data, pagination }, RULEBOOK §3): GET /api/schedules/caregiver/:id is read as an array. 2) A schedule row is camelCase (RULEBOOK §2): endTime, not end_time (the overnight create and the overnight edit). Same values.",
      heldBy: "tests/unified/homecare/scheduling.test.ts (the adapted copy, reading each reply through templateShape; 49 of 49 on adapted.ts) and apps/unified/tests/homecare-scheduling.test.ts (list replies, camelCase rows, permissions, one company's records)",
    },
    // payroll group (server/crm/homecare/payroll). A whole-file entry: the file reads the client's visit notes as an
    // array (card.json.some), which throws on { data, pagination } and stops it before its summary.
    'r3pay.test.ts': {
      why: "1) Replies are camelCase (RULEBOOK §2): the Gusto preview's grossPay / overtimeHours; the planning group's hours and performance reports' workedHours / payableHours / totalHours and punctuality rows (totalShifts, onTimeCount, earlyCount, lateCount, onTimePercentage); the visits group's visit documentation visits (visitDate, caregiverId, punch.clockOutNote) — the file reads gross_pay, worked_hours, on_time_count, visit_date, caregiver_id, clock_out_note. 2) Lists are { data, pagination } (RULEBOOK §3): the clients group's GET /api/clients/:id/visit-notes, read as an array. Same figures.",
      heldBy: "tests/unified/homecare/r3pay.test.ts (the adapted copy, every reply read through templateShape; run by adapted.ts — 60 of 60), apps/unified/tests/homecare-payroll.test.ts (the preview's rows and warnings in camelCase) and apps/unified/tests/homecare-planning.test.ts (who may run the hours and performance reports); the reports' camelCase rows and the visit notes' list reply are held by the adapted copy",
    },
    // Run 5, the agency's clock (office, planning, billing and clients groups). A whole-file entry: the file imports the
    // template's own src/services/calltracking.ts and frontend utils, which stops it before its summary.
    'r5-agency-clock.test.ts': {
      why: "1) /me is the shared sign-in's (packages/tenant-backend auth.ts) and does not name the agency's zone; every signed-in role, a caregiver included, reads it at GET /api/company (effectiveTimezone, server/crm/homecare/office/companyFields.ts), which is what the screens read (web/src/crm/pages/homecare/lib/HomecareFrame.tsx). 2) It imports template files that moved: the call volume report is the shared server/crm/comms/calltrackingService.ts switched by CrmSettings.callers ('clients', on the agency's clock); the frontend helpers agencyClock / datetime / serviceTypes are web/src/crm/pages/homecare/lib/; it reads the screens' source at their template paths (they are billing/PortalClaimDays.tsx, office/ReportsAnalytics.tsx, portals/FamilyPortal.tsx, typed to the camelCase replies: linkedClients, plan.serviceType). 3) It writes call_log by agency_id (the column is company_id, RULEBOOK §4). 4) Replies are camelCase (RULEBOOK §2): portal claim days' linkedClients, the revenue report's byServiceType rows' serviceType. Same zone, same figures.",
      heldBy: "tests/unified/homecare/r5-agency-clock.test.ts (the adapted copy: the zone read as a caregiver at GET /api/company, imports and screen reads pointed at the moved files, every reply read through templateShape; run by adapted.ts — 26 of 26) and apps/unified/tests/homecare-office.test.ts (every role, a caregiver included, reads the zone in use at GET /api/company; a home-care caller is a client)",
    },
    // Files with no adapted copy whose SOURCE checks read the template's own screens and session code (the template's
    // files are still there, so those checks pass — on code the unified app does not ship). The same behaviour on the
    // unified app is held by apps/unified/tests: session-fetch.test.ts and first-sign-in-token.test.ts by
    // homecare-office.test.ts "the screens' one client" and "the wiring the browser runs" (one cookie-mode client, a 401
    // refreshed once and replayed, a lock opening the lock page, sign-in saying why); account-lock.test.ts's screen half
    // by those and "a cancelled agency is locked by the server"; hire-credentials.test.ts's by homecare-hr.test.ts "the
    // hire's login on screen". Every adapted copy reads the moved files (tests/unified/harness/adapt.ts, 2026-10-19).
    // hr group (server/crm/homecare/hr).
    'hire-credentials.test.ts': {
      assertions: [/^emailed: the caregiver login exists/],
      why: "A hire's login is stored with the unified caregiver seat, `field` (moved tenants keep `caregiver`; verticals/homecare/settings.ts maps both onto the field rung, and the shared team module stores `field` too — canonicalRole). Same login, same rights; the assertion reads role === 'caregiver'.",
      heldBy: "apps/unified/tests/homecare-hr.test.ts (a hire: role field, in the hiring company; the hire dialog's login and the public pages' tabs, on the moved screens)",
    },
    // A whole-file entry: the template reads a list reply as an array (list.json[0] of the public careers list), which
    // throws on { data, pagination } and stops the file before its summary.
    'staff.test.ts': {
      why: "1) Every list is { data, pagination } (RULEBOOK §3): the careers list, applications, postings, packets, checks, the reports, reviews, certifications, training — the file reads them as arrays. 2) The compliance report and the Gusto preview are camelCase (RULEBOOK §2): passedChecks, regularHours… 3) A hire's seat is the unified role `field`.",
      heldBy: "tests/unified/homecare/staff.test.ts (the adapted copy: the same file reading each list's rows, the camelCase keys and role field; run by adapted.ts) and apps/unified/tests/homecare-hr.test.ts (list replies, camelCase compliance, role field, permissions, one company's records)",
    },
    // planning group (server/crm/homecare/planning). A whole-file entry: the file imports the template's own
    // src/services/agencyTime.ts and scheduleOccurrences.ts, which stops it before its first check.
    'reports.test.ts': {
      why: "1) It imports template files that moved: the agency clock (server/crm/homecare/core/agencyTime.ts), the schedule engine (SQL in server/data/homecareCore.ts, which now takes the company's id first) and the roster optimizer's shiftSpan (server/crm/homecare/planning/rosterOptimizer.ts). 2) Replies are camelCase (RULEBOOK §2) and lists are { data, pagination } (RULEBOOK §3): the file reads total_hours, client_id, shift_status…, saved routes as { routes, total }. 3) The office's doors are permissions now, refused with 'Permission denied', not 'Admin access required'.",
      heldBy: "tests/unified/homecare/reports.test.ts (the adapted copy: the same file, its imports pointed at the moved modules, each reply read through one camelCase-to-template alias pass, the saved routes as a list, the permission refusal; run by adapted.ts — 139 of 139) and apps/unified/tests/homecare-planning.test.ts (home care's /api/dashboard and /api/reports, the permission map for a caregiver of either seat and a manager, one company's rows and writes, camelCase and list replies)",
    },
    // portals group (server/crm/homecare/portals). Whole-file entries: each file stops before its summary on the
    // unified app (a fixture row without its company, a list reply read as an array, or a template file that moved).
    'portal.test.ts': {
      why: "1) Every home-care row carries its company (company_id NOT NULL, docs/UNIFIED_HOMECARE_PLAN.md decision 2): the file's first block writes clients before it makes the agency, so the sandbox has no company to give them and the insert is refused. 2) Lists are { data, pagination } (RULEBOOK §3): a client's portal logins, the all-clients view, the client's caregivers and a caregiver's background checks, invoices, the portal's notifications, the family members, their messages, the client threads, the staff inbox — the file reads them as arrays. 3) Keys are camelCase (RULEBOOK §2): /api/portal/me's firstName, portalEmail, displayName; the all-clients view's portalStatus, accountCount; a serving caregiver's caregiverId. Same values.",
      heldBy: "tests/unified/homecare/portal.test.ts (the adapted copy: the agency made first, each reply read through templateShape; run by adapted.ts — 155 of 155) and apps/unified/tests/homecare-portals.test.ts (home care's portal in front of the CRM's on /api/portal, the care-portal permission map for a caregiver of either seat and a manager, one company's clients, people and portal sessions, list and camelCase replies)",
    },
    'portal-visit-changes.test.ts': {
      why: "1) The family's visits and the picker's slots are list replies ({ data, pagination }, RULEBOOK §3): the file reads GET /api/portal/visits as an array (json.find), which throws. 2) Keys are camelCase (RULEBOOK §2): a filed request's autoApplied, cancelReason, adminNotes; a visit's scheduleId, scheduledDate, canChange; a slot's startTime. Same values.",
      heldBy: "tests/unified/homecare/portal-visit-changes.test.ts (the adapted copy, each reply read through templateShape; run by adapted.ts — 32 of 32) and apps/unified/tests/homecare-portals.test.ts",
    },
    'r4-owner-and-portals.test.ts': {
      why: "1) Its first part imports the template's seed rule (db/signupOwner.ts) and reads db/seed.template.ts: the unified app has no seed — the Factory's provisioning writes the business and its owner with role 'owner' (server/modules/provision.ts). 2) Replies are read through the rulebook's shapes. The billing doors, the owner's login and the two portals' locks are unchanged.",
      heldBy: "tests/unified/homecare/r4-owner-and-portals.test.ts (the adapted copy: the owner made as provisioning makes it, the seed's three blocks not run, every other check as written; run by adapted.ts — 28 of 28), apps/unified/tests/provision.test.ts (the provisioned owner is role 'owner') and apps/unified/tests/homecare-portals.test.ts",
    },
    'popup-forms.test.ts': {
      why: "1) The payers list is a list reply ({ data, pagination }, RULEBOOK §3): the file reads it as an array (json.some), which throws. 2) A new caregiver's seat is the unified role field (the hr group's caregivers route; moved tenants keep caregiver; both read as a caregiver).",
      heldBy: "tests/unified/homecare/popup-forms.test.ts (the adapted copy, each reply read through templateShape and the field seat; run by adapted.ts — 38 of 38, the bulk texts included), apps/unified/tests/homecare-portals.test.ts (a bulk text reaches a caregiver of either seat, never another company's) and apps/unified/tests/homecare-hr.test.ts (a hire's role is field)",
    },
    // office group (server/crm/homecare/office; sign-in, the company and the shared modules). The whole-file entries
    // stop before their summary on the unified app: a list reply or a camelCase row read the template's way, a raw
    // query naming the template's agencies / users / agency_id, a fixture person with no company, or a module that
    // follows its feature with the fixture's agency not having it.
    'smoke.test.ts': {
      assertions: [/^the no-op permissions stub is gone/],
      why: "The sandbox writes src/middleware/permissions.ts on purpose: it is the app's real permission module (createPermissions, the shared matrix) by the template's path, not the no-op stub the assertion guards against.",
      heldBy: "apps/unified/tests/homecare-office.test.ts (a caregiver is refused by the real permission check, 'Permission denied', on every office path)",
    },
    'account-lock.test.ts': {
      assertions: [/^locked: …and so is the caregiver, who is sent nothing else from settings/],
      why: "Sign-in is the shared one (packages/tenant-backend auth.ts): /me sends every role the company's settings with the secrets stripped (redactCompanySettings) — product and trialEndsAt among them — where home care's own /me sent accountLock alone. The lock itself reaches the caregiver (the assertion's first half).",
      heldBy: "apps/unified/tests/homecare-office.test.ts (/me tells a caregiver the agency's lock and no secret; 'a cancelled agency is locked by the server…' and 'the wiring the browser runs' for the lock page, its ways out and the boot pull)",
    },
    'admin-model.test.ts': {
      assertions: [/^…with homecare's own message/],
      why: "The template's requireAdmin answered 'Admin access required'; the unified routes are gated by permission (requirePermission: care-clients, care-payroll …), whose refusal is 'Permission denied'. Still a 403, for the same people.",
      heldBy: "apps/unified/tests/homecare-office.test.ts (a caregiver is refused by the real permission check, in its words) and the file's own refusal assertions, which pass",
    },
    'leads.test.ts': {
      assertions: [/^GET \/api\/leads is served, not missing/, /^…with homecare's own message/, /^an admin reaches PUT \/api\/leads/, /^an owner reaches POST \/api\/leads/, /^an admin can create a lead source/, /^a caregiver may still read \/api\/leads/],
      why: "The Lead Inbox is the shared module, which follows its lead_inbox feature on the server as the template's menu did (its API was ungated); the fixture's agency does not have it. Its writes refuse with requirePermission's 'Permission denied', and a lead source is one of the platforms the inbox connects to. A caregiver no longer reads it: an agency's leads are prospective clients' details, the office's (home care withholds the field rung's contacts:read).",
      heldBy: "tests/unified/homecare/leads.test.ts (the adapted copy: the agency has lead_inbox, the refusal is 'Permission denied', the probe source is care_directory, a caregiver is refused the reads; run by adapted.ts — 21 of 21)",
    },
    'mfa-sign-in.test.ts': {
      assertions: [/^the rows carry the agency's one fixed company id/, /^…and its refresh token is the one stored/],
      why: "Two-factor and sign-in are the shared ones: the device rows carry the person's real company id (the template fixed the id 'agency' for its one-agency database), and user.refresh_token holds the list of live sessions (one per device), not one token.",
      heldBy: "apps/unified/tests/homecare-office.test.ts (two-factor rows carry the company; a sign-in's refresh token is one /refresh accepts)",
    },
    'incidents.test.ts': {
      why: "The case file answers camelCase in list replies (RULEBOOK §2, §3), its paths refuse with 'Permission denied' (care-compliance), and section 3 replays the template's migration 0019 backfill on old-shape rows, which throws on the unified schema.",
      heldBy: "tests/unified/homecare/incidents.test.ts (the adapted copy, each reply read through templateShape, section 3 not run; run by adapted.ts — 154 of 154) and apps/unified/tests/homecare-office.test.ts",
    },
    'fixes.test.ts': {
      why: "It reads the template's agencies table by raw SQL, and replies the template's way (lists as arrays, snake_case keys). One deliberate change: an id that is not one of the office's own clients is refused (403) like another company's, never a 404 that would tell them apart. And POST /api/matching/apply-schedule, a stub that applied nothing, is not moved (404).",
      heldBy: "tests/unified/homecare/fixes.test.ts (the adapted copy, run by adapted.ts — 82 of 82) and apps/unified/tests/homecare-office.test.ts (View As is read-only; the office's unknown client is refused)",
    },
    'integration.test.ts': {
      why: "It drives most groups' routes and reads their replies the template's way (lists as arrays, snake_case keys, { caregivers } and { entries } lists), and raw SQL on the template's agencies and users tables.",
      heldBy: "tests/unified/homecare/integration.test.ts (the adapted copy, run by adapted.ts — 152 of 152)",
    },
    'write-gates.test.ts': {
      why: "Part 3 drives every group's routes and reads their replies the template's way; call tracking and Paid Ads follow their features (the fixture's agency had only ai_receptionist); /api/subscription (routes/saasBilling.ts) is the app's billing module, /api/billing, and /api/help's articles are the knowledge base, /api/support/kb (routes/help.ts not moved).",
      heldBy: "tests/unified/homecare/write-gates.test.ts (the adapted copy, run by adapted.ts — 138 of 138) and apps/unified/tests/homecare-office.test.ts (help articles: the office writes, a caregiver reads)",
    },
    'ai-receptionist.test.ts': {
      why: "Its rows name their company (companyId) where the template's named the agency (agencyId), and a read by aiReceptionistRule.agencyId throws; the call log is call tracking's, which follows call_tracking; the feature list is company.enabled_features alone (core/agencyFeatures.ts), never the settings blob.",
      heldBy: "tests/unified/homecare/ai-receptionist.test.ts (the adapted copy, run by adapted.ts — 62 of 62) and apps/unified/tests/homecare-office.test.ts (a home-care caller is a client)",
    },
    'webhook-signatures-homecare.test.ts': {
      why: "It reads call_log by agency_id (the column is company_id, RULEBOOK §4), and call tracking's settings and the lead sources follow their features (call_tracking, lead_inbox), which the fixture's agency did not have; a lead source is one of the platforms the inbox connects to.",
      heldBy: "tests/unified/homecare/webhook-signatures-homecare.test.ts (the adapted copy, run by adapted.ts — 37 of 37)",
    },
    'email-alias-readback.test.ts': {
      why: "Its fixture makes people before any agency; every person belongs to a company in the unified schema (user.company_id NOT NULL).",
      heldBy: "tests/unified/homecare/email-alias-readback.test.ts (the adapted copy, the agency made first; run by adapted.ts — 12 of 12)",
    },
  },
  salon: {
    // Two reasons, one file (a whole-file entry: the first stops it before its summary).
    'lyr.test.ts': {
      why: "1) Its fixture writes bills straight into the table numbered INV-00201, -00202…, the series the app also issues (highest + 1). Once the book raises a bill through the API the next hand-written number is one the app already used, and the unified app's guard (no two live invoices share a number, migration 0008, for every vertical) refuses it; the template has no guard, so the file silently made duplicate invoice numbers. 2) N4 reads the template's own routes/loyalty.ts source for the sentence; the router is server/crm/salon/loyalty.ts now.",
      heldBy: "tests/unified/salon/lyr.test.ts (the same file with the fixture's own bills in a series of their own, LYR-, and N4 reading server/crm/salon/loyalty.ts; run by adapted.ts), and apps/unified/tests/vertical-salon.test.ts (the losing punch-card claim speaks of the front desk)",
    },
    // The app-wide paging guard (server/http/guards.ts pagingGuard) refuses an over-cap or nonsense page with 400
    // invalid_pagination before any handler runs — "the stronger form of the rule", as appt-list.test.ts itself says;
    // the template harness mounted routes without it, so these assert the handlers' own clamp.
    'appt-list.test.ts': {
      assertions: [/^…but not an unbounded one — the handler clamps to 500/, /^nonsense paging does not divide by zero/, /^…and is deliberately NOT paged — the window is the bound/],
      why: 'An over-cap or nonsense page is refused by the app-wide paging guard rather than clamped; and a windowed book is a list reply (RULEBOOK §3), one page holding every row, so it carries pagination.',
      heldBy: 'tests/unified/salon/appt-list.test.ts (the adapted copy) and apps/unified/tests/vertical-salon.test.ts',
    },
    'list-bounds.test.ts': {
      assertions: [/^…but the cap holds at 500/, /^…and the cap holds at 200/],
      why: '?limit=99999 is refused by the app-wide paging guard (400 invalid_pagination) before the handler that clamped it.',
      heldBy: 'apps/unified/tests/vertical-salon.test.ts (an over-cap or nonsense page is refused) and boot.test.ts',
    },
    'list-caps.test.ts': {
      assertions: [/^\?limit=100000 is answered/, /^…with a page of at most 200/, /^nonsense paging falls back to page 1 of 50/],
      why: '?limit=100000 and ?limit=abc&page=-3 are refused by the app-wide paging guard (400 invalid_pagination) rather than clamped or repaired.',
      heldBy: 'apps/unified/tests/vertical-salon.test.ts (an over-cap or nonsense page is refused) and boot.test.ts',
    },
    'salon-orphan-invoice.test.ts': {
      assertions: [/^…and the message names the invoice and the money/],
      why: "A refusal is { error, code } (RULEBOOK §3): the invoice number and the amount paid are in VISIT_HAS_PAYMENT's sentence, not invoiceNumber / amountPaid fields (no screen read them).",
      heldBy: 'apps/unified/tests/vertical-salon.test.ts (a visit that has been paid for is not deleted; the sentence names the invoice and the money)',
    },
    'salon-repair-legacy.test.ts': {
      assertions: [/^an orphan holding money is NOT voided/],
      why: "The fixture is a sale paid in full left at status 'open'. The unified app builds every module, and the shared invoices module heals such drift once at start-up (packages/tenant-backend invoicing/invoices.ts reconcileInvoiceStatuses), so it reads 'paid' — still not void, which is what the assertion guards; the template harness never loaded the invoices module.",
      heldBy: 'apps/unified/tests/vertical-salon.test.ts (the visit repair never voids a sale holding money)',
    },
    't27-lows.test.ts': {
      assertions: [/^…while Getting Started still is/, /^…and so is Invoices, which this salon does have/, /^…and an article the salon wrote themselves is never hidden/, /^with Email Marketing on, the Marketing article comes back/, /^an unsynced tenant with no feature list keeps every article/],
      why: 'GET /api/support/kb is a list reply ({ data, pagination }); the test reads a bare array.',
      heldBy: 'tests/unified/salon/t27-lows.test.ts (the adapted copy, reading .data)',
    },
    't27-mediums.test.ts': BOOKINGS_REPLACED("N7/N11: the booking settings refuse a non-number lead time and a non-hex colour (the file stops reading the template's lead_time_days column); its N6 CSV-import assertions also part on purpose — the import keeps the base CRM's later rule (T32 M10): a bad email or unknown type is imported with a warning, never stored as is", 'tests/unified/salon/t27-mediums.test.ts (the adapted copy: N4, N5, N8 unchanged; N6 against T32 M10\'s warnings; N7/N11 not run) and apps/unified/tests/booking-routes.test.ts'),
    't28.test.ts': BOOKINGS_REPLACED("H1 configuring online booking needs company:update; H2 only services ticked bookable online are offered; L6 a full day leaves the date picker", 'tests/unified/salon/t28.test.ts (the adapted copy: every other section unchanged) and apps/unified/tests/booking-routes.test.ts (a manager runs the book but not the services or switches) / booking-engine.test.ts (slots and dates)'),
    't59-website-enquiry-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-website-enquiry-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  bar: {
    'bar-website-forms.test.ts': {
      why: "Drives POST /api/webhooks/leads, where the bar's separate website forwarded its party and Regulars forms. The website is the same app now: the forms post to the site's own enquiry (POST /api/leads) and crm/bar/enquiry.ts answers them (CrmSettings.websiteForms 'bar'), with the visitor's own address as consent evidence.",
      heldBy: 'apps/unified/tests/bar-website-forms.test.ts (the same behaviour through the site form: dated party → party book, same phone same guest, undated → inbox, Regulars tag + birthday + consent: 8 pass)',
    },
    // Reply shapes: adapted copies in tests/unified/bar (bar-register: code NEEDS_MANAGER; t38: list replies; t62: the
    // events list), run by adapted.ts.
    'bar-register.test.ts': {
      assertions: [/^a sent item needs a manager/, /^now it asks for the manager's PIN/, /^a payment void is always a manager's/, /^voiding a check with sent food needs a manager/, /^closing the night is a manager's/],
      why: 'A refusal is { error, code } (RULEBOOK §3): "a manager has to OK this" is code NEEDS_MANAGER; the template\'s reply carried needsManager: true, which the test reads. Still a 403 with the same sentence.',
      heldBy: 'tests/unified/bar/bar-register.test.ts (the same file, reading code NEEDS_MANAGER: 89 of 89)',
    },
    't38-activity-routes-reachable.test.ts': {
      assertions: [
        /^…with activities and pagination/, /^…newest first/, /^…and the feed joins the person/, /^both of the owner's rows come back/,
        /^…including the one on a job/, /^…and it is NOT the entity-activity handler/, /^…with both rows on that job/,
        /^…and it is the joined query/, /^…as a comment thread/, /^…and an empty thread is still an empty array/,
      ],
      why: "crm-basic's file, taken whole. The comment and activity reads are list replies ({ data, pagination }, RULEBOOK §3) with camelCase keys (firstName, RULEBOOK §2); the test reads bare arrays, { activities } and first_name.",
      heldBy: 'tests/unified/bar/t38-activity-routes-reachable.test.ts (the same file, reading .data and firstName: 18 of 18)',
    },
    't62-event-money.test.ts': {
      assertions: [/^…with NO quotedTotal or depositRequired key, and moneyWithheld/],
      why: "crm-restaurant's file, taken whole. GET /api/events is a list reply ({ data, pagination }, RULEBOOK §3) and carries no moneyWithheld beside it; the coordinator's rows still carry no quotedTotal or depositRequired.",
      heldBy: 'tests/unified/bar/t62-event-money.test.ts (the same file without the list flag: the rows carry no quote or deposit)',
    },
    't59-require-address.test.ts': BOOKINGS_REPLACED("a bar's answer is not to ask for the address; the owner's switch and null hand it back", 'apps/unified/tests/bar-booking-address.test.ts (the bar: not asked by default, the owner switches it on, null hands it back)'),
    't59-website-enquiry-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-website-enquiry-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  // Roofing (tests/roof, run by harness/roof.ts; docs/UNIFIED_ROOF_PLAN.md). Roofing's tests seed rows in its own table
  // shapes — first / last name, job_number, property_address, quote and invoice lines as JSON — which the plan replaced
  // with the CRM's (decisions 2–4), and read its list replies as arrays; each such file stops at its first insert or read.
  // Every one has an adapted copy in tests/unified/roof/ (harness/adapt.ts, each change with its reason), run by
  // adapted.ts as roof-adapted: the same assertions, the unified shapes.
  roof: {
    't39-insurance-claims.test.ts': { why: 'Seeds a contact with first / last name and jobs with job_number / property_address (plan decisions 2, 3).', heldBy: 'tests/unified/roof/t39-insurance-claims.test.ts (45 of 45) and apps/unified/tests/roof-insurance.test.ts' },
    't41-claims-and-scope.test.ts': { why: "Seeds roofing's shapes (decisions 2, 3); reads the claim activity as an array (RULEBOOK §3); fetches the Xactimate scope at /media/insurance/…, which the insurance module now serves itself under invoices:read (the media route gave it to any seat of the company — CUTOVER_LEDGER, Roofing).", heldBy: 'tests/unified/roof/t41-claims-and-scope.test.ts (50 of 50) and apps/unified/tests/roof-insurance.test.ts' },
    't41-roof-money.test.ts': { why: "Seeds roofing's job, quote and invoice shapes (decisions 2–4); reads estimatedRevenue (the CRM's estimated_value), roofing's /api/invoices/summary (the CRM's /api/invoices/stats: totalAmount, paidAmount, outstanding) and a moneyWithheld flag beside a list (RULEBOOK §3: the screen reads the seat's permissions).", heldBy: 'tests/unified/roof/t41-roof-money.test.ts (75 of 75), apps/unified/tests/roof-jobs.test.ts and apps/unified/tests/job-money-walk.test.ts' },
    't43-roof-write-controls.test.ts': { why: "Seeds a contact with first / last name (decision 3); and drives roofing's own review log (decision 6: the CRM's reviews module replaces it) — see roof-adapted.", heldBy: 'tests/unified/roof/t43-roof-write-controls.test.ts (every storms, canvassing and roof-report check) and apps/unified/tests/roof-shared-modules.test.ts' },
    't58d-remove-a-teammate.test.ts': { why: "A roofer's logins are the CRM's company users (DELETE /api/company/users/:id, the same rules); roofing had forked them onto /api/users with no delete.", heldBy: 'tests/unified/roof/t58d-remove-a-teammate.test.ts (15 of 15) and apps/unified/tests/roof-shared-modules.test.ts' },
    't59-audit-trail.test.ts': { assertions: [/^a MANAGER is refused \/api\/audit\/crew\/\S+ — the audit log is owners and admins only$/], why: "One record's history is the CRM's audit list filtered to it (GET /api/audit?entity=&entityId=, audit:read); roofing's /api/audit/:entity/:id had no caller.", heldBy: 'tests/unified/roof/t59-audit-trail.test.ts (17 of 17)' },
    't59-calls-inbox-off.test.ts': { assertions: [/^…named "Unknown Caller" \(first \/ last name, as roofing stores people\)$/], why: 'A contact has one name (decision 3): the caller is "Unknown Caller".', heldBy: 'tests/unified/roof/t59-calls-inbox-off.test.ts (6 of 6)' },
    't59-dashboard-stats.test.ts': { why: "Seeds roofing's job, quote and invoice shapes (decisions 2–4).", heldBy: 'tests/unified/roof/t59-dashboard-stats.test.ts (10 of 10) and apps/unified/tests/roof-field.test.ts' },
    't62-canvass-mine.test.ts': { why: 'Reads the canvassing session lists as arrays (RULEBOOK §3).', heldBy: 'tests/unified/roof/t62-canvass-mine.test.ts (16 of 16) and apps/unified/tests/roof-field.test.ts' },
    't62-measurement-cost.test.ts': { why: "Seeds roofing's contact and job shapes (decisions 2, 3).", heldBy: 'tests/unified/roof/t62-measurement-cost.test.ts (17 of 17) and apps/unified/tests/roof-reports.test.ts' },
    't63-claim-money.test.ts': { why: "Seeds roofing's shapes (decisions 2, 3); reads the supplement and activity lists as arrays (RULEBOOK §3).", heldBy: 'tests/unified/roof/t63-claim-money.test.ts (13 of 13) and apps/unified/tests/roof-insurance.test.ts' },
    't63-my-jobs.test.ts': { why: "Seeds roofing's contact and job shapes and reads job_number (decisions 2, 3).", heldBy: 'tests/unified/roof/t63-my-jobs.test.ts (8 of 8) and apps/unified/tests/roof-jobs.test.ts' },
    't68-viewer-roof.test.ts': { why: "Seeds roofing's shapes (decisions 2, 3); reads the canvassing lists as arrays (RULEBOOK §3).", heldBy: 'tests/unified/roof/t68-viewer-roof.test.ts (30 of 30)' },
    'mfa-roof.test.ts': { assertions: [/^…and roofing's own sign-in answer, as a password-only sign-in gets it$/], why: "The sign-in answer carries no plan `limits`: nothing read them (roofing's screens, the mobile app); the plan is the Factory's (seats, features). The company's vertical is 'roofing', as the mobile app reads it.", heldBy: 'tests/unified/roof/mfa-roof.test.ts (42 of 42)' },
    'qbo-relay-roof.test.ts': { assertions: [/^an unsigned state naming another company is refused, and nothing is exchanged( \d+)?$/, /^a state with its return URL swapped is refused$/], why: 'A refused QuickBooks state sends the browser back to Settings with error=invalid_state before anything is exchanged (packages/tenant-backend integrations/quickbooks.ts); roofing answered a bare 400.', heldBy: 'tests/unified/roof/qbo-relay-roof.test.ts (13 of 13: the forged and the swapped state are both refused, nothing exchanged)' },
    'webhook-signatures-roof.test.ts': { why: "Seeds contacts with first / last name and mobile_phone (decision 3); counts texts by sms_message.company_id and reads /api/sms/conversation/:contactId — a text belongs to a conversation in the CRM's texting (packages/tenant-backend integrations/sms.ts); posts inbound texts to /api/sms/webhook (the CRM's is /api/sms/webhook/incoming; a roofer's own number is repointed at cutover).", heldBy: 'tests/unified/roof/webhook-signatures-roof.test.ts (25 of 25) and apps/unified/tests/roof-shared-modules.test.ts (a stray text filed under its contact)' },
    'website-lead-webhook.test.ts': WEBHOOK_REPLACED,
  },
  // The base CRM's adapted copies (tests/unified/crm, run by adapted.ts).
  'crm-adapted': {
    'quote-email.test.ts': {
      assertions: [
        /^…and the customer's own portal page for this quote/, /^body: an approve button to the portal page/,
        /^plain-text version carries the lines and the link too/, /^sent \(200\), and the screen is told they cannot approve online/,
        /^they are told how to accept instead/, /^an expired portal link is not put in the email/, /^Client Portal switched off for the company: no link/,
      ],
      why: "On purpose (2026-10-22): every quote email carries the quote's own private link (/d/<token>, portal/documentLinks.ts) whether or not the customer has a client portal, so every customer can approve or decline — the template linked only a customer whose portal was on and in date, and told everyone else to reply or call. A template's schema has no public_token, so the templates keep their portal link (tests/crm quote-email: 17 of 17).",
      heldBy: "apps/unified/tests/document-links.test.ts (19: every trade's email carries the link with no portal, approve with signature and audit, decline, expiry, one document only, Quotes off closes it)",
    },
  },
  // Roofing's adapted copies (tests/unified/roof, run by adapted.ts).
  'roof-adapted': {
    't43-roof-write-controls.test.ts': {
      assertions: [
        /^T42: the crew seat may NOT ask a customer for a review — it reached this handler before$/, /^…and the refusal names marketing:create$/,
        /^a manager may — the people who chase reviews are the people who run the desk$/, /^…and nothing was written for the seat that was refused( "[^"]*")?$/,
        /^the crew seat may not mark one sent$/, /^the crew seat may not record a received review$/, /^the crew seat may not pull from Google$/,
        /^…a manager gets past the gate, and then the honest "not connected yet"$/, /^the crew seat may not remove a request from the record$/, /^…a manager may$/,
      ],
      why: "Drives roofing's own review log (/api/reviews/requests, mark-sent, a review recorded by hand, a Google sync that only said \"not connected yet\"). The CRM's reviews module replaces it (plan decision 6): a request is about a job and is sent for the business (/api/reviews/request/:jobId), and reviews come from Google Business (/api/gbp). Asking for a review is still marketing:create — a crew seat refused, a manager not.",
      heldBy: 'apps/unified/tests/roof-shared-modules.test.ts (as roofing: the crew seat refused, naming marketing:create; a manager past the guard) and tests/fieldservice/t30-debt-last-three.test.ts (request, schedule and follow-up gated, run on the unified app)',
    },
  },
  rv: {
    't59-website-lead-one-person.test.ts': {
      why: "Drives POST /api/webhooks/leads, the separate website's contact-form webhook (and its chat's phone-only, unitOfInterest posts). The website is the same app now; a dealership's enquiry goes straight into the sales pipeline (CrmSettings.websiteEnquiries 'pipeline', server/crm/rv/enquiry.ts), on the customer's existing contact by the same rule.",
      heldBy: "apps/unified/tests/rv-enquiry.test.ts (one contact and one sales lead at new; the same message again is the same lead; another question is a second lead on the same contact; a different name on a shared phone is a second person; the Lead Inbox on doesn't divert it) and apps/unified/tests/rv-chat-enquiry.test.ts (the chat's phone-only lead is taken; unitOfInterest is on the notes and its stock number links this dealer's unit, case aside; an unknown stock number links nothing and the enquiry is still taken)",
    },
  },
  vet: {
    't62-billed-visit-delete.test.ts': {
      assertions: [/cannot delete a visit billed on INV-\d+ \(409 visit_already_invoiced\)$/],
      why: "A refusal is { error, code } (RULEBOOK §3): the invoice that holds the visit is named by its number in the sentence; the template's reply also carried an invoiceId field, which the test reads (no screen did). Still a 409 with code visit_already_invoiced, for every role.",
      heldBy: 'tests/unified/vet/t62-billed-visit-delete.test.ts (the same file, reading the invoice number in the sentence)',
    },
    't59-website-enquiry-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-website-enquiry-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  basic: {
    't38-activity-routes-reachable.test.ts': {
      assertions: [
        /^…with activities and pagination/, /^…newest first/, /^…and the feed joins the person/, /^both of the owner's rows come back/,
        /^…including the one on a job/, /^…and it is NOT the entity-activity handler/, /^…with both rows on that job/,
        /^…and it is the joined query/, /^…as a comment thread/, /^…and an empty thread is still an empty array/,
      ],
      why: "The comment and activity reads are list replies ({ data, pagination }, RULEBOOK §3) with camelCase keys (firstName, RULEBOOK §2); the test reads bare arrays, { activities } and first_name.",
      heldBy: 'tests/unified/basic/t38-activity-routes-reachable.test.ts (the same file, reading .data and firstName: 18 of 18)',
    },
    't59-require-address.test.ts': BOOKINGS_REPLACED("basic's answer is not to ask for the address; the owner's switch and null hand it back", 'apps/unified/tests/vertical-booking-address.test.ts (basic: not asked by default, the owner switches it on, null hands it back; the trades ask)'),
    't59-new-leads-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-new-leads-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  landscaping: {
    't62-route-money.test.ts': {
      assertions: [/^the crew cannot SET a stop's price/],
      why: "A refusal names the wrong box in fields ({ fields: { pricePerVisit } }, RULEBOOK §3); the test reads the template's { field: 'pricePerVisit' }. Still a 403.",
      heldBy: 'tests/unified/landscaping/t62-route-money.test.ts (the same file, reading fields.pricePerVisit)',
    },
    't59-new-leads-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-new-leads-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  restaurant: {
    't62-event-money.test.ts': {
      assertions: [/^…with NO quotedTotal or depositRequired key, and moneyWithheld/],
      why: "GET /api/events is a list reply ({ data, pagination }, RULEBOOK §3) and carries no moneyWithheld beside it; the coordinator's rows still carry no quotedTotal or depositRequired (the same assertion's other half, and the no-figures check after it, pass). No screen read the flag on the list.",
      heldBy: 'tests/unified/restaurant/t62-event-money.test.ts (the same file without the list flag: the rows carry no quote or deposit)',
    },
    't59-website-enquiry-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-website-enquiry-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  fieldservice: {
    't30-search-money.test.ts': {
      assertions: [/^…and still returns the contact/, /^…with the contact and the job they need/],
      why: 'Quick search and Recent are list replies; the test reads a bare array or { results }.',
      heldBy: 'tests/unified/fieldservice/t30-search-money.test.ts',
    },
    't32-job-costing.test.ts': {
      assertions: [/^this template really has no vendor_bill table/, /^…and reconciles with the roll-up above it/],
      why: "The first asserts the template's own schema has no bills table (the unified schema has it for every vertical; with none recorded the costing is the same); the second reads by-category as a bare array.",
      heldBy: 'tests/unified/fieldservice/t32-job-costing.test.ts',
    },
    't30-booking-config.test.ts': BOOKINGS_REPLACED('booking setup is company:update, not a manager\'s', 'apps/unified/tests/booking-routes.test.ts (a manager runs the book but not the services or switches; bookings:settings is admin/owner)'),
    't30-deposit-hold.test.ts': BOOKINGS_REPLACED('an unpaid deposit hold is released past its window, by a direct booking too; a live one still blocks', 'apps/unified/tests/booking-engine.test.ts (a deposit holds the time as pending; unpaid past the hold the time is released — book() releases first; paid in time it becomes a booking)'),
    't58-booking-keeps-service-name.test.ts': BOOKINGS_REPLACED('a booking keeps what it was for in the owner\'s list', "apps/unified/tests/booking-engine.test.ts (the owner's list keeps what each booking was for)"),
    't58d-off-slot-wording.test.ts': BOOKINGS_REPLACED('a time that was never offered is refused as that, not as "no longer available"', 'apps/unified/tests/booking-engine.test.ts (each refusal says which thing is wrong: closed, not offered, taken, notice)'),
    't59-require-address.test.ts': BOOKINGS_REPLACED("asking for the address is the owner's switch, unset the vertical's", "apps/unified/tests/booking-engine.test.ts (asking for the address is the owner's switch; unset, it is the vertical's answer)"),
    't59-new-leads-inbox-on.test.ts': WEBHOOK_REPLACED,
    't59-new-leads-inbox-off.test.ts': WEBHOOK_REPLACED,
  },
  crm: {
    'calltracking-fields.test.ts': {
      assertions: [/^the tracking numbers answer/, /^a tracking number carries/, /^…its number, forward-to and call count/],
      why: 'GET /api/calltracking/numbers is a list reply, { data, pagination } (RULEBOOK §3); the test reads a bare array.',
      heldBy: 'tests/unified/crm/calltracking-fields.test.ts (the same file, reading .data)',
    },
    'quote-email.test.ts': {
      assertions: [
        /^…and never what a line costs us/,
        // The approve link (2026-10-22 live test: a customer without a client portal got a quote they could not accept).
        /^…and the customer's own portal page for this quote/, /^body: an approve button to the portal page/,
        /^plain-text version carries the lines and the link too/, /^sent \(200\), and the screen is told they cannot approve online/,
        /^they are told how to accept instead/, /^an expired portal link is not put in the email/, /^Client Portal switched off for the company: no link/,
      ],
      why: "The 210 check is not a difference in behaviour: it looks for the digits 210 (a line's cost) anywhere in the email's data, which also holds randomly made ids and links, so it fails whenever one of them happens to contain 210 (CI, 2026-10-19). The approve link IS a difference, on purpose (2026-10-22): every quote email carries the quote's own private link (/d/<token>, portal/documentLinks.ts) whether or not the customer has a client portal, so every customer can approve or decline — the template linked only a customer whose portal was on and in date, and told everyone else to reply or call. A template's schema has no public_token, so the templates keep their portal link.",
      heldBy: 'tests/unified/crm/quote-email.test.ts (the cost figures themselves, 210.00 and 30.00, and the unitCost field); apps/unified/tests/document-links.test.ts (19: every trade\'s email carries the link with no portal, approve with signature and audit, decline, expiry, one document only, Quotes off closes it)',
    },
    'comments-gate.test.ts': {
      assertions: [/^…and is the owner's/],
      why: "GET /api/comments/activity/feed is a list reply; its entries are data, not activities.",
      heldBy: 'tests/unified/crm/comments-gate.test.ts',
    },
    't32-job-costing.test.ts': {
      assertions: [/^the month the work completed/, /^…with the revenue the roll-up shows/, /^…and the cost the roll-up shows/, /^…so the By month table reconciles/, /^with no status filter, by month/, /^…and honours the status/],
      why: 'GET /api/job-costing/by-category is a list reply.',
      heldBy: 'tests/unified/crm/t32-job-costing.test.ts',
    },
    't32-po-commitment.test.ts': {
      assertions: [/^…naming the order, its total and what is left/, /^…and how much it is over by/, /^…and the way through/, /^…saying 600 is left of the 1,000/],
      why: 'A refusal is { error, code } (RULEBOOK §3): the over-billing figures and the way through are in its sentence, not extra fields.',
      heldBy: 'tests/unified/crm/t32-po-commitment.test.ts',
    },
    't32-site-records.test.ts': {
      assertions: [/^…and points at the one that exists/],
      why: 'A refusal carries a code, not the existing daily log\'s id (no screen read it).',
      heldBy: 'tests/unified/crm/t32-site-records.test.ts (asserts the code)',
    },
    't43-side-endpoints.test.ts': {
      assertions: [/^the crew seat reads the timeline/, /^…and it still says what happened/, /^…while who did it and which project survive/, /^the office seat DOES see the figure/, /^the owner gets the figure and the signing evidence/],
      why: 'GET /api/projects/:id/activity is a list reply.',
      heldBy: 'tests/unified/crm/t43-side-endpoints.test.ts',
    },
    't58-every-write-is-audited.test.ts': {
      assertions: [/^\/api\/[a-z-]+\/abc is the "[a-z_]+" entity/],
      why: "These call the template's own middleware/auditWrites.ts entityFromPath with a made-up last segment ('abc'). The unified app's write floor is the shared one (packages/tenant-backend audit/writeFloor.ts), which takes the segment after the collection only when it is an id; with a real id it names the entity, which the same file's other assertions prove on real writes.",
      heldBy: 'the same file\'s write assertions (48 pass), and apps/unified/tests/boot.test.ts (the write floor)',
    },
    't59-new-leads-inbox-on.test.ts': {
      why: "Drives POST /api/webhooks/leads, the separate website's contact-form webhook. In the unified app the website is the same app and its enquiry goes straight into the CRM's routing (server/core/enquiry.ts); the webhook is not moved (CUTOVER_LEDGER).",
      heldBy: 'apps/unified/tests/site-routes.test.ts (an enquiry with the Lead Inbox on lands in the inbox as new) and company-modules.test.ts',
    },
    't59-new-leads-inbox-off.test.ts': {
      why: 'Drives POST /api/webhooks/leads; see t59-new-leads-inbox-on.',
      heldBy: 'apps/unified/tests/site-routes.test.ts (an enquiry with the Lead Inbox off is saved as a lead contact)',
    },
  },
}
