// Browser sessions held in cookies the page's scripts can't read (SPEC §5.3: httpOnly + Secure + SameSite=Strict).
//
// A client asks for this by sending `X-Auth-Mode: cookie`. Then sign-in sets the access and refresh tokens as
// cookies and leaves them out of the reply, so script on the page — including injected script — never holds a
// credential. Without the header nothing changes: the reply carries the tokens as before, which is what the mobile
// app and every CRM template's screens use.
//
// Cross-site requests: SameSite=Strict keeps the browser from sending these cookies from another site at all. As a
// second wall, a request that changes something and is signed in only by the cookie must also carry the header —
// another site can't add a custom header without the browser asking permission first (a CORS preflight).
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

export const AUTH_MODE_HEADER = 'X-Auth-Mode'
export const ACCESS_COOKIE = 'tw_access'
export const REFRESH_COOKIE = 'tw_refresh'
/**
 * "View As" in a cookie-session browser: the short-lived, read-only session an office opens AS someone else (home
 * care's POST /api/auth/impersonate/:userId). Kept apart from the person's own session, which stays as it was beneath
 * it: while this cookie is there every request is the viewed person's; clearing it is Exit, back to their own. Like the
 * session cookies, script on the page can't read it — a View As never puts a credential where injected script could
 * take it.
 */
export const VIEW_AS_COOKIE = 'tw_view_as'
/** The refresh cookie goes only to the session routes, never with an ordinary request. */
const REFRESH_PATH = '/api/auth'
const ACCESS_MAX_AGE = 15 * 60
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60
/** A desktop page opened from the phone app: 2 hours, matching WEB_REFRESH_TTL in auth.ts. */
const WEB_REFRESH_MAX_AGE = 2 * 60 * 60

/** Did this client ask for its session in cookies? */
export const wantsCookieSession = (c: Context): boolean => (c.req.header(AUTH_MODE_HEADER) || '').toLowerCase() === 'cookie'

const secure = () => process.env.NODE_ENV === 'production'

export function setSessionCookies(c: Context, tokens: { accessToken: string; refreshToken?: string }, opts: { webSession?: boolean } = {}): void {
  setCookie(c, ACCESS_COOKIE, tokens.accessToken, { httpOnly: true, secure: secure(), sameSite: 'Strict', path: '/', maxAge: ACCESS_MAX_AGE })
  if (tokens.refreshToken) setCookie(c, REFRESH_COOKIE, tokens.refreshToken, { httpOnly: true, secure: secure(), sameSite: 'Strict', path: REFRESH_PATH, maxAge: opts.webSession ? WEB_REFRESH_MAX_AGE : REFRESH_MAX_AGE })
}

export function clearSessionCookies(c: Context): void {
  deleteCookie(c, ACCESS_COOKIE, { path: '/', secure: secure(), sameSite: 'Strict' })
  deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_PATH, secure: secure(), sameSite: 'Strict' })
}

/** Start a View As: the cookie lives `maxAgeSeconds`, which the caller keeps inside the token's own life. */
export function setViewAsCookie(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, VIEW_AS_COOKIE, token, { httpOnly: true, secure: secure(), sameSite: 'Strict', path: '/', maxAge: Math.max(0, Math.floor(maxAgeSeconds)) })
}

/** End a View As (the person's own session is untouched). */
export function clearViewAsCookie(c: Context): void {
  deleteCookie(c, VIEW_AS_COOKIE, { path: '/', secure: secure(), sameSite: 'Strict' })
}

export const viewAsCookie = (c: Context): string | undefined => getCookie(c, VIEW_AS_COOKIE) || undefined
export const accessCookie = (c: Context): string | undefined => getCookie(c, ACCESS_COOKIE) || undefined
export const refreshCookie = (c: Context): string | undefined => getCookie(c, REFRESH_COOKIE) || undefined

/**
 * A sign-in reply: the tokens in cookies for a cookie-session client (and left out of the body), in the body for
 * everyone else, exactly as before.
 */
export function withSession<T extends Record<string, unknown>>(c: Context, body: T, tokens: { accessToken: string; refreshToken: string }): T | (T & { accessToken: string; refreshToken: string }) {
  if (!wantsCookieSession(c)) return { ...body, ...tokens }
  setSessionCookies(c, tokens)
  return body
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The access token for this request and where it came from: the Authorization header (the mobile app, the
 * templates, scripts), else a View As cookie, else the session cookie. A cookie-signed change without the header is
 * refused (see the top).
 */
export function requestToken(c: Context): { token: string; via: 'header' | 'cookie' | 'view-as' } | { refused: string } | null {
  const header = c.req.header('authorization')
  if (header?.startsWith('Bearer ')) return { token: header.split(' ')[1], via: 'header' }
  const viewAs = viewAsCookie(c)
  const cookie = viewAs || accessCookie(c)
  if (!cookie) return null
  if (MUTATING.has(c.req.method) && !wantsCookieSession(c)) return { refused: 'This request needs the X-Auth-Mode header.' }
  return { token: cookie, via: viewAs ? 'view-as' : 'cookie' }
}
