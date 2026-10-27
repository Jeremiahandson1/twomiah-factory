/**
 * Where a `?returnTo=` may send the person back to: a path inside this app, nothing else. react-router's navigate() and
 * <Link> treat a backslash after the slash ("/\evil.example") the way a browser does, as a host — an open redirect (the
 * advisory behind react-router 6 → 7.18). A link in an email or a chat that carries returnTo is the way in, so the value
 * is checked where it is read, whichever router version is installed. Anything else: null, and the caller stays put.
 */
export function safeReturnPath(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2000) return null
  if (!v.startsWith('/') || v.startsWith('//')) return null
  if (/[\\\u0000-\u001f]/.test(v)) return null
  // a scheme or host smuggled after the slash ("/%5Cevil", "/\t/evil") is not a path either
  if (/^\/(?:%5c|%2f|%09|%0a|%0d)/i.test(v)) return null
  return v
}
