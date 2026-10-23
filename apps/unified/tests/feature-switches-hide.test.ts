// A switch in Settings › Features hides what it names, on the server as on the screens (live retest 2026-10-22: home
// care's Documents and Reports switches hid nothing; a sweep of every vertical found the same in contractor's Vendor
// Portal, RV's Trade-In Management and Service Status Updates, vet's Lab Results, Prescriptions and Rabies Certificates,
// and home care's Two-Way Texting). Each: off, its APIs refuse (FEATURE_NOT_ENABLED, or 404 for a public door) or its
// behaviour stops; on again, it is all back. The screens' half is clicked in the browser (scratchpad rt1022-switches.ts).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

async function boot(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  const set = async (f: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: f } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
  await set(features)
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const as = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const code = async (r: Response) => `${r.status}${r.status === 403 ? ' ' + ((await r.json()) as any).code : ''}`
  return { t, as, set, code, companyId, owner: s.owner }
}

describe('home care: Documents, Reports and Two-Way Texting', () => {
  test('off, their APIs refuse; the client report and Client Week stay; on, all answer', async () => {
    const ALL = ['contacts', 'dashboard', 'scheduling', 'team', 'documents', 'reports', 'two_way_texting']
    const x = await boot('homecare', ALL)
    const doors = async () => ({
      documents: await x.code(await x.as('/api/documents')),
      unsigned: await x.code(await x.as(`/api/documents/unsigned/${x.owner.id}`)),
      overview: await x.code(await x.as('/api/reports/overview', { method: 'POST', json: {} })),
      pnl: await x.code(await x.as('/api/reports/pnl?startDate=2026-10-01&endDate=2026-10-22')),
      export: await x.code(await x.as('/api/reports/revenue/export', { method: 'POST', json: {} })),
      clientWeek: await x.code(await x.as('/api/reports/client-week')),
      smsTemplates: await x.code(await x.as('/api/sms/templates')),
    })
    const on = await doors()
    expect([on.documents, on.unsigned, on.overview, on.pnl, on.clientWeek, on.smsTemplates]).toEqual(['200', '200', '200', '200', '200', '200'])
    await x.set(ALL.filter((f) => !['documents', 'reports', 'two_way_texting'].includes(f)))
    const off = await doors()
    expect(off).toEqual({
      documents: '403 FEATURE_NOT_ENABLED', unsigned: '403 FEATURE_NOT_ENABLED', overview: '403 FEATURE_NOT_ENABLED',
      pnl: '403 FEATURE_NOT_ENABLED', export: '403 FEATURE_NOT_ENABLED', clientWeek: '200', smsTemplates: '403 FEATURE_NOT_ENABLED',
    })
    await x.set(ALL)
    expect(await doors()).toEqual(on)
  }, 120_000)
})

describe('contractor: Vendor Portal', () => {
  test('off, the portal and its invite are not there; on, the invite is sent', async () => {
    const x = await boot('contractor', ['contacts', 'vendor_portal'])
    const [v] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Vic Vendor', email: 'vic@test.example', type: 'vendor' } as any).returning()
    const invite = () => x.as(`/api/vendor-portal/contacts/${v.id}/invite`, { method: 'POST' })
    expect((await invite()).status).toBe(200)
    await x.set(['contacts'])
    expect((await invite()).status).toBe(404)
    expect((await x.t.call('/api/vendor-portal/v/anything')).status).toBe(404)
    await x.set(['contacts', 'vendor_portal'])
    expect((await invite()).status).toBe(200)
  }, 120_000)
})

describe('RV: Trade-In Management and Service Status Updates', () => {
  test('trade-in off: the appraisal refuses and a lead keeps no trade-in; on, both again', async () => {
    const BASE = ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept']
    const x = await boot('rv', [...BASE, 'trade_in'])
    const [c] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Dee Dealer', type: 'client' } as any).returning()
    let n = 0
    // A new buyer each time: one open lead per customer (a second is a 409).
    const lead = async () => { const [who] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: `Buyer ${++n}`, type: 'client' } as any).returning(); const r = await x.as('/api/sales-leads', { method: 'POST', json: { contactId: who.id, tradeInInfo: '2019 Jayco, fair' } }); const b = (await r.json()) as any; expect([r.status, 'tradeInInfo' in b]).toEqual([201, true]); return b.tradeInInfo }
    expect(await lead()).toBe('2019 Jayco, fair')
    await x.set(BASE)
    expect(await lead()).toBeNull()
    expect(await x.code(await x.as('/api/ai-trade/appraise', { method: 'POST', json: {} }))).toBe('403 FEATURE_NOT_ENABLED')
    await x.set([...BASE, 'trade_in'])
    expect(await lead()).toBe('2019 Jayco, fair')
    expect((await x.as('/api/ai-trade/appraise', { method: 'POST', json: {} })).status).not.toBe(403)
  }, 120_000)

  test('service status texts off: moving a repair order to Ready texts nobody; on, the customer is texted', async () => {
    const BASE = ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept']
    const x = await boot('rv', [...BASE, 'service_status_texts'])
    const texts: any[] = []
    ;(x.t.services as any).crm.sms.sendSMS = async (_co: string, m: any) => { texts.push(m); return { success: true } }
    const [c] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Rita Rider', phone: '715-555-0199', type: 'client' } as any).returning()
    const ro = async () => {
      const made = (await (await x.as('/api/repair-orders', { method: 'POST', json: { customerId: c.id, complaint: 'brakes' } })).json()) as any
      expect((await x.as(`/api/repair-orders/${made.id}`, { method: 'PUT', json: { status: 'ready' } })).status).toBe(200)
    }
    await ro()
    expect(texts.length).toBe(1)
    await x.set(BASE)
    await ro()
    expect(texts.length).toBe(1)
    await x.set([...BASE, 'service_status_texts'])
    await ro()
    expect(texts.length).toBe(2)
  }, 120_000)
})

describe('vet: Lab Results, Prescriptions, Rabies Certificates', () => {
  test('off, their APIs refuse and the chart carries none; on, they are back', async () => {
    const BASE = ['contacts', 'patient_records', 'reminders_recall', 'appointment_scheduling']
    const ALL = [...BASE, 'lab_results', 'prescriptions', 'rabies_certificates']
    const x = await boot('vet', ALL)
    const [owner] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Pat Owner', type: 'client' } as any).returning()
    const [pet] = await x.t.db.insert(x.t.schema.patient).values({ companyId: x.companyId, ownerId: owner.id, name: 'Rex', species: 'canine' } as any).returning()
    await x.t.db.insert(x.t.schema.prescription).values({ companyId: x.companyId, patientId: pet.id, drug: 'Carprofen', prescribedDate: new Date() } as any)
    await x.t.db.insert(x.t.schema.labResult).values({ companyId: x.companyId, patientId: pet.id, testName: 'CBC', resultDate: new Date() } as any)
    const [vax] = await x.t.db.insert(x.t.schema.vaccination).values({ companyId: x.companyId, patientId: pet.id, vaccine: 'Rabies', isRabies: true, givenDate: new Date() } as any).returning()
    const read = async () => {
      const chart = (await (await x.as(`/api/patients/${pet.id}`)).json()) as any
      return {
        rx: await x.code(await x.as('/api/prescriptions')), labs: await x.code(await x.as('/api/lab-results')),
        rabies: await x.code(await x.as(`/api/reminders/rabies/${vax.id}`)),
        chart: [chart.prescriptions.length, chart.labResults.length],
      }
    }
    expect(await read()).toEqual({ rx: '200', labs: '200', rabies: '200', chart: [1, 1] })
    await x.set(BASE)
    expect(await read()).toEqual({ rx: '403 FEATURE_NOT_ENABLED', labs: '403 FEATURE_NOT_ENABLED', rabies: '403 FEATURE_NOT_ENABLED', chart: [0, 0] })
    await x.set(ALL)
    expect(await read()).toEqual({ rx: '200', labs: '200', rabies: '200', chart: [1, 1] })
  }, 120_000)
})

// ── The sweep's second round (2026-10-22): every switch the sweep found ungated or gated on one side only.
describe('Two-Way Texting: the shared /api/sms', () => {
  test('off, the inbox and the sends are refused; the provider webhooks and the admin test text stay; on, all answer', async () => {
    const x = await boot('contractor', ['contacts', 'two_way_texting'])
    const inbox = () => x.as('/api/sms/conversations')
    const send = () => x.as('/api/sms/send', { method: 'POST', json: { toPhone: '+17155550100', message: 'hi' } })
    expect((await inbox()).status).toBe(200)
    await x.set(['contacts'])
    expect([await x.code(await inbox()), await x.code(await send()), await x.code(await x.as('/api/sms/templates'))]).toEqual(['403 FEATURE_NOT_ENABLED', '403 FEATURE_NOT_ENABLED', '403 FEATURE_NOT_ENABLED'])
    // The test text checks the account every text goes through (reminders, review requests): not the inbox's switch.
    expect(await x.code(await x.as('/api/sms/test', { method: 'POST', json: { to: '+17155550100' } }))).not.toBe('403 FEATURE_NOT_ENABLED')
    // Twilio's webhook is answered by its own signature check, never by the switch.
    const hook = await x.t.call('/api/sms/webhook/incoming', { method: 'POST', body: 'From=%2B17155550100&Body=hi', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(hook.headers.get('content-type') || '').toContain('text/xml')
    await x.set(['contacts', 'two_way_texting'])
    expect((await inbox()).status).toBe(200)
  }, 120_000)
})

describe('QuickBooks and Online Payments', () => {
  test("off, their doors refuse (QuickBooks' OAuth callback still answers); on, they do not refuse", async () => {
    const x = await boot('contractor', ['contacts', 'invoices', 'quickbooks', 'online_payments'])
    const doors = async () => ({
      qbStatus: await x.code(await x.as('/api/quickbooks/status')),
      qbAuth: await x.code(await x.as('/api/integrations/quickbooks/auth-url')),
      stripeConfig: await x.code(await x.as('/api/stripe/config')),
      stripeConnect: await x.code(await x.as('/api/integrations/stripe/connect-url')),
    })
    const on = await doors()
    expect(Object.values(on).some((v) => v === '403 FEATURE_NOT_ENABLED')).toBe(false)
    await x.set(['contacts', 'invoices'])
    expect(await doors()).toEqual({ qbStatus: '403 FEATURE_NOT_ENABLED', qbAuth: '403 FEATURE_NOT_ENABLED', stripeConfig: '403 FEATURE_NOT_ENABLED', stripeConnect: '403 FEATURE_NOT_ENABLED' })
    expect((await x.t.call('/api/quickbooks/callback?error=access_denied')).status).toBe(302)
    await x.set(['contacts', 'invoices', 'quickbooks', 'online_payments'])
    expect(await doors()).toEqual(on)
  }, 120_000)
})

describe('Support Tickets', () => {
  test("off, the ticket desk refuses and the Help page's articles stay; on, the desk answers", async () => {
    const x = await boot('contractor', ['contacts', 'support_tickets'])
    expect((await x.as('/api/support/tickets')).status).toBe(200)
    await x.set(['contacts'])
    expect([await x.code(await x.as('/api/support/tickets')), await x.code(await x.as('/api/support/tickets/stats')), await x.code(await x.as('/api/support/kb'))]).toEqual(['403 FEATURE_NOT_ENABLED', '403 FEATURE_NOT_ENABLED', '200'])
    await x.set(['contacts', 'support_tickets'])
    expect((await x.as('/api/support/tickets')).status).toBe(200)
  }, 120_000)
})

describe('roofing Crews', () => {
  test('off, /api/crews refuses; on, it answers', async () => {
    const x = await boot('roofing', ['contacts', 'jobs', 'crews'])
    expect((await x.as('/api/crews')).status).toBe(200)
    await x.set(['contacts', 'jobs'])
    expect(await x.code(await x.as('/api/crews'))).toBe('403 FEATURE_NOT_ENABLED')
    await x.set(['contacts', 'jobs', 'crews'])
    expect((await x.as('/api/crews')).status).toBe(200)
  }, 120_000)
})

describe('the Exterior Visualizer (a paid add-on, off by default)', () => {
  test('off, the company is not handed its address and the public site has no Visualizer page or nav item; on, both', async () => {
    const was = process.env.VISION_URL
    process.env.VISION_URL = 'https://vision.test.example'
    try {
      const x = await boot('contractor', ['contacts'])
      // A published page the site builds with its nav (the Visualizer's item is added to every such page's nav).
      await x.t.db.insert(x.t.schema.page).values({ companyId: x.companyId, slug: 'about', title: 'About', sections: [{ type: 'text', variant: 'plain', data: { title: 'About us', body: 'Roofs since 1990.' } }], isPublished: true } as any)
      const look = async () => {
        const me = (await (await x.as('/api/auth/me')).json()) as any
        const page = await x.t.call('/visualize')
        const home = await (await x.t.call('/about')).text()
        return { url: me.company?.visionUrl ?? null, page: page.status, nav: home.includes('href="/visualize"') }
      }
      const off = await look()
      expect(off.url).toBeNull()
      expect(off.page).not.toBe(200)
      expect(off.nav).toBe(false)
      await x.set(['contacts', 'visualizer'])
      const on = await look()
      expect([on.url, on.page, on.nav]).toEqual(['https://vision.test.example', 200, true])
    } finally { if (was === undefined) delete process.env.VISION_URL; else process.env.VISION_URL = was }
  }, 120_000)
})

describe('Flat Rate Pricebook (gated, but on a private 15 s cache — now the app gate) and Client Portal (a script miss: a real gate)', () => {
  test('the pricebook API opens on either price book switch and refuses with neither', async () => {
    const x = await boot('fieldservice', ['contacts', 'flat_rate_pricebook'])
    expect((await x.as('/api/pricebook/items')).status).toBe(200)
    await x.set(['contacts'])
    expect(await x.code(await x.as('/api/pricebook/items'))).toBe('403 FEATURE_NOT_ENABLED')
  }, 120_000)

  test('the client portal refuses to be switched on for a contact while Client Portal is off', async () => {
    const x = await boot('contractor', ['contacts', 'client_portal'])
    const [c] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Pat Portal', email: 'pat@test.example', type: 'client' } as any).returning()
    const enable = () => x.as(`/api/portal/contacts/${c.id}/enable`, { method: 'POST' })
    expect((await enable()).status).toBe(200)
    await x.set(['contacts'])
    expect(await x.code(await enable())).toBe('403 FEATURE_NOT_ENABLED')
  }, 120_000)
})

describe('RV Deal Desk, Recall Lookup, Marketplace Syndication', () => {
  test('each refuses while its own switch is off, whatever dealership features are on', async () => {
    const BASE = ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept']
    const ALL = [...BASE, 'deal_desk', 'recall_lookup', 'inventory_syndication']
    const x = await boot('rv', ALL)
    const [c] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Desk Buyer', type: 'client' } as any).returning()
    const lead = (await (await x.as('/api/sales-leads', { method: 'POST', json: { contactId: c.id } })).json()) as any
    // The marketplaces' feed address, issued while syndication is on: the public door it opens must close with the switch.
    const feedToken = ((await (await x.as('/api/syndication/token')).json()) as any).token
    const doors = async () => ({
      desk: await x.code(await x.as(`/api/sales-leads/${lead.id}/deal`, { method: 'PUT', json: {} })),
      deskRead: await x.code(await x.as(`/api/sales-leads/${lead.id}/deal`)),
      recall: await x.code(await x.as('/api/recalls/unit/none')),
      feedToken: await x.code(await x.as('/api/syndication/token')),
      publicFeed: (await x.t.call(`/api/public/feed/${feedToken}/feed.json`)).status,
    })
    const on = await doors()
    expect([on.desk, on.recall, on.feedToken].includes('403 FEATURE_NOT_ENABLED')).toBe(false)
    expect(on.publicFeed).toBe(200)
    await x.set(BASE)
    const off = await doors()
    expect(off).toEqual({ desk: '403 FEATURE_NOT_ENABLED', deskRead: on.deskRead, recall: '403 FEATURE_NOT_ENABLED', feedToken: '403 FEATURE_NOT_ENABLED', publicFeed: 404 })
    await x.set(ALL)
    expect(await doors()).toEqual(on)
  }, 120_000)
})
