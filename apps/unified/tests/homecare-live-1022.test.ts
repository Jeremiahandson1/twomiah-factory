// The home-care live test of 2026-10-22: shared screens that spoke a builder's language or were out of reach.
//   1. Contacts was switched on but in no menu; Invoices was switched on and is not an agency's (it bills its clients'
//      visits on Financial › Billing). Contacts is in the agency's menu; the registry no longer offers home care the
//      shared Invoices, and its address opens Billing.
//   2. Contacts offered "Subcontractor" and the trades' Projects / Quotes / "Create Quote" / "Schedule Job"; Lead Sources
//      offered Angi, HomeAdvisor, Thumbtack and Houzz. Home care's settings now say an agency's own types and sources.
//   3. The Integrations Hub told the owner to "Add GUSTO_API_KEY": no setting names, and the CSV is what they can do.
//   4. Settings had no logo upload and no business hours: both are on the company row the website reads.
//   6. The Add Contact Source field was a dropdown or a text box by request timing: always the dropdown now.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import homecare from '../verticals/homecare/settings.ts'
import { loadSiteContext } from '../server/site/context.ts'
import { getFeaturesForTemplate, getDefaultFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry.ts'
// A screen (.tsx): loaded at run time, as this app's server tsconfig compiles no JSX.
const SOURCE_FIELD: string = '../../../packages/tenant-ui/src/contacts/SourceField.tsx'
const { SourceField, sourceOptionsCache } = await import(SOURCE_FIELD)

const ROOT = path.join(import.meta.dir, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
let companyId = ''
const PASSWORD = 'Pass-word-1'
let ip = 0
const signIn = async (email: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `198.51.100.${++ip}` } })).json()).accessToken as string
const as = (who: string, method: string, p: string, json?: unknown, init: RequestInit = {}) =>
  t.call(p, { method, json, ...init, headers: { ...(init.headers as any || {}), Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const S = t.schema
  const [co] = await t.db.insert(S.company).values({ name: 'Kind Care', slug: 'kind-care', state: 'WI', timezone: 'UTC', enabledFeatures: [...getDefaultFeaturesForTemplate('crm-homecare'), 'lead_inbox'] } as any).returning()
  companyId = co.id
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  for (const [who, role] of [['owner', 'owner'], ['manager', 'manager'], ['caregiver', 'caregiver']] as const) {
    await t.db.insert(S.user).values({ email: `${who}@kind.example`, passwordHash: hash, firstName: who, lastName: 'K', role, companyId })
    tokens[who] = await signIn(`${who}@kind.example`)
  }
}, 180_000)

describe('1. the menu and the feature list agree', () => {
  test('home care is offered Contacts, and not the shared Invoices (its billing is Financial › Billing)', () => {
    const offered = getFeaturesForTemplate('crm-homecare').map((f) => f.id)
    expect(offered).toContain('contacts')
    expect(offered).not.toContain('invoices')
    expect(getDefaultFeaturesForTemplate('crm-homecare')).not.toContain('invoices')
    // …and every other CRM that had it keeps it.
    for (const tpl of ['crm', 'crm-fieldservice', 'crm-vet', 'crm-salon', 'crm-rv']) expect(getFeaturesForTemplate(tpl).map((f) => f.id)).toContain('invoices')
  })

  test('Settings › Features lists Contacts and not Invoices for an agency', async () => {
    const cat = await body(await as('owner', 'GET', '/api/company/features/catalog'))
    const ids = cat.features.map((f: any) => f.id)
    expect(ids).toContain('contacts')
    expect(ids).not.toContain('invoices')
  })

  test('Contacts is in the agency\'s own menu, behind its feature and permission; Invoices opens Billing', () => {
    const src = read('web/src/crm/verticals/homecare.tsx')
    expect(src).toMatch(/\['\/crm\/contacts', 'Operations'\]/)
    expect(src).toMatch(/\{ to: '\/crm\/contacts', icon: Users, label: 'Contacts', features: \['contacts'\], permission: 'contacts:read' \}/)
    expect(src).toMatch(/path="invoices" element=\{<Navigate to="\/crm\/billing" replace \/>\}/)
  })

  test('the contacts list answers the office and not a caregiver', async () => {
    expect((await as('owner', 'GET', '/api/contacts')).status).toBe(200)
    expect((await as('caregiver', 'GET', '/api/contacts')).status).toBe(403)
  })
})

describe('2. shared screens in an agency\'s words', () => {
  test('a contact is an enquiry, a client or a supplier — a subcontractor is refused', async () => {
    expect((await as('owner', 'POST', '/api/contacts', { name: 'Sub Co', type: 'subcontractor' })).status).toBe(400)
    expect((await as('owner', 'POST', '/api/contacts', { name: 'Medical Supply Co', type: 'vendor' })).status).toBe(201)
    const screen = (homecare.screens as any).contacts
    expect(screen.types.map((x: any) => x.value)).toEqual(homecare.crm!.contacts!.types)
    expect(screen.types.map((x: any) => x.value)).not.toContain('subcontractor')
  })

  test('the contact page has no Projects, Quotes or builder buttons', () => {
    const screen = (homecare.screens as any).contacts
    expect(screen.sections.projects).toBe(false)
    expect(screen.sections.quotes).toBe(false)
    expect(screen.quickActions).toEqual([])
  })

  test('the lead sources are an agency\'s: the trades\' marketplaces are refused', async () => {
    const screenIds = (homecare.screens as any).leads.platforms.map((p: any) => p.value)
    expect(screenIds).toEqual(homecare.crm!.leads!.platforms)
    for (const trade of ['angi', 'homeadvisor', 'thumbtack', 'houzz', 'google_lsa']) expect(screenIds).not.toContain(trade)
    const angi = await as('owner', 'POST', '/api/leads/sources', { platform: 'angi', label: 'Angi' })
    expect(angi.status).toBe(400)
    expect((await as('owner', 'POST', '/api/leads/sources', { platform: 'care_directory', label: 'Care directories' })).status).toBe(201)
  })
})

describe('3. the Integrations Hub names no server setting', () => {
  test('Gusto\'s setup reply tells the owner what they can do, not an env var', async () => {
    const r = await as('owner', 'GET', '/api/gusto/config')
    expect(r.status).toBe(200)
    const text = JSON.stringify(await body(r))
    expect(text).not.toMatch(/GUSTO_|env var|Render/i)
    expect(text).toMatch(/CSV/)
  })

  test('the hub\'s screen, and the replies it shows, carry no SETTING_NAME', () => {
    const NAME = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]*(KEY|ID|TOKEN|SECRET)\b/
    expect(read('web/src/crm/pages/homecare/office/IntegrationsHub.tsx')).not.toMatch(NAME)
    // The check reader the hub's remittance tab calls (billing/payments.ts scan-check): its refusal, not the comment.
    const payments = read('server/crm/homecare/billing/payments.ts')
    expect(payments.split('\n').filter((l) => /fail\(c,/.test(l) && NAME.test(l))).toEqual([])
  })
})

describe('4. logo upload and business hours, on the company the website reads', () => {
  const png = () => sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 10, g: 90, b: 160, alpha: 1 } } }).png().toBuffer()
  const upload = async (who: string, file: Blob, name: string) => {
    const fd = new FormData()
    fd.append('file', new File([file], name, { type: file.type }))
    return as(who, 'POST', '/api/company/logo', undefined, { body: fd })
  }

  test('the owner uploads a logo: it is stored as a PNG, served at /media, and is the company\'s logo', async () => {
    const r = await upload('owner', new Blob([await png()], { type: 'image/png' }), 'logo.png')
    expect(r.status).toBe(201)
    const { logo } = await body(r)
    expect(logo).toMatch(/^\/media\/photos\/logo-[0-9a-f-]+\.png$/)
    const [row] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
    expect(row.logo).toBe(logo)
    const served = await t.call(logo)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect((await loadSiteContext(t.db, homecare))!.settings.logoUrl).toBe(logo)
  })

  test('an SVG is drawn to a PNG (no script survives); a non-image and a manager are refused', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script><rect width="20" height="20" fill="red"/></svg>'
    const r = await upload('owner', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg')
    expect(r.status).toBe(201)
    const { logo } = await body(r)
    expect(logo).toMatch(/\.png$/)
    const stored = t.store.objects.get(logo.replace('/media/', ''))!
    expect(stored.contentType).toBe('image/png')
    expect(stored.body.toString('latin1')).not.toContain('<script>')
    expect((await upload('owner', new Blob(['not an image'], { type: 'image/png' }), 'x.png')).status).toBe(400)
    expect((await upload('manager', new Blob([await png()], { type: 'image/png' }), 'logo.png')).status).toBe(403)
  })

  test('business hours are saved on the company, checked, and printed by the website', async () => {
    const hours = { monday: { open: '08:00', close: '17:30' }, saturday: { open: '09:00', close: '12:00' }, sunday: { closed: true } }
    const ok = await as('owner', 'PUT', '/api/company', { settings: { businessHours: hours } })
    expect(ok.status).toBe(200)
    const ctx = (await loadSiteContext(t.db, homecare))!
    expect(ctx.settings.businessHours).toEqual(hours)
    expect(ctx.settings.businessHoursLines).toEqual(['Monday: 8am – 5:30pm', 'Saturday: 9am – 12pm', 'Sunday: Closed'])
    for (const bad of [{ monday: { open: '17:00', close: '09:00' } }, { funday: { closed: true } }, { monday: { open: '9am', close: '5pm' } }]) {
      const r = await as('owner', 'PUT', '/api/company', { settings: { businessHours: bad } })
      expect(r.status).toBe(400)
    }
    // The contact section prints them when its own Hours are empty.
    expect(read('site/views/sections/contact/form-info.ejs')).toContain('settings.businessHoursLines')
  })

  test('the Settings screen offers both', () => {
    const src = fs.readFileSync(path.join(ROOT, '../../packages/tenant-ui/src/shell/SettingsPage.tsx'), 'utf8')
    expect(src).toContain("api.upload('/api/company/logo', fd)")
    expect(src).toContain('businessHours: hoursToSave(hours)')
  })
})

describe('6. the Source field is one shape every time it opens', () => {
  const render = () => renderToString(createElement(SourceField, {
    api: { get: () => new Promise(() => {}), put: async () => ({}) }, value: '', onChange: () => {}, toast: { success() {}, error() {} },
  }))
  test('before the choices arrive it is the dropdown, waiting — not a text box', () => {
    sourceOptionsCache.options = null
    const html = render()
    expect(html).toContain('<select')
    expect(html).not.toContain('type="text"')
  })
  test('opened again, it shows the choices it last had at once', () => {
    sourceOptionsCache.options = ['Referral', 'Hospital']
    const html = render()
    expect(html).toContain('<select')
    expect(html).toContain('Hospital')
    expect(html).not.toContain('Loading choices')
  })
  test('with no choices at all it is still the dropdown, with Other and its box', () => {
    sourceOptionsCache.options = []
    const html = render()
    expect(html).toContain('<select')
    expect(html).toContain('Other…')
    expect(html).toContain('aria-label="Other source"')
  })
})

describe('5. Call Tracking explains itself until something is connected', () => {
  test('the page reads the three facts it decides on — numbers, calls, the CallRail key — and a new agency has none', async () => {
    expect((await body(await as('owner', 'GET', '/api/calltracking/numbers'))).data).toEqual([])
    expect((await body(await as('owner', 'GET', '/api/calltracking/calls?limit=1'))).pagination.total).toBe(0)
    expect((await body(await as('owner', 'GET', '/api/calltracking/settings'))).callrailSigningKeySet).toBe(false)
  })
  test('with none of them, the page is the setup explanation and the CallRail panel, not an empty log', () => {
    const src = read('web/src/crm/pages/CallTrackingPage.tsx')
    expect(src).toContain('const notConnected = !!setup && setup.numbers === 0 && setup.calls === 0 && !setup.keySet;')
    expect(src).toContain('if (notConnected) return <CallTrackingSetup maySetUp={maySetUp} />;')
    expect(src).toMatch(/function CallTrackingSetup[\s\S]*?<CallTrackingSettings \/>/)
  })
})
