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

export const UNIFIED_DIVERGENCES: Record<string, Record<string, Divergence>> = {
  // Home care (tests/homecare, run by harness/homecare.ts). Each route group adds the entries for the files it owns,
  // under its own comment, with one entry per file (a second key with the same name silently replaces the first).
  homecare: {
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
  rv: {
    't59-website-lead-one-person.test.ts': {
      why: "Drives POST /api/webhooks/leads, the separate website's contact-form webhook (and its chat's phone-only, unitOfInterest posts). The website is the same app now; a dealership's enquiry goes straight into the sales pipeline (CrmSettings.websiteEnquiries 'pipeline', server/crm/rv/enquiry.ts), on the customer's existing contact by the same rule.",
      heldBy: "apps/unified/tests/rv-enquiry.test.ts (one contact and one sales lead at new; the same message again is the same lead; another question is a second lead on the same contact; a different name on a shared phone is a second person; the Lead Inbox on doesn't divert it)",
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
