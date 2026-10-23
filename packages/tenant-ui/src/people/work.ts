// WHO CAN BE GIVEN WORK, on the screens: the rule packages/tenant-backend/src/team/work.ts holds on the server (a job
// assigned, a booking taken). A view-only seat or a switched-off login is never offered. The two are kept equal by
// apps/unified/tests/trade-screens-1023.test.ts.
export const NOT_GIVEN_WORK_ROLES = ['viewer'] as const

export function mayBeGivenWork(u: { role?: string | null; isActive?: boolean | null }): boolean {
  return u.isActive !== false && !(NOT_GIVEN_WORK_ROLES as readonly string[]).includes(String(u.role ?? ''))
}
