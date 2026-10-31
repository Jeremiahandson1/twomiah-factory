// Toast, read-only, for the tips a venue took on ITS OWN Toast register (restaurant-bar parity #17).
//
// What this file knows, and where it comes from (Toast's developer pages, read 2026-10):
//   · Login: POST https://<toast api host>/authentication/v1/authentication/login with { clientId, clientSecret, userAccessType:
//     'TOAST_MACHINE_CLIENT' } answers { token: { accessToken, tokenType: 'Bearer', expiresIn } }.
//   · Every other call carries Authorization: Bearer <token> and Toast-Restaurant-External-ID: <the restaurant's GUID>.
//   · GET /orders/v2/ordersBulk?businessDate=yyyymmdd&page=&pageSize= (page size up to 100) answers orders, each with checks[], each
//     with payments[] carrying tipAmount, paymentStatus, voidInfo, refundStatus and server { guid }. Orders and checks carry
//     voided / deleted.
//   · GET /labor/v1/employees answers guid, firstName, lastName, chosenName, email, deleted.
//   · The credentials are made by the venue in Toast Web (Integrations > Toast API access > Manage credentials > Create new
//     credentials > Standard API, read-only, scopes orders:read and labor.employees:read).
// NOT confirmed from a page that could be read: Toast's production API hostname (the pages show a placeholder), so the venue types the
// host Toast gave it and we accept only *.toasttab.com; the exact list of paymentStatus words (we drop payments that are voided,
// denied or fully refunded and keep the rest); and that amounts are in dollars (Toast's order samples show decimals, so tipAmount is
// read as dollars and rounded to whole cents).
import { ProviderError, type FetchLike, type ProviderStaff } from './squareTips'

export interface ToastCredentials { host: string; clientId: string; clientSecret: string; restaurantGuid: string; fetch?: FetchLike }
const doFetch = (c: { fetch?: FetchLike }): FetchLike => c.fetch ?? ((u, i) => fetch(u, i))

/** The host the venue typed, as a bare lowercase hostname under toasttab.com; null when it is anything else (the server will not call an address the venue made up). */
export function cleanToastHost(raw: unknown): string | null {
  const h = String(raw ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '')
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.toasttab\.com$/.test(h) ? h : null
}

async function body(res: Response): Promise<any> { try { return await res.json() } catch { return {} } }

export interface ToastToken { accessToken: string; expiresAt: string }

export async function toastLogin(c: ToastCredentials): Promise<ToastToken> {
  const res = await doFetch(c)(`https://${c.host}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
  })
  const j = await body(res)
  const t = j?.token
  if (!res.ok || !t?.accessToken) {
    throw new ProviderError(res.status === 401 || res.status === 403 || res.status === 400
      ? 'Toast did not accept that client ID and secret. Check them in Toast Web under Integrations, Toast API access.'
      : `Toast could not be reached (it answered ${res.status}).`, res.status === 401 || res.status === 403 || res.status === 400 ? 'auth' : 'other')
  }
  return { accessToken: String(t.accessToken), expiresAt: new Date(Date.now() + Number(t.expiresIn || 3600) * 1000).toISOString() }
}

async function call(c: ToastCredentials, accessToken: string, path: string): Promise<any> {
  const res = await doFetch(c)(`https://${c.host}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Toast-Restaurant-External-ID': c.restaurantGuid } })
  const j = await body(res)
  if (res.status === 401 || res.status === 403) throw new ProviderError('Toast says this connection is no longer allowed. Check the credentials in Toast Web and connect again.', 'auth')
  if (!res.ok) throw new ProviderError(`Toast could not be read (it answered ${res.status}).`)
  return j
}

export interface ToastTip { id: string; tipCents: number; staffId: string | null; paidAt: Date }

const DROPPED = new Set(['VOIDED', 'DENIED', 'CANCELLED', 'CANCELED', 'ERROR'])

/** Tips on the payments of one Toast business date (yyyy-mm-dd), skipping voided and deleted orders and checks, voided or denied payments and fully refunded ones. */
export async function toastTips(c: ToastCredentials, accessToken: string, day: string): Promise<ToastTip[]> {
  const date = day.replace(/-/g, '')
  const out: ToastTip[] = []
  for (let page = 1; page <= 200; page++) {
    const j = await call(c, accessToken, `/orders/v2/ordersBulk?businessDate=${date}&page=${page}&pageSize=100`)
    const orders: any[] = Array.isArray(j) ? j : []
    for (const o of orders) {
      if (o?.voided || o?.deleted) continue
      for (const ck of Array.isArray(o.checks) ? o.checks : []) {
        if (ck?.voided || ck?.deleted) continue
        for (const p of Array.isArray(ck.payments) ? ck.payments : []) {
          if (p?.voidInfo || DROPPED.has(String(p?.paymentStatus || '').toUpperCase()) || String(p?.refundStatus || '').toUpperCase() === 'FULL') continue
          const cents = Math.round(Number(p?.tipAmount) * 100)
          if (!Number.isFinite(cents) || cents <= 0 || !p?.guid) continue
          const at = new Date(p.paidDate || ck.closedDate || o.closedDate || o.paidDate || `${day}T12:00:00Z`)
          out.push({ id: String(p.guid), tipCents: cents, staffId: p.server?.guid ? String(p.server.guid) : o.server?.guid ? String(o.server.guid) : null, paidAt: Number.isNaN(at.getTime()) ? new Date(`${day}T12:00:00Z`) : at })
        }
      }
    }
    if (orders.length < 100) return out
  }
  throw new ProviderError('Toast returned more pages of orders than one day can have.')
}

export async function toastStaff(c: ToastCredentials, accessToken: string): Promise<ProviderStaff[]> {
  const j = await call(c, accessToken, '/labor/v1/employees')
  return (Array.isArray(j) ? j : []).filter((e: any) => e && !e.deleted && e.guid).map((e: any) => ({
    id: String(e.guid),
    name: String(e.chosenName || [e.firstName, e.lastName].filter(Boolean).join(' ') || e.email || e.guid).trim(),
    email: e.email ? String(e.email) : null,
  }))
}
