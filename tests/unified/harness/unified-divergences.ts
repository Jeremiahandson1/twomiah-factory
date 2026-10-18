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

export const UNIFIED_DIVERGENCES: Record<string, Record<string, Divergence>> = {
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
