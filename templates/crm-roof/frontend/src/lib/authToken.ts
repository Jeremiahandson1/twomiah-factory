// The one place the session's tokens live.
//
// Roof had two keys for one token. AuthContext wrote `token` on login and on every 12-minute refresh;
// ApiClient read `accessToken`, which nothing kept current — so it held whatever an old session had
// left behind, and a tester found it 5.6 days stale and 401ing. Two names for one thing is not a
// naming problem; it is two sources of truth, and one of them is always wrong.
//
// `accessToken` is the survivor because it is what the shared tenant-ui AuthContext uses and what the
// other eight templates read. Roof was the outlier.
//
// Reading also MIGRATES: a browser holding the old `token` is moved across on first read rather than
// being signed out, so shipping this does not log everyone out.

const ACCESS = 'accessToken'
const REFRESH = 'refreshToken'
/** what roof's own AuthContext used to write; read once, then moved to ACCESS */
const LEGACY_ACCESS = 'token'

/** localStorage throws in some embedded/private contexts — a token read must never take the app down */
const read = (k: string): string => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* nothing to do */ } }
const drop = (k: string) => { try { localStorage.removeItem(k) } catch { /* nothing to do */ } }

export function getAccessToken(): string {
  const current = read(ACCESS)
  if (current) return current
  const legacy = read(LEGACY_ACCESS)
  if (legacy) { write(ACCESS, legacy); drop(LEGACY_ACCESS); return legacy }
  return ''
}

export function getRefreshToken(): string {
  return read(REFRESH)
}

export function setTokens(accessToken: string, refreshToken?: string): void {
  if (accessToken) write(ACCESS, accessToken)
  if (refreshToken) write(REFRESH, refreshToken)
  // a login or refresh retires the old key for good
  drop(LEGACY_ACCESS)
}

export function clearTokens(): void {
  drop(ACCESS)
  drop(REFRESH)
  drop(LEGACY_ACCESS)
}

/** the Authorization header, or nothing at all when there is no session */
export function authHeader(): Record<string, string> {
  const t = getAccessToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}
