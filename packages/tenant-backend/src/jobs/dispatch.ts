// WHO IS ON A JOB AND WHEN IT IS — the office's, not the technician's. (HVAC live role test 2026-10-24)
//
// `field` holds jobs:update so a technician can run their own work: move it along its statuses, add notes and photos,
// tick the checklist. The same right let one PUT their job onto somebody else (it then dropped out of their view) and
// move its day. The assignee and the schedule's date and time need `jobs:dispatch`: managers and admins hold it through
// jobs:*, the owner through '*', field and viewer do not. Every job vertical's writer asks it — the shared job routes
// (./jobs.ts), roofing's own (apps/unified server/crm/roof/jobs.ts), the day re-time and the bulk job tools — and the
// screens ask the same word before offering the pickers.
export const JOB_DISPATCH_PERMISSION = 'jobs:dispatch'

const WORDS: Record<string, string> = {
  assignedToId: 'who it is assigned to', assignedToMemberId: 'who it is assigned to', otherAssigneeIds: 'who else is on it',
  assignedSalesRepId: 'the sales rep', assignedCrewId: 'the crew', scheduledDate: 'the scheduled date', scheduledTime: 'the scheduled time',
  inspectionDate: 'the inspection date', installDate: 'the install date', installEndDate: 'the install end date',
}

/** The 403 for a seat without jobs:dispatch that changed any of `fields` (each named, so the form can say which). */
export function dispatchRefusal(c: any, fields: string[], word = 'job') {
  const said = [...new Set(fields.map((f) => WORDS[f] || f))]
  return c.json({
    error: `Changing ${said.join(' or ')} on a ${word} is the office's. Ask a manager to change it.`,
    code: 'job_dispatch_not_permitted',
    fields,
    required: JOB_DISPATCH_PERMISSION,
  }, 403)
}
