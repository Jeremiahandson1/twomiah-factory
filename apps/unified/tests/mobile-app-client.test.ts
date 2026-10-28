// The phone app's OWN code against the real unified server, over real HTTP — for every trade the app supports
// (verticals.ts PHONE_VERTICALS) and the trades it turns away.
//
// Not a second copy of mobile-trades / mobile-homecare / mobile-rv (those check each screen's request and the fields it
// reads). This runs the app's real modules: src/api/client.ts (token store, refresh), src/auth/signIn.ts, src/vertical/*
// (detectVertical, the tabs, which of them this seat sees), src/api/download.ts (the quote/invoice PDF link), src/care/careApi.ts
// (the caregiver's requests) — with only the phone's native pieces replaced (SecureStore by a Map, Linking by a recorder).
// Each tenant is served with Bun.serve, so the app's fetch() is a real request, with real headers, bodies and multipart.
//
// Part one is static: every /api path the app's source names is a route the server has (a screen can't call a path that was
// renamed or removed without this failing). Part two drives each trade. What cannot be shown without a phone is in
// apps/mobile/store/READY.md.
import { plugin } from 'bun'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

// ── the phone, replaced where it is native ──────────────────────────────────────────────────────────────────
const secure = new Map<string, string>()
const kv = new Map<string, string>() // AsyncStorage
const opened: string[] = []
plugin({
  name: 'phone natives',
  setup(build) {
    build.module('expo-secure-store', () => ({
      loader: 'object',
      exports: {
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
        getItemAsync: async (k: string) => secure.get(k) ?? null,
        setItemAsync: async (k: string, v: string) => { if (typeof v !== 'string') throw new Error(`SecureStore ${k}: not a string`); secure.set(k, v) },
        deleteItemAsync: async (k: string) => { secure.delete(k) },
      },
    }))
    build.module('@react-native-async-storage/async-storage', () => ({ loader: 'object', exports: { default: { getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => { kv.set(k, v) }, removeItem: async (k: string) => { kv.delete(k) } } } }))
    build.module('react-native', () => ({ loader: 'object', exports: { Linking: { openURL: async (u: string) => { opened.push(u) } } } }))
  },
})

const MOBILE = path.resolve(import.meta.dir, '../../mobile')
const app = {
  client: await import('../../mobile/src/api/client.ts'),
  signIn: await import('../../mobile/src/auth/signIn.ts'),
  verticals: await import('../../mobile/src/vertical/verticals.ts'),
  detect: await import('../../mobile/src/vertical/detectVertical.ts'),
  roles: await import('../../mobile/src/auth/roles.ts'),
  download: await import('../../mobile/src/api/download.ts'),
  care: await import('../../mobile/src/care/careApi.ts'),
  push: await import('../../mobile/src/hooks/pushToken.ts'),
}
const { get, post, put, upload, saveTokens, getAccessToken, clearTokens } = app.client
const { PHONE_VERTICALS, VERTICAL_TABS, visibleTabs, webSignInUrl } = app.verticals

const PASS = 'Seat-pass-1'
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer()
const pad = (n: number) => String(n).padStart(2, '0')
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` })()

// ── part one: every path the app names is a route the server has ────────────────────────────────────────────
function appSources(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) out.push({ file: path.relative(MOBILE, p), code: fs.readFileSync(p, 'utf8') })
    }
  }
  walk(path.join(MOBILE, 'app')); walk(path.join(MOBILE, 'src'))
  return out
}
/** The /api paths in the app's CODE (string and template literals — not comments), methods where the call names one. */
function apiPathsUsed() {
  const found = new Map<string, Set<string>>()
  for (const { file, code } of appSources()) {
    const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const m of noComments.matchAll(/([A-Za-z]+)?\s*(?:<[^>(]*>)?\(?\s*([`'"])(\/api\/[^`'"]*)\2/g)) {
      const raw = m[3].replace(/\$\{[^}]*\}/g, ':p').replace(/\?.*$/, '')
      const fn = (m[1] || '').toLowerCase()
      const method = /^(get|careget|careretry|loadtokens)$/.test(fn) || fn === 'careget' ? 'GET' : /^(post|carepost|postsignin|upload)$/.test(fn) ? 'POST' : /^(put|careput)$/.test(fn) ? 'PUT' : /^(del)$/.test(fn) ? 'DELETE' : /^carepatch$/.test(fn) ? 'PATCH' : ''
      const key = (method || '?') + ' ' + raw
      if (!found.has(key)) found.set(key, new Set())
      found.get(key)!.add(file)
    }
  }
  return found
}
const segMatch = (route: string, used: string) => {
  const r = route.split('/'), u = used.split('/')
  if (r.length !== u.length) return false
  return r.every((seg, i) => seg === u[i] || seg.startsWith(':') || u[i] === ':p')
}

// ── a tenant per trade, served over HTTP ────────────────────────────────────────────────────────────────────
type Tenant = Awaited<ReturnType<typeof bootTenant>>
interface Site { t: Tenant; url: string; stop: () => void; companyId: string; ownerPassword: string; routes: Array<{ method: string; path: string }>; fieldId: string }
const sites: Record<string, Site> = {}

async function serve(vertical: string, features: string[]): Promise<Site> {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  // The server's file storage is R2, which a test never reaches; the in-memory store stands in (as mobile-trades does).
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  const [field] = await t.db.insert(t.schema.user).values({ email: 'field@test.example', passwordHash: await Bun.password.hash(PASS, 'bcrypt'), firstName: 'Fin', lastName: 'Field', role: 'field', companyId: s.company.id } as any).returning()
  const server = Bun.serve({ port: 0, fetch: (req) => t.app.fetch(req) })
  return { t, url: `http://localhost:${server.port}`, stop: () => server.stop(true), companyId: s.company.id, ownerPassword: s.password, routes: (t.app as any).routes, fieldId: field.id }
}

/** Sign in as the phone does: the real sign-in, then what AuthContext does with the reply. */
async function signInAs(site: Site, who: 'owner' | 'field') {
  secure.clear(); await clearTokens()
  const step = await app.signIn.signInWithPassword(site.url, who === 'owner' ? 'owner@test.example' : 'field@test.example', who === 'owner' ? site.ownerPassword : PASS)
  if (step.kind !== 'signedIn') throw new Error('sign-in: ' + JSON.stringify(step))
  const d = step.data
  const perms: string[] = Array.isArray(d.permissions) ? d.permissions.map(String) : []
  const features: string[] = (d.company?.enabledFeatures || []).map((f: string) => f.toLowerCase())
  const vertical = app.detect.detectVertical(d.company?.vertical, d.company?.enabledFeatures)
  const can = (p: string) => app.roles.permits(perms, p)
  const tabs = visibleTabs(VERTICAL_TABS[vertical], can, (f) => features.includes(f.toLowerCase()), app.roles.isFieldRole(d.user?.role)).map((x) => x.name)
  return { data: d, vertical, tabs, can }
}

interface Trade {
  id: string
  features: string[]
  ownerTabs: string[]
  fieldTabs: string[]
  /** Where this trade keeps a job's photos (PhotoGallery.tsx). */
  photos: 'job' | 'documents' | 'none'
  /** The job body the app's form sends. */
  job?: (contactId: string, fieldId: string) => Record<string, unknown>
  /** What the first tab asks the server for, today. */
  today: string[]
  quotes: boolean
}
const TRADES: Trade[] = [
  { id: 'contractor', features: ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'], ownerTabs: ['dashboard', 'jobs', 'contacts', 'quotes', 'more'], fieldTabs: ['dashboard', 'jobs', 'contacts', 'more'], photos: 'documents', today: ['/api/dashboard/stats', '/api/jobs/today'], quotes: true,
    job: (c, f) => ({ title: 'Deck repair', contactId: c, address: '12 Oak St', city: 'Madison', state: 'WI', zip: '53703', scheduledDate: today, scheduledTime: '14:30', assignedToId: f }) },
  { id: 'basic', features: ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'], ownerTabs: ['dashboard', 'jobs', 'contacts', 'quotes', 'more'], fieldTabs: ['dashboard', 'jobs', 'contacts', 'more'], photos: 'job', today: ['/api/dashboard/stats', '/api/jobs/today'], quotes: true,
    job: (c, f) => ({ title: 'Fix the gate', contactId: c, scheduledDate: today, scheduledTime: '10:00', assignedToId: f }) },
  { id: 'fieldservice', features: ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'], ownerTabs: ['dashboard', 'service-calls', 'schedule', 'contacts', 'more'], fieldTabs: ['dashboard', 'service-calls', 'schedule', 'contacts', 'more'], photos: 'job', today: ['/api/dashboard/stats', '/api/jobs/today'], quotes: true,
    job: (c, f) => ({ title: 'No heat', contactId: c, scheduledDate: today, scheduledTime: '09:00', assignedToId: f }) },
  { id: 'landscaping', features: ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'], ownerTabs: ['dashboard', 'jobs', 'schedule', 'contacts', 'more'], fieldTabs: ['dashboard', 'jobs', 'schedule', 'contacts', 'more'], photos: 'job', today: ['/api/dashboard/stats', '/api/jobs/today'], quotes: true,
    job: (c, f) => ({ title: 'Spring cleanup', contactId: c, scheduledDate: today, scheduledTime: '08:00', assignedToId: f }) },
  { id: 'roofing', features: ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture', 'canvassing_tool'], ownerTabs: ['dashboard', 'jobs', 'contacts', 'canvass', 'more'], fieldTabs: ['dashboard', 'jobs', 'contacts', 'canvass', 'more'], photos: 'job', today: ['/api/jobs?limit=500'], quotes: true,
    job: (c, f) => ({ contactId: c, jobType: 'retail', propertyAddress: '9 Elm Ave', city: 'Akron', state: 'OH', zip: '44301', assignedSalesRepId: f }) },
  { id: 'rv', features: ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept', 'dashboard', 'trade_in'], ownerTabs: ['dashboard', 'units', 'ai-trade', 'contacts', 'more'], fieldTabs: ['dashboard', 'units', 'contacts', 'more'], photos: 'none', today: ['/api/dashboard/stats', '/api/units?limit=100'], quotes: false },
]

// The server's vertical ids are not the phone's for every trade; the phone reads company.vertical.
afterAll(() => { for (const s of Object.values(sites)) s.stop() })

describe('every /api path the app names is a route the server has', () => {
  const routesByVertical: Record<string, Array<{ method: string; path: string }>> = {}
  beforeAll(async () => {
    for (const v of [...PHONE_VERTICALS]) {
      const t = await bootTenant({ vertical: v })
      routesByVertical[v] = ((t.app as any).routes as Array<{ method: string; path: string }>).filter((r) => r.method !== 'ALL')
    }
  }, 240_000)

  test('each (method, path) is served by at least one trade the app supports', () => {
    const used = apiPathsUsed()
    expect(used.size).toBeGreaterThan(60) // the sweep sees the app's calls (a dozen screens' worth, plus the caregiver's)
    const missing: string[] = []
    for (const [key, files] of used) {
      const [method, p] = key.split(' ')
      const hit = Object.values(routesByVertical).some((rs) => rs.some((r) => segMatch(r.path, p) && (method === '?' || r.method === method)))
      if (!hit) missing.push(`${key}  (${[...files].join(', ')})`)
    }
    expect(missing).toEqual([])
  })

  test('the app\'s trades are the server\'s trades: every phone vertical boots and has the CRM routes the tabs need', () => {
    for (const v of PHONE_VERTICALS) {
      const paths = routesByVertical[v].map((r) => r.path)
      for (const need of ['/api/auth/login', '/api/auth/me', '/api/push/expo-token', '/api/downloads', '/api/contacts']) expect([v, paths.includes(need)]).toEqual([v, true])
    }
  })
})

for (const trade of TRADES) {
  describe(`${trade.id}: the app's own code against the server`, () => {
    let site: Site
    const ids: Record<string, string> = {}
    beforeAll(async () => {
      site = sites[trade.id] = await serve(trade.id, trade.features)
    }, 180_000)

    test('sign-in: the server names the trade, the app opens the right tabs — for the owner and for the field seat', async () => {
      const owner = await signInAs(site, 'owner')
      expect(owner.data.company.vertical).toBe(trade.id)
      expect(owner.vertical).toBe(trade.id as any)
      expect(owner.tabs).toEqual(trade.ownerTabs)
      ids.ownerToken = getAccessToken()!
      const field = await signInAs(site, 'field')
      expect(field.tabs).toEqual(trade.fieldTabs)
      // What the app opens on is a tab this seat can see (the layout's initialRouteName): the trade's first, else its first visible.
      const first = field.tabs.includes(app.verticals.VERTICAL_INITIAL_TAB[trade.id as 'rv']) ? app.verticals.VERTICAL_INITIAL_TAB[trade.id as 'rv'] : field.tabs[0]
      expect(field.tabs).toContain(first)
    })

    test('a wrong password is an answer on the sign-in screen; an expired session is renewed with the refresh token', async () => {
      secure.clear(); await clearTokens()
      const bad = await app.signIn.signInWithPassword(site.url, 'owner@test.example', 'not-the-password')
      expect(bad.kind).toBe('error')
      expect(getAccessToken()).toBe(null)
      await signInAs(site, 'owner')
      const refresh = app.client.getRefreshToken()!
      await saveTokens('an-expired-token', refresh)
      const me = await get('/api/auth/me')
      expect(me.ok).toBe(true)
      expect(me.data.email ?? me.data.user?.email).toBe('owner@test.example')
      expect(getAccessToken()).not.toBe('an-expired-token')
    })

    test('the first tab\'s data: today\'s jobs / the dashboard / the pipeline answer for this seat', async () => {
      await signInAs(site, 'owner')
      for (const p of trade.today) {
        const r = await get(p)
        expect([p, r.status]).toEqual([p, 200])
      }
    })

    test('a contact: made on the phone, read back, edited', async () => {
      await signInAs(site, 'owner')
      const made = await post('/api/contacts', { name: 'Dana Homeowner', phone: '(555) 201-3344', email: 'dana@example.com', address: '12 Oak St', city: 'Madison', state: 'WI', zip: '53703', type: trade.id === 'rv' ? 'lead' : 'lead' })
      expect(made.status).toBe(201)
      ids.contact = made.data.id
      const read = await get(`/api/contacts/${ids.contact}`)
      expect(read.data.name).toBe('Dana Homeowner')
      expect((await put(`/api/contacts/${ids.contact}`, { name: 'Dana Homeowner', notes: 'Gate code 1234' })).ok).toBe(true)
      const list = await get('/api/contacts?limit=50')
      expect(list.data.data.map((c: any) => c.id)).toContain(ids.contact)
    })

    if (trade.job) {
      test('a job: the field seat sees today\'s work, starts it, adds a note, completes it', async () => {
        await signInAs(site, 'owner')
        const made = await post('/api/jobs', trade.job!(ids.contact, site.fieldId))
        expect([made.status, made.error]).toEqual([201, undefined])
        ids.job = made.data.id
        await signInAs(site, 'field')
        const list = await get('/api/jobs?limit=100')
        expect(list.status).toBe(200)
        expect(list.data.data.map((j: any) => j.id)).toContain(ids.job)
        const detail = await get(`/api/jobs/${ids.job}`)
        expect(detail.data.id).toBe(ids.job)
        if (trade.id === 'roofing') {
          expect((await post(`/api/jobs/${ids.job}/notes`, { body: 'Ladder is on the east side.' })).ok).toBe(true)
          expect((await post(`/api/jobs/${ids.job}/advance`, {})).ok).toBe(true)
        } else {
          expect((await post(`/api/jobs/${ids.job}/start`, {})).ok).toBe(true)
          expect((await put(`/api/jobs/${ids.job}`, { notes: 'Gate code 1234' })).ok).toBe(true)
          expect((await post(`/api/jobs/${ids.job}/complete`, {})).ok).toBe(true)
        }
      })

      test('a job\'s photos: uploaded from the phone (multipart), listed, and the file opens with the session', async () => {
        await signInAs(site, 'field')
        const fd = new FormData()
        const file = new File([new Uint8Array(PNG)], 'photo.png', { type: 'image/png' })
        let up
        if (trade.photos === 'job') { fd.append('photo', file); up = await upload(`/api/jobs/${ids.job}/photos`, fd) }
        else { fd.append('jobId', ids.job); fd.append('photos', file); up = await upload('/api/photos/bulk', fd) }
        expect([up.status, up.error]).toEqual([201, undefined])
        const list = trade.photos === 'job' ? await get(`/api/jobs/${ids.job}/photos`) : await get(`/api/photos?jobId=${encodeURIComponent(ids.job)}`)
        const rows = Array.isArray(list.data) ? list.data : list.data.data
        expect(rows.length).toBe(1)
        // The gallery fetches the picture with the access token beside it (PhotoGallery.photoSource).
        const pic = await fetch(site.url + rows[0].url, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
        expect(pic.status).toBe(200)
        expect(pic.headers.get('content-type')).toContain('image/')
      })
    }

    test('this phone\'s push token is registered (every trade), and signing out takes it off the server', async () => {
      await signInAs(site, 'field')
      const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]'
      const r = await post('/api/push/expo-token', { token, platform: 'ios' })
      expect([r.status, r.error]).toEqual([201, undefined])
      await app.push.rememberPushToken(token)
      const held = async () => (await site.t.db.select().from(site.t.schema.expoPushTokens)).map((x: any) => x.token)
      expect(await held()).toContain(token)
      await app.push.forgetPushToken() // what AuthContext.logout does first, while the session still works
      expect(await held()).not.toContain(token)
      expect(await app.push.forgetPushToken()).toBe(undefined) // nothing remembered: nothing to do, and no error
    })

    if (trade.quotes) {
      test('a quote and its invoice: the PDF link the app opens is one-time, 60 seconds, and serves a PDF', async () => {
        await signInAs(site, 'owner')
        const q = await post('/api/quotes', { name: 'Deck rebuild', contactId: ids.contact, expiryDate: today, lineItems: [{ description: 'Boards', quantity: 2, unitPrice: 12.5 }] })
        expect([q.status, q.error]).toEqual([201, undefined])
        opened.length = 0
        expect(await app.download.openDownload(`/api/quotes/${q.data.id}/pdf`)).toBe(null)
        expect(opened).toHaveLength(1)
        const file = await fetch(opened[0]) // the phone's browser has no session: the link is all it has
        expect(file.status).toBe(200)
        expect(file.headers.get('content-type')).toContain('application/pdf')
        expect(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
        expect((await fetch(opened[0])).status).not.toBe(200) // used once
        const inv = await post(`/api/quotes/${q.data.id}/convert-to-invoice`, {})
        expect(inv.ok).toBe(true)
        opened.length = 0
        expect(await app.download.openDownload(`/api/invoices/${inv.data.id ?? inv.data.invoice?.id}/pdf`)).toBe(null)
        const invFile = await fetch(opened[0])
        expect(invFile.status).toBe(200)
        expect(Buffer.from(await invFile.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
        // The field seat has no quotes: the app hides the tab, and the file is refused when its link is opened (the server
        // fetches it AS the person who asked for the link).
        await signInAs(site, 'field')
        opened.length = 0
        await app.download.openDownload(`/api/quotes/${q.data.id}/pdf`)
        expect(opened.length === 0 || (await fetch(opened[0])).status === 403).toBe(true)
      })
    }

    test('location: while-using fixes the app posts to the geofence route are accepted or cleanly refused (never a 500)', async () => {
      await signInAs(site, 'field')
      const r = await post('/api/geofencing/location', { latitude: 43.07, longitude: -89.4, accuracy: 12 })
      expect(r.status).toBeLessThan(500)
    })
  })
}

describe('homecare: the caregiver\'s day, through the app\'s own request code', () => {
  let site: Site
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    site = sites.homecare = await serve('homecare', ['documents'])
    await site.t.db.update(site.t.schema.company).set({ timezone: 'UTC' } as any).where(eq(site.t.schema.company.id, site.companyId))
    // The caregiver is the `field` seat; the agency has a client and a visit for them today.
    const [pat] = await site.t.db.insert(site.t.schema.clients).values({ companyId: site.companyId, firstName: 'Pat', lastName: 'Client', isActive: true, address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701', phone: '7155550100', latitude: '44.81', longitude: '-91.49' } as any).returning()
    ids.pat = pat.id
    const owner = await signInAs(site, 'owner')
    const dow = new Date().getUTCDay()
    const sched = await post('/api/schedules', { caregiverId: site.fieldId, clientId: ids.pat, dayOfWeek: dow, startTime: '09:00', endTime: '11:00' })
    expect(sched.status).toBe(201)
    expect(owner.vertical).toBe('homecare')
  }, 180_000)

  test('sign-in: a caregiver gets Today, Schedule, Clock, Messages, More — and Today is where the app opens', async () => {
    const cg = await signInAs(site, 'field')
    expect(cg.tabs).toEqual(['shifts', 'care-schedule', 'time-clock', 'messages', 'more-homecare'])
    expect(app.verticals.VERTICAL_INITIAL_TAB.homecare).toBe('shifts')
  })

  test('sign-in: the office gets Home, Messages, More — and opens on Home', async () => {
    const office = await signInAs(site, 'owner')
    expect(office.tabs).toEqual(['dashboard', 'messages', 'more'])
    const first = app.verticals.firstTab(VERTICAL_TABS.homecare, app.verticals.VERTICAL_INITIAL_TAB.homecare, office.can, () => true, false)
    expect(first).toBe('dashboard')
  })

  test('today\'s visits, the client, then clock in and clock out — with the location the phone sends', async () => {
    const cg = await signInAs(site, 'field')
    const sched = await app.care.careGetRetry(`/api/schedules/${encodeURIComponent(cg.data.user?.id ?? cg.data.id)}?includeMovedIn=1`)
    expect(sched.ok).toBe(true)
    expect(app.care.asList(sched.data).length).toBeGreaterThan(0)
    expect(app.care.asList((await app.care.careGetRetry('/api/clients')).data).map((c: any) => c.id)).toContain(ids.pat)
    expect((await app.care.careGet('/api/time-entries/active')).data).toBe(null)
    const inn = await app.care.carePost('/api/time-entries/clock-in', { clientId: ids.pat, latitude: 44.81, longitude: -91.49 })
    expect([inn.status, inn.error]).toEqual([201, undefined])
    const active = await app.care.careGet('/api/time-entries/active')
    expect(active.data.id).toBe(inn.data.id)
    const out = await app.care.carePost(`/api/time-entries/${inn.data.id}/clock-out`, { latitude: 44.81, longitude: -91.49, notes: 'Good visit' })
    expect(out.status).toBe(200)
    expect(app.care.asList((await app.care.careGet('/api/time-entries/recent?limit=20')).data).map((e: any) => e.id)).toEqual([inn.data.id])
  })

  test('the Alerts/More data: notifications and the unread counts answer, and the push token registers', async () => {
    await signInAs(site, 'field')
    expect((await app.care.careGet('/api/messages/unread-count')).ok).toBe(true)
    expect((await app.care.careGet('/api/push/unread-count')).ok).toBe(true)
    expect((await post('/api/push/expo-token', { token: 'ExponentPushToken[care0123456789abcdefgh]', platform: 'android' })).ok).toBe(true)
  })

  test('a request that stalls settles as "no connection" rather than hanging (the caregiver\'s clock button never spins forever)', async () => {
    const slow = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    const saved = app.client.getApiUrl()
    await app.client.saveApiUrl(`http://localhost:${slow.port}`)
    const t0 = Date.now()
    const r = await app.care.careGet('/api/time-entries/active', 400)
    expect([r.ok, r.status]).toEqual([false, 0])
    expect(Date.now() - t0).toBeLessThan(3000)
    slow.stop(true)
    await app.client.saveApiUrl(saved)
  })
})

describe('the trades the app turns away: a plain screen that points to the website', () => {
  for (const [id, label] of [['salon', 'a salon'], ['restaurant', 'a restaurant'], ['bar', 'a bar'], ['store', 'a store'], ['vet', 'a veterinary practice']] as const) {
    test(`${label}: signs in, is told "unavailable" by the app's own rule, and the website sign-in is the tenant's /login`, async () => {
      const site = sites[id] = await serve(id, [])
      const s = await signInAs(site, 'owner')
      expect(s.data.company.vertical).toBe(id)
      expect(s.vertical).toBe('unavailable')
      expect(s.tabs).toEqual([])
      // The screen's button opens <the address they signed in at>/login — which really is the web sign-in page route.
      expect(webSignInUrl(site.url + '/')).toBe(site.url + '/login')
      expect(site.routes.some((r) => r.path === '/login' && r.method !== 'POST')).toBe(true)
    }, 120_000)
  }

  test('even a business that names no vertical at all is not shown another trade\'s tabs when the server names one the app lacks', () => {
    expect(app.detect.detectVertical('salon', ['loyalty_rewards'])).toBe('unavailable')
    expect(app.detect.detectVertical('dispensary', [])).toBe('unavailable')
  })
})
