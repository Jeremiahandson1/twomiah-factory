// How a request is named in the recorded data. Shared by the recorder (scripts/record-demo.ts, which writes the names) and
// the in-browser backend (which looks them up), so the two cannot disagree: "GET /api/jobs?limit=50&page=1" — the method,
// the path without a trailing slash, the query sorted by name.
export function canonicalKey(method: string, pathname: string, params: URLSearchParams | Record<string, string | undefined>): string {
  const entries: Array<[string, string]> = []
  if (params instanceof URLSearchParams) params.forEach((v, k) => entries.push([k, v]))
  else for (const [k, v] of Object.entries(params)) if (v !== undefined) entries.push([k, v])
  entries.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
  const q = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const path = pathname.replace(/\/+$/, '') || '/'
  return `${method.toUpperCase()} ${path}${q ? '?' + q : ''}`
}

/** A path segment that is a record's id (a cuid, a uuid, a number) and not a word of the route. */
export const looksLikeId = (seg: string): boolean => /^[a-z0-9]{20,32}$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(seg) || /^demo-\d+$/.test(seg)

/** The route as a template: every id segment becomes ":id" ("/api/jobs/abc…/notes" → "/api/jobs/:id/notes"). */
export const templateOf = (pathname: string): string => pathname.split('/').map((s) => (looksLikeId(s) ? ':id' : s)).join('/')
