// Commission depth (salon row 15; server crm/salon/commissions.ts, commissionPlans.ts, the shared commission routes): volume tiers and a tier period of
// a week / fortnight / month / quarter, commission on packages, gift cards and memberships (to whoever sold them), a plan for one service or product or
// one category (the most specific plan pays), a partial refund that reverses in proportion, a chair-only stylist who is paid, and duplicate plans refused.
// Every figure is worked by hand in the comments.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { clashWith, periodStart, specificity, winningPlan, type SaleLine } from '../server/crm/salon/commissionPlans.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'salon_retail', 'salon_gift_cards', 'salon_memberships', 'chair_checkout', 'salon_reports']
const PASSWORD = 'Depth-1031-xx'

describe('salon: commission depth — pure rules', () => {
  test('a tier period starts on the first day of the week (Monday), fortnight, month or quarter', () => {
    expect(periodStart('2026-11-10', 'week')).toBe('2026-11-09')               // 10 Nov 2026 is a Tuesday
    expect(periodStart('2026-11-09', 'week')).toBe('2026-11-09')
    expect(periodStart('2026-11-08', 'week')).toBe('2026-11-02')               // a Sunday belongs to the week that began the Monday before
    expect(periodStart('2026-01-04', 'week')).toBe('2025-12-29')               // across a year
    expect(periodStart('2026-11-10', 'fortnight')).toBe('2026-11-02')          // fortnights are counted from Monday 1 Jan 2024: 1,044 days → 1,044 mod 14 = 8 days in
    expect(periodStart('2026-11-16', 'fortnight')).toBe('2026-11-16')          // 1,050 days: a new fortnight starts
    expect(periodStart('2026-11-10', 'month')).toBe('2026-11-01')
    expect(periodStart('2026-11-10', 'quarter')).toBe('2026-10-01')
    expect(periodStart('2026-03-31', 'quarter')).toBe('2026-01-01')
    expect(periodStart('2026-04-01', 'quarter')).toBe('2026-04-01')
    expect(periodStart('2026-11-10', undefined)).toBe('2026-11-01')            // no cadence = the month, as before
  })

  const line = (over: Partial<SaleLine>): SaleLine => ({ kind: 'services', payee: 'p', amount: 100, units: 1, serviceId: 's1', category: 'colour', productId: null, productCategory: null, ...over })
  test('the most specific plan that pays a person for a line wins: an item, then its category, then everything; a named person beats nobody named', () => {
    const all = { id: 'all', salesKind: 'services', userIds: [], scope: {}, createdAt: '2026-01-01' }
    const named = { id: 'named', salesKind: 'services', userIds: ['p'], scope: {}, createdAt: '2026-01-02' }
    const cat = { id: 'cat', salesKind: 'services', userIds: [], scope: { serviceCategories: ['Colour'] }, createdAt: '2026-01-03' }
    const item = { id: 'item', salesKind: 'services', userIds: [], scope: { serviceIds: ['s1'] }, createdAt: '2026-01-04' }
    const other = { id: 'other', salesKind: 'services', userIds: ['q'], scope: { serviceIds: ['s1'] }, createdAt: '2026-01-05' }
    expect(winningPlan([all], 'p', line({}))?.id).toBe('all')
    expect(winningPlan([all, named], 'p', line({}))?.id).toBe('named')
    expect(winningPlan([all, named, cat], 'p', line({}))?.id).toBe('cat')                  // a category beats a plan for everything, even one naming the person
    expect(winningPlan([all, named, cat, item], 'p', line({}))?.id).toBe('item')
    expect(winningPlan([all, named, cat, item, other], 'p', line({}))?.id).toBe('item')      // a plan for someone else never pays this person
    expect(winningPlan([all, cat], 'p', line({ category: 'hair', serviceId: 's2' }))?.id).toBe('all')   // the category plan does not cover hair
    expect(winningPlan([cat, item], 'p', line({ category: 'hair', serviceId: 's2' }))).toBeNull()      // and a scoped plan covers nothing else
    expect(specificity({ salesKind: 'retail', scope: {} }, line({}))).toBe(0)                // a retail plan does not cover a service
    expect(specificity({ salesKind: 'all', scope: {} }, line({ kind: 'gift_cards' }))).toBe(0)   // "all" is services and retail, not gift cards
    expect(specificity({ salesKind: 'gift_cards', scope: {} }, line({ kind: 'gift_cards' }))).toBe(1)
    expect(winningPlan([{ ...all, isActive: false }], 'p', line({}))).toBeNull()
  })

  test('two plans for the same people, sales and dates clash; an item beside everything, or a named person beside nobody, does not', () => {
    const base = { id: 'a', name: 'House services', salesKind: 'services', autoEarn: 'visit_stylist', userIds: [], scope: {} }
    expect(clashWith({ ...base, id: 'b', name: 'Again' }, [base])).toContain('"House services" already pays everyone on services')
    expect(clashWith({ ...base, id: 'b' }, [base], 'a')).toBeNull()                                  // a plan is not a clash with itself
    expect(clashWith({ ...base, id: 'b', salesKind: 'retail' }, [base])).toBeNull()                  // other sales
    expect(clashWith({ ...base, id: 'b', salesKind: 'all' }, [base])).not.toBeNull()                 // "all" includes services
    expect(clashWith({ ...base, id: 'b', salesKind: 'gift_cards' }, [{ ...base, salesKind: 'all' }])).toBeNull()
    expect(clashWith({ ...base, id: 'b', userIds: ['x'] }, [base])).toBeNull()                       // one named person beside the general plan
    expect(clashWith({ ...base, id: 'b', userIds: ['x', 'y'] }, [{ ...base, userIds: ['y', 'z'] }])).toContain('the same stylist')
    expect(clashWith({ ...base, id: 'b', scope: { serviceIds: ['s1'] } }, [base])).toBeNull()        // an item beside everything
    expect(clashWith({ ...base, id: 'b', scope: { serviceIds: ['s1'] } }, [{ ...base, scope: { serviceIds: ['s1', 's2'] } }])).not.toBeNull()
    expect(clashWith({ ...base, id: 'b', scope: { serviceCategories: ['Colour'] } }, [{ ...base, scope: { serviceCategories: ['colour'] } }])).not.toBeNull()   // a category is compared without case
    expect(clashWith({ ...base, id: 'b', scope: { serviceIds: ['s1'] } }, [{ ...base, scope: { serviceCategories: ['colour'] } }])).toBeNull()                  // an item beside its category
    expect(clashWith({ ...base, id: 'b' }, [{ ...base, isActive: false }])).toBeNull()               // a retired plan
    expect(clashWith({ ...base, id: 'b', autoEarn: 'none' }, [base])).toBeNull()                     // a plan that pays nobody by itself
    // dates: a plan ending before another begins is no clash
    expect(clashWith({ ...base, id: 'b', effectiveFrom: '2026-07-01' }, [{ ...base, effectiveTo: '2026-06-30' }])).toBeNull()
    expect(clashWith({ ...base, id: 'b', effectiveFrom: '2026-06-30' }, [{ ...base, effectiveTo: '2026-06-30' }])).not.toBeNull()
  })
})

describe('salon: commission depth — through the app', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cat = '', dee = '', eve = '', chi = ''
  let cut = '', colour = '', treatment = '', gloss = '', mask = '', dye = ''
  const tokens: Record<string, string> = {}
  let ip = 0, hour = 7
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html or csv */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = addDays(today(), -2)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A completed visit for a new client (which raises the bill). */
  async function visit(serviceId: string, stylistId: string) {
    const client = await ins(t.schema.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(day, `${String(hour % 24).padStart(2, '0')}:00`), serviceId, stylistId })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  async function settle() {
    let last = '', stable = 0
    for (let i = 0; i < 50 && stable < 3; i++) {
      const now = JSON.stringify((await t.db.select().from(t.schema.commission)).map((r: any) => [r.id, r.status, r.baseAmount, r.commissionAmount]).sort())
      stable = now === last ? stable + 1 : 0; last = now
      await Bun.sleep(40)
    }
  }
  const pay = async (id: string, amount?: number) => { const r = await as('owner', `/api/invoices/${id}/payments`, 'POST', { amount: amount ?? Number((await invoiceOf(id)).total), method: 'cash' }); expect(r.status).toBeLessThan(300); await settle() }
  const refund = async (id: string, amount: number) => { const r = await as('owner', `/api/invoices/${id}/refund`, 'POST', { amount, method: 'cash' }); expect(r.status).toBeLessThan(300); await settle() }
  const plan = (body: Record<string, unknown>) => as('owner', '/api/commissions/plans', 'POST', { appliesToRole: 'technician', autoEarn: 'visit_stylist', planType: 'percent_of_invoice', ...body })
  const made = async (body: Record<string, unknown>) => { const r = await plan(body); expect([r.status, r.body.error]).toEqual([201, undefined]); return r.body.id as string }
  /** What a person was paid on a bill: [base, amount, plan name] for each commission, as numbers. */
  const rowsOf = async (userId: string, invoiceId: string) => {
    await settle()
    const plans = new Map<string, string>(((await as('owner', '/api/commissions/plans')).body.data as any[]).map((p) => [p.id, p.name]))
    const rows = ((await as('owner', `/api/commissions?userId=${userId}`)).body.data as any[]).filter((r) => r.invoiceId === invoiceId && r.status !== 'cancelled')
    return rows.map((r) => [Number(r.baseAmount), Number(r.commissionAmount), plans.get(r.planId) ?? r.source] as [number, number, string]).sort((a, b) => a[2].localeCompare(b[2]) || a[0] - b[0])
  }
  const product = async (b: Record<string, unknown>) => { const r = await as('owner', '/api/salon-retail/products', 'POST', { openingStock: 10, ...b }); expect(r.status).toBe(201); return r.body.product.id as string }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Glow Studio', settings: { defaultTaxRate: 0 } } as any).where(eq(t.schema.company.id, co))
    await features([...FEATURES, 'salon_commissions'])
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const key of ['ana', 'bea', 'cat', 'dee', 'eve']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea, cat, dee, eve } = ids as any)
    chi = (await ins(t.schema.teamMember, { companyId: co, name: 'Chi Nguyen', email: 'chi@example.com', role: 'stylist' })).id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 200 })).body.id
    treatment = (await as('owner', '/api/service-menu', 'POST', { name: 'Treatment', category: 'hair', durationMin: 30, price: 60 })).body.id
    gloss = await product({ name: 'Gloss', brand: 'Aveda', category: 'Care', priceCents: 3000 })
    mask = await product({ name: 'Mask', brand: 'Aveda', category: 'Care', priceCents: 4000 })
    dye = await product({ name: 'Dye', brand: 'Wella', category: 'Color', priceCents: 1000 })
  }, 120_000)

  test('plans are checked: brackets that overlap or are not whole numbers, a scope that does not fit the sales, a stranger as the person', async () => {
    const bad = (b: Record<string, unknown>) => plan({ name: 'Bad', ...b })
    const tiers = [{ min: 0, max: 5, rate: 30 }, { min: 5, max: 9, rate: 40 }]
    expect((await bad({ planType: 'tiered', salesKind: 'services', tierBasis: 'count', tiers, userIds: [ana] })).body.error).toContain('overlap')
    expect((await bad({ planType: 'tiered', salesKind: 'services', tierBasis: 'count', tiers: [{ min: 0, max: 2.5, rate: 30 }], userIds: [ana] })).body.error).toContain('whole numbers')
    expect((await bad({ salesKind: 'retail', percentRate: 10, scope: { serviceIds: [cut] }, userIds: [ana] })).body.error).toContain('particular services')
    expect((await bad({ salesKind: 'services', percentRate: 10, scope: { productIds: [gloss] }, userIds: [ana] })).body.error).toContain('particular products')
    expect((await bad({ salesKind: 'services', percentRate: 10, tierCadence: 'daily', userIds: [ana] })).status).toBe(400)
    expect((await bad({ salesKind: 'sandwiches', percentRate: 10, userIds: [ana] })).status).toBe(400)
    expect((await bad({ salesKind: 'services', percentRate: 10, userIds: ['nobody'] })).body.code).toBe('plan_people')
    const refused = await as('ana', '/api/commissions/plans', 'POST', { name: 'Mine', planType: 'percent_of_invoice', percentRate: 90, appliesToRole: 'technician', salesKind: 'packages' })
    expect(refused.status).toBe(403)
    expect(((await as('owner', '/api/commissions/plans')).body.data as any[]).filter((p) => p.name === 'Bad')).toHaveLength(0)
  })

  test('volume tiers: the bracket is how many services were sold this month, this one included, and the rate is not paid back', async () => {
    // Ana: 2 services or fewer pay 30%, 3 to 9 pay 40%.
    await made({ name: 'Ana volume', salesKind: 'services', planType: 'tiered', tierBasis: 'count', tierCadence: 'month', tiers: [{ min: 0, max: 2, rate: 30 }, { min: 3, max: 9, rate: 40 }], userIds: [ana] })
    const bills: string[] = []
    for (let i = 0; i < 3; i++) { const b = await visit(cut, ana); await pay(b); bills.push(b) }
    expect(await rowsOf(ana, bills[0])).toEqual([[100, 30, 'Ana volume']])       // the 1st service: 1 sold → 30% of 100
    expect(await rowsOf(ana, bills[1])).toEqual([[100, 30, 'Ana volume']])       // the 2nd: 2 sold → still 30%
    expect(await rowsOf(ana, bills[2])).toEqual([[100, 40, 'Ana volume']])       // the 3rd: 3 sold → 40% of this sale only; the first two stay at 30%
    const row = (await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, bills[2])))[0] as any
    expect([row.units, Number(row.rateApplied)]).toEqual([1, 40])
    const list = (await as('owner', '/api/commissions/plans')).body.data.find((p: any) => p.name === 'Ana volume')
    expect([list.tierBasis, list.tierCadence]).toEqual(['count', 'month'])
  })

  test('the tier period decides what is counted: a week ago is not this week', async () => {
    // Bea: 1 service pays 10%, 2 to 9 pay 50%, counted over the week.
    await made({ name: 'Bea weekly', salesKind: 'services', planType: 'tiered', tierBasis: 'count', tierCadence: 'week', tiers: [{ min: 0, max: 1, rate: 10 }, { min: 2, max: 9, rate: 50 }], userIds: [bea] })
    const first = await visit(cut, bea); await pay(first)
    expect(await rowsOf(bea, first)).toEqual([[100, 10, 'Bea weekly']])
    // That sale was made eight days ago — a week that is over.
    const back = new Date(Date.now() - 8 * 86400_000)
    await t.db.update(t.schema.commission).set({ earnedAt: back } as any).where(eq(t.schema.commission.invoiceId, first))
    await t.db.update(t.schema.invoice).set({ paidAt: back } as any).where(eq(t.schema.invoice.id, first))
    const second = await visit(cut, bea); await pay(second)
    expect(await rowsOf(bea, second)).toEqual([[100, 10, 'Bea weekly']])          // 1 this week → 10% (counted over the month it would have been 2 → 50%)
    const third = await visit(cut, bea); await pay(third)
    expect(await rowsOf(bea, third)).toEqual([[100, 50, 'Bea weekly']])           // 2 this week → 50%
  })

  test('a plan for one service or product beats its category, which beats a plan for everything', async () => {
    await made({ name: 'Dee services 30', salesKind: 'services', percentRate: 30, userIds: [dee] })
    await made({ name: 'Dee colour 35', salesKind: 'services', percentRate: 35, scope: { serviceCategories: ['Colour'] }, userIds: [dee] })
    await made({ name: 'Dee treatment 50', salesKind: 'services', percentRate: 50, scope: { serviceIds: [treatment] }, userIds: [dee] })
    await made({ name: 'Dee retail 10', salesKind: 'retail', percentRate: 10, userIds: [dee] })
    await made({ name: 'Dee care 20', salesKind: 'retail', percentRate: 20, scope: { productCategories: ['care'] }, userIds: [dee] })
    await made({ name: 'Dee gloss 25', salesKind: 'retail', percentRate: 25, scope: { productIds: [gloss] }, userIds: [dee] })
    const cutBill = await visit(cut, dee), colourBill = await visit(colour, dee), treatmentBill = await visit(treatment, dee)
    // retail on the cut's bill: Gloss 30 + Mask 40 + Dye 10 → the bill is 180
    expect((await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: cutBill, items: [{ productId: gloss, quantity: 1 }, { productId: mask, quantity: 1 }, { productId: dye, quantity: 1 }] })).status).toBe(200)
    await pay(cutBill); await pay(colourBill); await pay(treatmentBill)
    expect(await rowsOf(dee, cutBill)).toEqual([
      [10, 1, 'Dee retail 10'],            // Dye: nothing more specific → 10% of 10
      [40, 8, 'Dee care 20'],              // Mask is in the Care category → 20% of 40
      [30, 7.5, 'Dee gloss 25'],           // Gloss is in Care too, but a plan for the product itself wins → 25% of 30
      [100, 30, 'Dee services 30'],        // the cut: only the plan for everything covers it → 30% of 100
    ].sort((a: any, b: any) => (a[2] as string).localeCompare(b[2]) || a[0] - b[0]) as any)
    expect(await rowsOf(dee, colourBill)).toEqual([[200, 70, 'Dee colour 35']])       // colour category → 35% of 200
    expect(await rowsOf(dee, treatmentBill)).toEqual([[60, 30, 'Dee treatment 50']])  // the treatment itself → 50% of 60 (hair would have been 30%)
  })

  test('packages, gift cards and memberships are paid to whoever sold them, and only by a plan that names them', async () => {
    await made({ name: 'Eve gift cards', salesKind: 'gift_cards', percentRate: 5, userIds: [eve] })
    await made({ name: 'Eve memberships', salesKind: 'memberships', percentRate: 10, userIds: [eve] })
    await made({ name: 'Eve packages', salesKind: 'packages', percentRate: 15, userIds: [eve] })
    await made({ name: 'Eve everything', salesKind: 'all', percentRate: 20, userIds: [eve] })          // "all" is services and retail; it must not pay on these
    // a gift card sold at the desk by Eve
    expect((await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash', soldBy: 'nobody' })).body.code).toBe('BAD_SELLER')
    const gift = await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash', soldBy: eve })
    expect(gift.status).toBe(201)
    expect(await rowsOf(eve, gift.body.invoiceId)).toEqual([[50, 2.5, 'Eve gift cards']])                  // 5% of 50.00
    // the same sale with nobody named earns nobody
    const unsold = await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash' })
    await settle()
    expect(await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, unsold.body.invoiceId))).toHaveLength(0)
    // a membership and a prepaid package
    const client = await ins(t.schema.contact, { companyId: co, name: 'Member Mel', email: 'mel@example.com', type: 'client' })
    const open = (await as('owner', '/api/memberships', 'POST', { name: 'Glow Club', price: 80, billingCycle: 'monthly' })).body
    const block = (await as('owner', '/api/memberships', 'POST', { name: 'Five Cuts', price: 200, billingCycle: 'one_time', creditsTotal: 5 })).body
    const planOf = (r: any) => r.id ?? r.data?.id ?? r.plan?.id
    expect((await as('owner', '/api/memberships/enrollments', 'POST', { contactId: client.id, planId: planOf(open), soldBy: 'nobody' })).body.code).toBe('BAD_SELLER')
    const m1 = await as('owner', '/api/memberships/enrollments', 'POST', { contactId: client.id, planId: planOf(open), soldBy: eve })
    expect(m1.status).toBe(201)
    const m2 = await as('owner', '/api/memberships/enrollments', 'POST', { contactId: client.id, planId: planOf(block), soldBy: eve })
    expect(m2.status).toBe(201)
    await pay(m1.body.invoiceId); await pay(m2.body.invoiceId)
    expect(await rowsOf(eve, m1.body.invoiceId)).toEqual([[80, 8, 'Eve memberships']])                     // 10% of 80.00
    expect(await rowsOf(eve, m2.body.invoiceId)).toEqual([[200, 30, 'Eve packages']])                      // 15% of 200.00
    // the commission reports name the line
    const lines = (await as('owner', `/api/salon-reports/commissions/lines?from=${addDays(today(), -1)}&to=${addDays(today(), 1)}&userId=${eve}`)).body.lines as any[]
    expect(lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([2.5, 8, 30])
  })

  test('a partial refund reverses in proportion: an unpaid commission shrinks from its original, a paid one is taken back in steps', async () => {
    await made({ name: 'Cat services 40', salesKind: 'services', percentRate: 40, userIds: [cat] })
    // unpaid: a 200.00 colour earns 80.00
    const a = await visit(colour, cat); await pay(a)
    expect(await rowsOf(cat, a)).toEqual([[200, 80, 'Cat services 40']])
    await refund(a, 50)                                                                                    // 25% refunded → keeps 75%: base 150, commission 60
    expect(await rowsOf(cat, a)).toEqual([[150, 60, 'Cat services 40']])
    await refund(a, 50)                                                                                    // 50% in all → from the original 200 / 80: base 100, commission 40
    expect(await rowsOf(cat, a)).toEqual([[100, 40, 'Cat services 40']])
    const kept = (await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, a)))[0] as any
    expect([Number(kept.originalBase), Number(kept.originalAmount), Number(kept.refundedRatio)]).toEqual([200, 80, 0.5])
    expect(kept.notes).toContain('Reduced')
    await t.services.crm.earnCommission(a); await settle()                                                  // looking again changes nothing
    expect(await rowsOf(cat, a)).toEqual([[100, 40, 'Cat services 40']])
    await refund(a, 100)                                                                                    // all of it: cancelled, as before
    expect((await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, a)))[0].status).toBe('cancelled')

    // paid out: a 100.00 cut earns 40.00, is approved and paid
    const b = await visit(cut, cat); await pay(b)
    const earned = (await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, b)))[0] as any
    expect((await as('owner', `/api/commissions/${earned.id}/approve`, 'POST', {})).status).toBe(200)
    expect((await as('owner', `/api/commissions/${earned.id}/mark-paid`, 'POST', {})).status).toBe(200)
    await refund(b, 25)                                                                                     // 25% back → take back 25% of 40.00
    await refund(b, 25)                                                                                     // 50% in all → another 25% of the original
    const rows = (await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, b))) as any[]
    const back = rows.filter((r) => r.source === 'refund').sort((x, y) => Number(x.refundedRatio) - Number(y.refundedRatio))
    expect(back.map((r) => [Number(r.baseAmount), Number(r.commissionAmount), Number(r.refundedRatio)])).toEqual([[-25, -10, 0.25], [-25, -10, 0.5]])
    expect(rows.find((r) => r.id === earned.id).commissionAmount).toBe('40.00')                              // what was paid is never rewritten
    await t.services.crm.earnCommission(b); await settle()
    expect(((await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, b))) as any[]).filter((r) => r.source === 'refund')).toHaveLength(2)
    await refund(b, 50)                                                                                     // the rest: the remainder of the commission comes back
    const all = (await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, b))) as any[]
    expect(all.filter((r) => r.source === 'reversal').map((r) => [Number(r.baseAmount), Number(r.commissionAmount)])).toEqual([[-50, -20]])   // 40 − 10 − 10 = 20 left to take back
    expect(all.reduce((t2, r) => t2 + Number(r.commissionAmount), 0)).toBe(0)                                // paid 40, taken back 10 + 10 + 20
    const statement = (await as('owner', `/api/commissions/statement?userId=${cat}`)).body
    expect(statement.lines.some((l: any) => l.source === 'refund')).toBe(true)
  })

  test('a chair-only stylist with no login is paid, named on the list, the statement and the payroll file', async () => {
    const people = (await as('owner', '/api/commissions/payees')).body.data as any[]
    expect(people.find((p) => p.id === chi)).toMatchObject({ name: 'Chi Nguyen', login: false })
    expect(people.find((p) => p.id === ana)).toMatchObject({ login: true })
    await made({ name: 'Chi services 35', salesKind: 'services', percentRate: 35, userIds: [chi] })
    await made({ name: 'Chi retail 10', salesKind: 'retail', percentRate: 10, userIds: [chi] })
    const bill = await visit(colour, chi)                                                                   // the visit's stylist is Chi, who has no login
    expect((await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, (await invoiceOf(bill)).appointmentId)))[0].stylistMemberId).toBe(chi)
    await pay(bill)
    expect(await rowsOf(chi, bill)).toEqual([[200, 70, 'Chi services 35']])                                  // 35% of 200
    const walkIn = await as('owner', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: mask, quantity: 1 }], stylistMemberId: chi })
    expect(walkIn.status).toBe(201)
    await pay(walkIn.body.invoiceId)
    expect(await rowsOf(chi, walkIn.body.invoiceId)).toEqual([[40, 4, 'Chi retail 10']])                     // a walk-in retail sale naming Chi: 10% of 40
    const list = (await as('owner', `/api/commissions?userId=${chi}`)).body.data as any[]
    expect(list.every((r) => r.userName === 'Chi Nguyen')).toBe(true)
    expect((await as('owner', `/api/commissions/statement?userId=${chi}`)).body.person).toEqual({ id: chi, name: 'Chi Nguyen' })
    // approve, then the payroll file lists them by name
    for (const r of list) expect((await as('owner', `/api/commissions/${r.id}/approve`, 'POST', {})).status).toBe(200)
    const q = `from=${addDays(today(), -1)}&to=${addDays(today(), 1)}`
    const csv = (await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=gusto`)).body as string
    expect(csv.split('\n')).toContain('"Chi","Nguyen","chi@example.com",74.00')                              // 70 + 4
    // a person from another salon cannot be named
    expect((await plan({ name: 'Stranger', salesKind: 'services', percentRate: 5, userIds: ['someone-else'] })).body.code).toBe('plan_people')
  })

  test('a second plan paying the same people the same sales is refused, with the words; a different sale, a retired plan or its own edit is not', async () => {
    const dup = await plan({ name: 'Ana again', salesKind: 'services', percentRate: 50, userIds: [ana] })
    expect([dup.status, dup.body.code]).toEqual([409, 'duplicate_plan'])
    expect(dup.body.error).toContain('"Ana volume" already pays the same stylist on services')
    expect((await plan({ name: 'Ana and Bea', salesKind: 'all', percentRate: 50, userIds: [ana, bea] })).status).toBe(409)       // shares Ana; "all" includes services
    expect((await plan({ name: 'Ana retail', salesKind: 'retail', percentRate: 5, userIds: [ana] })).status).toBe(201)             // other sales
    const dees = await plan({ name: 'Dee colour again', salesKind: 'services', percentRate: 5, scope: { serviceCategories: ['COLOUR'] }, userIds: [dee] })
    expect(dees.status).toBe(409)                                                                                               // the same category, any case
    const planId = ((await as('owner', '/api/commissions/plans')).body.data as any[]).find((p) => p.name === 'Ana volume').id
    expect((await as('owner', `/api/commissions/plans/${planId}`, 'PUT', { name: 'Ana volume (renamed)' })).status).toBe(200)   // not a clash with itself
    const other = await plan({ name: 'Bea services', salesKind: 'services', percentRate: 5, userIds: [bea] })
    expect(other.status).toBe(409)                                                                                              // Bea already has a weekly services plan
    const moved = await as('owner', `/api/commissions/plans/${planId}`, 'PUT', { userIds: [ana, bea] })
    expect([moved.status, moved.body.code]).toEqual([409, 'duplicate_plan'])                                                    // an edit that would make one
    expect((await as('owner', `/api/commissions/plans/${planId}`, 'DELETE')).status).toBe(204)                                  // retire it...
    expect((await plan({ name: 'Ana new services', salesKind: 'services', percentRate: 45, userIds: [ana] })).status).toBe(201)  // ...and a new one is fine
  })
})
