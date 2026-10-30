// A few screens READ with a POST (the request carries a date range or a set of options): a payroll calculation, a report.
// They change nothing, so the demo answers them from the recorded data like any read. Which POSTs those are is named here, once,
// for the walk that finds them (scripts/discover-demo-routes.ts); the demo itself answers any POST it has a recorded answer for.
export const POST_READS = [/^\/api\/payroll\/calculate$/, /^\/api\/reports\/[a-z-]+$/]
export const isPostRead = (pathname: string): boolean => POST_READS.some((re) => re.test(pathname))
