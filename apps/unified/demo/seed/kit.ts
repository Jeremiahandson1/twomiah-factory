// What every trade's seed shares: a sample business on a real (in-memory) server, signed in as its owner, and a way to add
// records through the server's OWN routes — so every row is one the real server would make, in its real shape, with its
// real rules (numbering, totals, statuses). Direct database inserts are used only where a table has no route.
import { getFeaturesForTemplate, withinOffer, withoutNotReady } from '@twomiah/tenant-backend'
import { bootTenant } from '../../tests/harness.ts'
import { loadVertical } from '../../server/core/vertical.ts'
import type { DemoTrade } from '../trades.ts'

export type Tenant = Awaited<ReturnType<typeof bootTenant>>

/** The sample business's own clock: the demo is a Midwest business, so its days are Central days. */
export const DEMO_ZONE = 'America/Chicago'

export interface Kit {
  t: Tenant
  trade: DemoTrade
  companyId: string
  ownerId: string
  /** The signed-in owner's request headers. */
  headers: Record<string, string>
  /** The owner's sign-in, for a browser that signs in itself (scripts/discover-demo-routes.ts). */
  login: { email: string; password: string }
  /** A call on the real server, as the owner. Throws, with the server's own words, on anything but a 2xx. */
  api: (method: string, path: string, json?: unknown) => Promise<any>
  get: (path: string) => Promise<any>
  post: (path: string, json?: unknown) => Promise<any>
  put: (path: string, json?: unknown) => Promise<any>
  patch: (path: string, json?: unknown) => Promise<any>
  /** A day on the business's calendar, `offset` days from today: YYYY-MM-DD. */
  day: (offset?: number) => string
  /** A moment on the business's clock: day offset, then 'HH:MM' — as an ISO instant. */
  at: (offset: number, hhmm: string) => string
  /** Today on the business's calendar. */
  today: string
  /** Adds a login (a team member) directly: the route that invites one sends an email. */
  addUser: (u: { email: string; firstName: string; lastName: string; role: string; phone?: string; hourlyRate?: string }) => Promise<{ id: string }>
}

/** The calendar day in a zone, as YYYY-MM-DD. */
export function dayIn(zone: string, date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  return p
}

/** The UTC offset (minutes) a zone has at an instant. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((x) => x.type === t)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export async function bootDemoTenant(trade: DemoTrade, adminDist: string): Promise<Kit> {
  const t = await bootTenant({ vertical: trade.vertical, adminDist })
  const S = t.schema
  const slug = trade.id
  const vertical = await loadVertical(trade.vertical)
  const enabled = withinOffer(vertical.featureSet, withoutNotReady(getFeaturesForTemplate(vertical.featureSet).map((f: { id: string }) => f.id)))

  const password = 'Demo-sample-1'
  const [co] = await t.db.insert(S.company).values({
    name: trade.business, slug, email: `office@${slug}.example`, phone: '(715) 555-0142', address: '1200 Sample Street', city: 'Eau Claire', state: 'WI', zip: '54701',
    primaryColor: trade.primaryColor, enabledFeatures: enabled, timezone: DEMO_ZONE, onboardingCompletedAt: new Date(), settings: { onboardingComplete: true },
  } as any).returning()
  const [owner] = await t.db.insert(S.user).values({
    email: `owner@${slug}.example`, passwordHash: await Bun.password.hash(password, 'bcrypt'), firstName: 'Casey', lastName: 'Sample', role: 'owner', companyId: co.id, phone: '(715) 555-0100',
  } as any).returning()

  const login = await t.call('/api/auth/login', { method: 'POST', json: { email: `owner@${slug}.example`, password } })
  const session: any = await login.json()
  if (!session.accessToken) throw new Error(`demo sign-in failed for ${trade.id}: ${JSON.stringify(session)}`)
  const headers = { Authorization: `Bearer ${session.accessToken}` }

  const api: Kit['api'] = async (method, path, json) => {
    const res = await t.call(path, { method, headers, ...(json !== undefined ? { json } : {}) })
    const text = await res.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (res.status < 200 || res.status >= 300) throw new Error(`${trade.id}: ${method} ${path} → ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    return body
  }
  const today = dayIn(DEMO_ZONE)
  return {
    t, trade, companyId: co.id, ownerId: owner.id, headers, api, login: { email: `owner@${slug}.example`, password },
    get: (p) => api('GET', p), post: (p, j) => api('POST', p, j ?? {}), put: (p, j) => api('PUT', p, j ?? {}), patch: (p, j) => api('PATCH', p, j ?? {}),
    today,
    day: (offset = 0) => addDays(today, offset),
    at: (offset, hhmm) => {
      const day = addDays(today, offset)
      const guess = new Date(`${day}T${hhmm}:00Z`)
      const off = offsetMinutes(DEMO_ZONE, guess)
      return new Date(guess.getTime() - off * 60_000).toISOString()
    },
    addUser: async (u) => {
      const [row] = await t.db.insert(S.user).values({
        email: u.email, passwordHash: await Bun.password.hash(password, 'bcrypt'), firstName: u.firstName, lastName: u.lastName, role: u.role, companyId: co.id,
        phone: u.phone ?? null, ...(u.hourlyRate ? { hourlyRate: u.hourlyRate } : {}),
      } as any).returning()
      return { id: row.id }
    },
  }
}

