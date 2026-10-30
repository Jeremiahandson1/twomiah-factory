// Stylist commissions (salon gap #8; server/crm/salon/commissions.ts, the shared commission routes with sales kinds on). A stylist is paid by
// themselves when their visit's bill is paid in full: services at one rate, retail at another, optional monthly tiers; refunded in full, it is
// taken back. Off — the default (hidden feature salon_commissions) — the routes are closed and nothing is earned.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']
const PASSWORD = 'Comm-1030-xx'

describe('salon: stylist commissions', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cat = '', cut = '', colour = ''
  const tokens: Record<string, string> = {}
  let ip = 0, hour = 7
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.8.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = addDays(today(), -2)                       // a day gone by: a visit can only be completed once its time has come
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A visit for a new client, completed (which raises the bill). */
  async function visit(body: Record<string, unknown>) {
    const client = await ins(t.schema.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(day, `${String(hour).padStart(2, '0')}:00`), ...body })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, made.body.id))
    return { appointmentId: made.body.id as string, invoice: inv }
  }
  // The money routes earn commission just after they answer (never blocking the reply): wait until the rows stop changing.
  async function settle() {
    let last = '', stable = 0
    for (let i = 0; i < 40 && stable < 3; i++) {
      const now = JSON.stringify((await t.db.select().from(t.schema.commission)).map((r: any) => [r.id, r.status]).sort())
      stable = now === last ? stable + 1 : 0; last = now
      await Bun.sleep(40)
    }
  }
  const pay = (invoiceId: string, amount: number) => as('owner', `/api/invoices/${invoiceId}/payments`, 'POST', { amount, method: 'cash' })
  const owedTo = async (userId: string, invoiceId?: string) => {
    await settle()
    const rows = ((await as('owner', `/api/commissions?userId=${userId}`)).body.data as any[]).filter((r) => r.status !== 'cancelled' && (!invoiceId || r.invoiceId === invoiceId))
    return rows.map((r) => [r.baseAmount, r.commissionAmount, r.planId] as [string, string, string]).sort()
  }
  const plan = (body: Record<string, unknown>) => as('owner', '/api/commissions/plans', 'POST', { appliesToRole: 'technician', autoEarn: 'visit_stylist', ...body })
  let servicesAna = '', retailAll = '', servicesHouse = '', tiered = ''

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const key of ['ana', 'bea', 'cat']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea, cat } = ids as any)
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 200 })).body.id
  }, 120_000)

  test('off by default: the plans are closed, and a paid visit earns nothing', async () => {
    expect((await as('owner', '/api/commissions/plans')).status).not.toBe(200)
    const v = await visit({ serviceId: cut, stylistId: ana })
    expect((await pay(v.invoice.id, 100)).status).toBeLessThan(300)
    expect(await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.companyId, co))).toHaveLength(0)
  })

  test('only a seat that may create plans can: a stylist is refused; kinds are checked', async () => {
    await features([...FEATURES, 'salon_commissions'])
    const refused = await as('ana', '/api/commissions/plans', 'POST', { name: 'Mine', planType: 'percent_of_invoice', percentRate: 90, appliesToRole: 'technician' })
    expect(refused.status).toBe(403)
    expect((await plan({ name: 'Bad', planType: 'percent_of_invoice', percentRate: 10, salesKind: 'everything' })).status).toBe(400)
    servicesAna = (await plan({ name: 'Ana services 40', planType: 'percent_of_invoice', percentRate: 40, salesKind: 'services', userIds: [ana] })).body.id
    retailAll = (await plan({ name: 'Retail 10', planType: 'percent_of_invoice', percentRate: 10, salesKind: 'retail' })).body.id
    servicesHouse = (await plan({ name: 'House services 30', planType: 'percent_of_invoice', percentRate: 30, salesKind: 'services' })).body.id
    expect([servicesAna, retailAll, servicesHouse].every(Boolean)).toBe(true)
    const list = (await as('owner', '/api/commissions/plans')).body.data
    expect(list.find((p: any) => p.id === servicesAna).salesKind).toBe('services')
    expect(list.find((p: any) => p.id === retailAll).autoEarn).toBe('visit_stylist')
  })

  test('services and retail are paid at their own rates; a named stylist is not paid twice; paying again changes nothing', async () => {
    const v = await visit({ serviceId: cut, stylistId: ana })
    // retail on the bill (checkout at the chair adds these lines, gap #7): a $50 shampoo
    await t.db.insert(t.schema.invoiceLineItem).values({ invoiceId: v.invoice.id, description: 'Shampoo', type: 'retail', quantity: '1', unitPrice: '50', total: '50', sortOrder: 1 } as any)
    await t.db.update(t.schema.invoice).set({ subtotal: '150', total: '150' } as any).where(eq(t.schema.invoice.id, v.invoice.id))
    expect((await pay(v.invoice.id, 150)).status).toBeLessThan(300)
    // Ana is named on the services plan, so the house services plan does not pay her too; the general retail plan does.
    const want: Array<[string, string, string]> = [['100.00', '40.00', servicesAna], ['50.00', '5.00', retailAll]]
    expect(await owedTo(ana, v.invoice.id)).toEqual(want.sort())
    expect(await owedTo(bea, v.invoice.id)).toEqual([])
    // a second look (a second payment attempt, the sweep) pays nothing more
    await pay(v.invoice.id, 1)
    expect((await owedTo(ana, v.invoice.id)).length).toBe(2)
  })

  test('another stylist is paid by the house plan; a discount lowers the base; tax is not paid on', async () => {
    const v = await visit({ serviceId: cut, stylistId: bea })
    await t.db.update(t.schema.invoice).set({ discount: '20', taxRate: '10', taxAmount: '8', total: '88' } as any).where(eq(t.schema.invoice.id, v.invoice.id))
    expect((await pay(v.invoice.id, 88)).status).toBeLessThan(300)
    expect(await owedTo(bea, v.invoice.id)).toEqual([['80.00', '24.00', servicesHouse]])
  })

  test('a visit with two services pays each stylist for their own', async () => {
    await features([...FEATURES, 'salon_commissions', 'multi_service_visits'])
    const v = await visit({ items: [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }] })
    expect((await pay(v.invoice.id, 300)).status).toBeLessThan(300)
    expect(await owedTo(ana, v.invoice.id)).toEqual([['200.00', '80.00', servicesAna]])
    expect(await owedTo(bea, v.invoice.id)).toEqual([['100.00', '30.00', servicesHouse]])
  })

  test('a tiered plan finds its bracket from the stylist\'s sales this month, and pays that rate on the sale in hand', async () => {
    tiered = (await plan({ name: 'Cat tiers', planType: 'tiered', salesKind: 'services', userIds: [cat], tiers: [{ min: 0, max: 150, rate: 40 }, { min: 150.01, max: 100000, rate: 50 }] })).body.id
    expect(tiered).toBeTruthy()
    const first = await visit({ serviceId: cut, stylistId: cat })
    await pay(first.invoice.id, 100)
    const second = await visit({ serviceId: cut, stylistId: cat })
    await pay(second.invoice.id, 100)
    expect(await owedTo(cat, first.invoice.id)).toEqual([['100.00', '40.00', tiered]])        // $100 so far: the 40% bracket
    expect(await owedTo(cat, second.invoice.id)).toEqual([['100.00', '50.00', tiered]])       // $200 so far: the 50% bracket, on this sale only
  })

  test('each stylist reads only their own earnings and statement; the owner reads all', async () => {
    const mine = (await as('ana', '/api/commissions')).body.data as any[]
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.userId === ana)).toBe(true)
    expect((await as('ana', `/api/commissions/statement?userId=${ana}`)).status).toBe(200)
    expect((await as('ana', `/api/commissions/statement?userId=${bea}`)).status).toBe(403)
    expect((await as('owner', `/api/commissions/statement?userId=${bea}`)).status).toBe(200)
    // a stylist cannot approve (their own or anyone's)
    const row = mine[0]
    expect((await as('ana', `/api/commissions/${row.id}/approve`, 'POST')).status).toBe(403)
    expect((await as('owner', `/api/commissions/${row.id}/approve`, 'POST')).status).toBe(200)
  })

  test('refunded in full: an unpaid commission is cancelled; a paid-out one is taken back with a new line', async () => {
    const v = await visit({ serviceId: cut, stylistId: bea })
    await pay(v.invoice.id, 100); await settle()
    const [earned] = (await as('owner', `/api/commissions?userId=${bea}`)).body.data.filter((r: any) => r.invoiceId === v.invoice.id)
    expect(earned.status).toBe('pending')
    expect((await as('owner', `/api/invoices/${v.invoice.id}/refund`, 'POST', { amount: 100, method: 'cash' })).status).toBeLessThan(300)
    await settle()
    const after = (await as('owner', `/api/commissions?userId=${bea}`)).body.data.filter((r: any) => r.invoiceId === v.invoice.id)
    expect(after.map((r: any) => r.status)).toEqual(['cancelled'])
    // one already paid out
    const w = await visit({ serviceId: cut, stylistId: bea })
    await pay(w.invoice.id, 100); await settle()
    const [row] = (await as('owner', `/api/commissions?userId=${bea}`)).body.data.filter((r: any) => r.invoiceId === w.invoice.id)
    await as('owner', `/api/commissions/${row.id}/approve`, 'POST')
    await as('owner', `/api/commissions/${row.id}/mark-paid`, 'POST')
    expect((await as('owner', `/api/invoices/${w.invoice.id}/refund`, 'POST', { amount: 100, method: 'cash' })).status).toBeLessThan(300)
    await settle()
    const back = (await as('owner', `/api/commissions?userId=${bea}`)).body.data.filter((r: any) => r.invoiceId === w.invoice.id)
    expect(back.map((r: any) => [r.source, r.commissionAmount]).sort()).toEqual([['auto', '30.00'], ['reversal', '-30.00']])
  })
})
