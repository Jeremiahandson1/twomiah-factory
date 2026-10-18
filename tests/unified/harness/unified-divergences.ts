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
