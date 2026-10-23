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
