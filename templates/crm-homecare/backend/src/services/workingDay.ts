// The agency's default working day: what a day marked "available" with no times means, and the hours a new
// caregiver's week is created with. One value for every reader — the portal's reschedule slots, the Roster and
// Schedule optimizers and the default availability row. (Until 10/16 the slots used 17:00 and both optimizers
// 18:00, so the optimizer could place a visit the portal would never offer.)
export const DEFAULT_WORKING_DAY = { start: '08:00', end: '17:00' } as const
