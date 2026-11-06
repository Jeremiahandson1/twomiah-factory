// How the client and family portals reach the server. Their visitors have no staff session: each portal signs its own
// people in and keeps its own token in localStorage, as the template did (App.tsx PortalApp / FamilyApp): the client
// portal's 'portal_token', the family portal's 'family_token'. Every portal request carries it as a Bearer token, which
// is exactly what the server reads (server/crm/homecare/portals/clientPortal.ts createPortalAuth: the Authorization
// header's JWT with role 'client'; familyPortal.ts familyAuth: role 'family'). The app's own client (../lib/http api)
// is NOT used here: it sends the staff session's cookies, refreshes a staff session on a 401 and sends a 402 to the
// staff lock page, none of which is right for a relative.
//
// The template's rules (config.ts apiCall + services/sessionFetch.ts rule 4), kept:
//   · a token past its expiry ends the portal session before the request goes; a 401 ends it too;
//   · a 402 ACCOUNT_LOCKED (core/portalLock.ts: the agency is cancelled; the reply is { error, code }) shows the
//     portal's "paused" page instead of a page of failed loads;
//   · a 429 answers null, so a poll that was throttled leaves the screen as it was;
//   · any other refusal is thrown as an Error carrying the server's sentence.
import { createContext, useContext } from 'react'
import { api } from '../lib/http'
import { money as formatMoney } from '@twomiah/tenant-ui/src/money'

/** The address the API lives at (the app's client's: VITE_API_URL, or this origin). */
const base = (): string => api.baseUrl

/** The agency's name, which the server writes into the page (server/http/adminScreens.ts, meta company-name). */
export function agencyNameFromPage(): string {
  if (typeof document === 'undefined') return ''
  return document.querySelector('meta[name="company-name"]')?.getAttribute('content') || ''
}

/** A JWT's claims, read (not verified — the server verifies). null when it isn't one. */
export function tokenClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null
  try {
    const part = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')
    const claims: unknown = JSON.parse(atob(part))
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Past its expiry (or unreadable)? */
export function tokenExpired(token: string): boolean {
  const claims = tokenClaims(token)
  if (!claims) return true
  return typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()
}

/** The storage the portals keep their sign-in in; a browser that refuses storage keeps nothing. */
export const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  remove: (k: string): void => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

export const SESSION_EXPIRED = 'SESSION_EXPIRED'

async function errorOf(res: Response): Promise<{ message: string; code?: string }> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: string; code?: string }
    return { message: body?.error || text || `Error ${res.status}`, code: body?.code }
  } catch {
    return { message: text || `Error ${res.status}` }
  }
}

export interface PortalHooks {
  /** The session has ended (expired, or refused 401): sign out. */
  expired(): void
  /** The agency's account is paused (402 ACCOUNT_LOCKED). */
  paused(): void
}

export interface PortalClient {
  /** GET, the reply's JSON (null on a 429). */
  get<T>(path: string): Promise<T | null>
  /** POST / PUT with a JSON body, the reply's JSON (null on a 429). */
  send<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T | null>
  /** A file the server sends (an invoice PDF). */
  blob(path: string): Promise<Blob>
  /** DELETE, the reply's JSON (null on a 429). */
  del<T>(path: string): Promise<T | null>
}

/** A client that signs every request with this portal's token. */
export function createPortalClient(token: string, hooks: PortalHooks): PortalClient {
  async function raw(path: string, init: RequestInit = {}): Promise<Response | null> {
    if (tokenExpired(token)) {
      hooks.expired()
      throw new Error(SESSION_EXPIRED)
    }
    const res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      hooks.expired()
      throw new Error(SESSION_EXPIRED)
    }
    if (res.status === 429) return null
    if (!res.ok) {
      const { message, code } = await errorOf(res)
      if (res.status === 402 && code === 'ACCOUNT_LOCKED') hooks.paused()
      throw new Error(message)
    }
    return res
  }
  return {
    async get<T>(path: string) {
      const res = await raw(path)
      return res ? ((await res.json()) as T) : null
    },
    async send<T>(method: 'POST' | 'PUT', path: string, body?: unknown) {
      const res = await raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
      return res ? ((await res.json()) as T) : null
    },
    async blob(path: string) {
      const res = await raw(path)
      if (!res) throw new Error('The server is busy. Please try again in a moment.')
      return res.blob()
    },
    async del<T>(path: string) {
      const res = await raw(path, { method: 'DELETE' })
      return res ? ((await res.json()) as T) : null
    },
  }
}

/** A request with no portal session yet (signing in, the emailed link, setting a password, the pay page). */
export async function publicCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T; error: string }> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  return { ok: res.ok, status: res.status, data, error: (data as { error?: string })?.error || '' }
}

/** The signed-in portal's client, for every screen inside it. */
export const PortalContext = createContext<PortalClient | null>(null)

export function usePortal(): PortalClient {
  const client = useContext(PortalContext)
  if (!client) throw new Error('usePortal outside a portal')
  return client
}

/** The rows of a list reply ({ data, pagination }); [] for anything else. */
export function listRows<T>(reply: unknown): T[] {
  const data = (reply as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/** A money figure as the template printed it ($1234.50). Postgres numerics arrive as strings. */
export function money(amount: unknown): string {
  if (amount == null) return '—'
  return `${formatMoney((parseFloat(String(amount)) || 0))}`
}
