// WHO CAN BE GIVEN WORK — a job assigned, a booking taken, hours to be booked against.
//
// A login can, unless its seat is view-only or it has been switched off: a viewer cannot start a job, log time against it or
// complete it, so work given to that seat sits there until somebody notices (T42 "viewer offered as a technician in
// Dispatch"; landscaping live test 2026-10-22, "a viewer is listed as a bookable person"). An owner, an admin and a manager
// all turn out on jobs in a small shop, so only the view-only seat is left out.
//
// One rule for the job pickers (GET /api/team/assignable) and online booking (apps/unified server/booking/engine.ts). The
// screens hold the same rule in packages/tenant-ui/src/people/work.ts; apps/unified/tests/trade-screens-1023.test.ts keeps
// the two equal.
export const NOT_GIVEN_WORK_ROLES = ['viewer'] as const

export function mayBeGivenWork(u: { role?: string | null; isActive?: boolean | null }): boolean {
  return u.isActive !== false && !(NOT_GIVEN_WORK_ROLES as readonly string[]).includes(String(u.role ?? ''))
}
