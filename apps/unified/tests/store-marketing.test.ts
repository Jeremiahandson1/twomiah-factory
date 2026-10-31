// Gap 3 against Shopify (2026-10-30): marketing for the store — campaigns aimed at customer groups and tags, a welcome
// email on a first order, and a win-back after N days (the owner's N, off until set), built in the SHARED marketing
// module so every trade with Email Marketing gets the win-back in its own terms (a job, a visit, an order, an event).
//   · email_marketing and google_reviews are OFFERED to the store but never switched on for it: not in a new shop's
//     starting set, not added by a feature sync, 403 until the owner turns them on;
//   · the audience: a tag, a customer group, "no order in N days" — a filter asked for and not usable matches nobody;
//   · the welcome: off by default; once, on a customer's first paid order; never to someone who unsubscribed;
//   · the win-back: off by default; once per lapse; only to those who crossed N lately (switching it on mails no one
//     who has been gone for a year); never to someone who unsubscribed; each trade reads its own idea of coming back;
//   · a delivered or picked-up order asks for a Google review when Review Requests is on.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate, getFeaturesForTemplate, withinOffer } from '@twomiah/tenant-backend'
import { lastActivityFor } from '../server/data/marketingActivity.ts'
import { createMarketingService } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
const MARKETING = '/api/marketing'
const ON = ['dashboard', 'orders', 'products', 'contacts', 'email_marketing']
const features = async (list: string[]) => {
  await (k.t.db as any).update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const db = () => k.t.db as any
const marketing = () => (k.t.services.crm as any).marketing as ReturnType<typeof createMarketingService>
const logFor = async (email: string) => (await db().select().from(k.S.emailLog).where(eq(k.S.emailLog.to, email))) as any[]
const sends = async (contactId: string) => (await db().select().from(k.S.marketingAutomationSend).where(eq(k.S.marketingAutomationSend.contactId, contactId))) as any[]

let seq = 0
/** A customer; `orderDaysAgo` gives them one counted order that long ago. */
async function customer(o: { email?: string | null; tags?: string[]; optOut?: boolean; orderDaysAgo?: number; name?: string }) {
  const n = ++seq
  const email = o.email === undefined ? `shopper${n}@example.com` : o.email
  const [c] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: o.name ?? `Shopper ${n}`, email, type: 'customer', tags: o.tags ?? [], emailOptOut: !!o.optOut }).returning()
  if (o.orderDaysAgo !== undefined) {
    await db().insert(k.S.storeOrder).values({
      companyId: k.companyId, contactId: c.id, provider: 'stripe', providerSessionId: `cs_t_${Math.random().toString(36).slice(2, 12)}`, status: 'paid', customerEmail: email ?? 'x@example.com', subtotalCents: 2000, totalCents: 2000,
      orderNumber: `T-${n}-${Math.random().toString(36).slice(2, 7)}`, createdAt: ago(o.orderDaysAgo),
    }).returning()
  }
  return c as { id: string; email: string | null }
}
const preview = async (filter: Record<string, unknown>) => (await k.O('POST', `${MARKETING}/audience/preview`, { audienceType: 'segment', audienceFilter: filter })).json.count as number

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await k.connectStripe()
  await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
}, 120_000)
afterAll(() => k.restore())

describe('offered, never switched on', () => {
  test('the store is offered Email Marketing and Review Requests as opt-in: neither is in a starting set', () => {
    for (const id of ['email_marketing', 'google_reviews']) {
      expect(FEATURE_MAP[id].templates).toContain('crm-store')
      expect(FEATURE_MAP[id].optIn).toContain('crm-store')
      expect(getFeaturesForTemplate('crm-store').map((f) => f.id)).toContain(id)
      expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain(id)
      // The other trades keep them as they were: in their starting sets.
      expect(getDefaultFeaturesForTemplate('crm-salon')).toContain(id)
    }
  })

  test('a feature list the live shop already has stays as it is: nothing in the offer adds the new ones', () => {
    const live = getDefaultFeaturesForTemplate('crm-store')
    expect(withinOffer('crm-store', live)).toEqual(live)
    expect(withinOffer('crm-store', live)).not.toContain('email_marketing')
  })

  test('a store that has not switched them on gets 403 from Marketing; switched on, it opens', async () => {
    const company = (await db().select().from(k.S.company).where(eq(k.S.company.id, k.companyId)))[0]
    expect(company.enabledFeatures ?? []).not.toContain('email_marketing')
    await features(['dashboard', 'orders', 'products', 'contacts'])
    const off = await k.O('GET', `${MARKETING}/campaigns`)
    expect(off.status).toBe(403)
    expect(off.json.code).toBe('FEATURE_NOT_ENABLED')
    expect((await k.O('GET', `${MARKETING}/automations`)).status).toBe(403)
    await features(ON)
    expect((await k.O('GET', `${MARKETING}/campaigns`)).status).toBe(200)
  })
})

describe('who a campaign goes to', () => {
  let wholesaleGroup = ''
  beforeAll(async () => {
    await features(ON)
    const g = await k.M('POST', '/api/admin/customer-groups', { name: 'Wholesale', percentOff: 20 })
    wholesaleGroup = g.json.id
  })

  test('by tag: those carrying it, and a tag that is asked for and unusable is nobody', async () => {
    const a = await customer({ tags: ['wholesale', 'bird-club'] })
    await customer({ tags: ['retail'] })
    await customer({ tags: [] })
    await customer({ tags: ['wholesale'], optOut: true }) // unsubscribed: never
    await customer({ tags: ['wholesale'], email: null }) // no address: never
    expect(await preview({ tag: 'wholesale' })).toBe(1)
    expect(await preview({ tag: 'bird-club' })).toBe(1)
    expect(await preview({ tag: 'nobody-has-this' })).toBe(0)
    expect(await preview({ tag: 42 })).toBe(0)
    expect(await preview({ tag: '' })).toBe(0)
    expect(a.id).toBeTruthy()
  })

  test('by customer group: the members, and an id that is no group is nobody', async () => {
    const m = await customer({ tags: [] })
    await customer({ tags: [] })
    await db().insert(k.S.storeCustomerGroupMember).values({ companyId: k.companyId, groupId: wholesaleGroup, contactId: m.id })
    expect(await preview({ customerGroupId: wholesaleGroup })).toBe(1)
    expect(await preview({ customerGroupId: 'not-a-group' })).toBe(0)
    expect(await preview({ customerGroupId: 7 })).toBe(0)
  })

  test('by "no order in N days": customers who have ordered, and not lately; never someone who has not ordered', async () => {
    await customer({ orderDaysAgo: 120 })
    await customer({ orderDaysAgo: 95 })
    await customer({ orderDaysAgo: 5 })
    const base = await preview({ inactiveDays: 90 })
    expect(base).toBe(2)
    expect(await preview({ inactiveDays: 30 })).toBe(2)
    expect(await preview({ inactiveDays: 200 })).toBe(0)
    expect(await preview({ inactiveDays: 'soon' })).toBe(0)
    expect(await preview({ inactiveDays: 0 })).toBe(0)
    // Filters combine: a tag AND not back in 90 days.
    await customer({ orderDaysAgo: 100, tags: ['vip'] })
    expect(await preview({ tag: 'vip', inactiveDays: 90 })).toBe(1)
  })

  test('the picker is told the tags in use, the groups and the word for coming back', async () => {
    const o = (await k.O('GET', `${MARKETING}/audience/options`)).json
    expect(o.tags).toEqual(expect.arrayContaining(['wholesale', 'retail', 'bird-club', 'vip']))
    expect(o.groups).toEqual([{ id: wholesaleGroup, name: 'Wholesale' }])
    expect(o.inactive).toBe(true)
    expect(o.activityWord).toBe('order')
  })

  test('a campaign aimed at a tag is sent to those customers only', async () => {
    const tagged = await customer({ tags: ['spring-sale'], name: 'Tagged Tina' })
    const other = await customer({ tags: ['autumn'] })
    const made = await k.O('POST', `${MARKETING}/campaigns`, { name: 'Spring', subject: 'Hello {{firstName}}', body: '<p>Spring is here</p>', audienceType: 'segment', audienceFilter: { tag: 'spring-sale' } })
    expect(made.status).toBe(201)
    const r = await k.O('POST', `${MARKETING}/campaigns/${made.json.id}/send`)
    expect(r.status).toBe(200)
    expect(r.json.sent).toBe(1)
    const got = await logFor(tagged.email!)
    expect(got.map((m) => m.status)).toEqual(['sent'])
    expect(await logFor(other.email!)).toHaveLength(0)
  })

  test('the Customers list shows each customer\'s tags and can be narrowed to one', async () => {
    const all = await k.O('GET', '/api/admin/orders/customers?limit=200')
    expect(all.status).toBe(200)
    const tina = all.json.data.find((c: any) => c.name === 'Tagged Tina')
    expect(tina.tags).toEqual(['spring-sale'])
    const only = await k.O('GET', '/api/admin/orders/customers?tag=spring-sale')
    expect(only.json.data.map((c: any) => c.name)).toEqual(['Tagged Tina'])
  })
})

describe('the welcome email', () => {
  const buy = async (email: string, n: number) => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: email })
    expect(r.status).toBe(200)
    const o = await k.orderBySession(new URL(r.json.url).pathname.split('/').pop()!)
    k.stripe.sessions.set(o.providerSessionId, paidSession(o.providerSessionId, { amountTotal: 2000, email, paymentIntent: `pi_welcome_${n}` }))
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    await k.settle(300)
    return o
  }
  const welcomes = async (email: string) => (await logFor(email)).filter((m) => /Welcome/.test(m.subject))

  test('off until the owner switches it on: a first order sends none', async () => {
    await features(ON)
    expect((await k.O('GET', `${MARKETING}/automations`)).json.welcome).toMatchObject({ available: true, on: false })
    await buy('first-off@example.com', 1)
    expect(await welcomes('first-off@example.com')).toHaveLength(0)
  })

  test('on: a first order sends it once, in the owner\'s words; the second order and a replayed notice send none', async () => {
    const saved = await k.O('PUT', `${MARKETING}/automations`, { welcomeOn: true, welcomeSubject: 'Welcome to the nest, {{firstName}}' })
    expect(saved.status).toBe(200)
    expect(saved.json.welcome).toMatchObject({ on: true, subject: 'Welcome to the nest, {{firstName}}', customSubject: true })
    const o = await buy('first-on@example.com', 2)
    const mails = await welcomes('first-on@example.com')
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('Welcome to the nest, first-on') // no name at checkout: the shopper's contact is named from the address
    // The same notice again (Stripe retries) finalises nothing and sends nothing.
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    await k.settle(300)
    // A second order is not a first order.
    await buy('first-on@example.com', 3)
    expect(await welcomes('first-on@example.com')).toHaveLength(1)
  })

  test('never to someone who unsubscribed; never with Email Marketing switched off', async () => {
    const c = await customer({ email: 'quiet@example.com', optOut: true })
    expect(await marketing().sendWelcome(k.companyId, c.id)).toBe('skipped')
    const d = await customer({ email: 'dormant@example.com' })
    await features(['dashboard', 'orders', 'products', 'contacts'])
    expect(await marketing().sendWelcome(k.companyId, d.id)).toBe('off')
    await features(ON)
    expect(await logFor('quiet@example.com')).toHaveLength(0)
    expect(await logFor('dormant@example.com')).toHaveLength(0)
  })

  test('the settings refuse what cannot work, and the words are checked', async () => {
    expect((await k.O('PUT', `${MARKETING}/automations`, { welcomeSubject: 'Hi {{nickname}}' })).status).toBe(400)
    expect((await k.O('PUT', `${MARKETING}/automations`, { winBackDays: 3 })).status).toBe(400)
    expect((await k.O('PUT', `${MARKETING}/automations`, { winBackDays: 900 })).status).toBe(400)
    expect((await k.ST('PUT', `${MARKETING}/automations`, { welcomeOn: false })).status).toBe(403) // staff do not change marketing
  })
})

describe('the win-back email', () => {
  test('off until the owner sets a number of days: nothing is sent, however long customers have been gone', async () => {
    await features(ON)
    const gone = await customer({ orderDaysAgo: 70, email: 'gone-off@example.com' })
    expect((await marketing().processWinBacks()).sent).toBe(0)
    expect(await logFor('gone-off@example.com')).toHaveLength(0)
    expect(await sends(gone.id)).toHaveLength(0)
    expect((await k.O('GET', `${MARKETING}/automations`)).json.winBack).toMatchObject({ available: true, days: null, word: 'order' })
  })

  test('on at 60 days: those who crossed it lately get one; not the recent, the long gone, the unsubscribed or the never-ordered', async () => {
    const set = await k.O('PUT', `${MARKETING}/automations`, { winBackDays: 60, winBackSubject: 'We miss you, {{firstName}}' })
    expect(set.status).toBe(200)
    expect(set.json.winBack.days).toBe(60)
    const due = await customer({ orderDaysAgo: 62, email: 'due@example.com', name: 'Dee Due' })
    const edge = await customer({ orderDaysAgo: 73, email: 'edge@example.com' })
    const recent = await customer({ orderDaysAgo: 20, email: 'recent@example.com' })
    const longGone = await customer({ orderDaysAgo: 400, email: 'longgone@example.com' })
    const never = await customer({ email: 'never@example.com' })
    const out = await customer({ orderDaysAgo: 65, email: 'out@example.com', optOut: true })
    const r = await marketing().processWinBacks()
    expect(r.sent).toBeGreaterThanOrEqual(2)
    expect((await logFor('due@example.com')).map((m) => m.subject)).toEqual(['We miss you, Dee'])
    expect(await logFor('edge@example.com')).toHaveLength(1)
    for (const e of ['recent@example.com', 'longgone@example.com', 'never@example.com', 'out@example.com']) expect(await logFor(e)).toHaveLength(0)
    expect((await sends(due.id))[0]).toMatchObject({ kind: 'win_back', status: 'sent' })
    void [edge, recent, longGone, never, out]
  })

  test('once per lapse: a second sweep, and two at once, send nothing more', async () => {
    const before = (await logFor('due@example.com')).length
    expect((await marketing().processWinBacks()).sent).toBe(0)
    const c = await customer({ orderDaysAgo: 61, email: 'race@example.com' })
    const both = await Promise.all([marketing().processWinBacks(), marketing().processWinBacks()])
    expect(both.reduce((n, x) => n + x.sent, 0)).toBe(1)
    expect(await logFor('race@example.com')).toHaveLength(1)
    expect((await logFor('due@example.com')).length).toBe(before)
    expect(await sends(c.id)).toHaveLength(1)
  })

  test('a customer who comes back and lapses again is won back again', async () => {
    const c = await customer({ orderDaysAgo: 62, email: 'again@example.com' })
    await marketing().processWinBacks()
    expect(await logFor('again@example.com')).toHaveLength(1)
    // They ordered 10 days ago in between, then (the clock moves on) went quiet for 62 days: a new lapse, a new marker.
    await db().insert(k.S.storeOrder).values({ companyId: k.companyId, contactId: c.id, provider: 'stripe', providerSessionId: `cs_t_${Math.random().toString(36).slice(2, 12)}`, status: 'paid', customerEmail: 'again@example.com', subtotalCents: 2000, totalCents: 2000, orderNumber: `T-again-${Math.random().toString(36).slice(2, 7)}`, createdAt: ago(10) })
    expect((await marketing().processWinBacks()).sent).toBe(0) // back: nothing to say
    const later = new Date(Date.now() + 52 * DAY) // the ordered-10-days-ago visit is now 62 days old
    expect((await marketing().processWinBacks(later)).sent).toBeGreaterThanOrEqual(1)
    expect(await logFor('again@example.com')).toHaveLength(2)
  })

  test('with Email Marketing off, or the number cleared, nothing is sent', async () => {
    await customer({ orderDaysAgo: 62, email: 'held@example.com' })
    await features(['dashboard', 'orders', 'products', 'contacts'])
    expect((await marketing().processWinBacks()).sent).toBe(0)
    await features(ON)
    await k.O('PUT', `${MARKETING}/automations`, { winBackDays: null })
    expect((await marketing().processWinBacks()).sent).toBe(0)
    expect(await logFor('held@example.com')).toHaveLength(0)
  })
})

describe('the same win-back in every trade\'s own terms', () => {
  // One database holds every trade's tables, so each trade's idea of "came back" is run here against its own rows.
  const mk = (featureSet: string) => {
    const a = lastActivityFor(featureSet)!
    const sent: Array<{ to: string; subject: string; html: string }> = []
    const svc = createMarketingService({
      db: db(), tables: { campaign: k.S.campaign, contact: k.S.contact, emailLog: k.S.emailLog, automation: k.S.marketingAutomation, automationSend: k.S.marketingAutomationSend },
      sendRaw: async (m: any) => { sent.push(m); return {} }, env: {}, lastActivity: a,
    } as any)
    return { svc, sent, word: a.word }
  }
  const person = async (email: string) => (await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Pat Person', email, type: 'customer' }).returning())[0]

  const TRADES: Array<{ set: string; word: string; give: (c: { id: string }, when: Date) => Promise<void> }> = [
    { set: 'crm', word: 'job', give: (c, when) => job(c.id, when) },
    { set: 'crm-fieldservice', word: 'job', give: (c, when) => job(c.id, when) },
    { set: 'crm-landscaping', word: 'job', give: (c, when) => job(c.id, when) },
    { set: 'crm-basic', word: 'job', give: (c, when) => job(c.id, when) },
    { set: 'crm-salon', word: 'visit', give: async (c, when) => { await db().insert(k.S.serviceRecord).values({ companyId: k.companyId, contactId: c.id, performedAt: when } as any) } },
    { set: 'crm-vet', word: 'visit', give: async (c, when) => {
      const [p] = await db().insert(k.S.patient).values({ companyId: k.companyId, ownerId: c.id, name: 'Rex', species: 'dog' } as any).returning()
      await db().insert(k.S.visit).values({ companyId: k.companyId, patientId: p.id, visitDate: when } as any)
    } },
    { set: 'crm-rv', word: 'visit', give: async (c, when) => { await db().insert(k.S.repairOrder).values({ companyId: k.companyId, customerId: c.id, writeUpDate: when, roNumber: `RO-${Math.random().toString(36).slice(2, 7)}` } as any) } },
    { set: 'crm-bar', word: 'visit', give: async (c, when) => { await db().insert(k.S.barCheck).values({ companyId: k.companyId, contactId: c.id, number: Math.floor(Math.random() * 1e6), kind: 'tab', label: 'Pat', status: 'paid', openedAt: when, closedAt: when } as any) } },
    { set: 'crm-restaurant', word: 'event', give: async (c, when) => { await db().insert(k.S.event).values({ companyId: k.companyId, contactId: c.id, name: 'Party', status: 'completed', eventDate: when.toISOString().slice(0, 10) } as any) } },
    { set: 'crm-store', word: 'order', give: async (c, when) => { await db().insert(k.S.storeOrder).values({ companyId: k.companyId, contactId: c.id, provider: 'stripe', providerSessionId: `cs_t_${Math.random().toString(36).slice(2, 12)}`, status: 'paid', customerEmail: 'x@example.com', subtotalCents: 1, totalCents: 1, orderNumber: `T-${Math.random().toString(36).slice(2, 9)}`, createdAt: when }) } },
  ]
  async function job(contactId: string, when: Date) {
    await db().insert(k.S.job).values({ companyId: k.companyId, contactId, number: `J-${Math.random().toString(36).slice(2, 8)}`, title: 'Work', status: 'completed', completedAt: when } as any)
  }

  for (const t of TRADES) {
    test(`${t.set}: a customer with no ${t.word} for 61 days is won back (and one who came lately is not)`, async () => {
      const { svc, sent, word } = mk(t.set)
      expect(word).toBe(t.word)
      const lapsed = await person(`lapsed-${t.set}@example.com`)
      const lately = await person(`lately-${t.set}@example.com`)
      const nothing = await person(`nothing-${t.set}@example.com`)
      await t.give(lapsed, ago(61))
      await t.give(lately, ago(3))
      // Only this trade's settings row (its own company in a real shop; here the one company, set to 60 days for the sweep).
      await db().insert(k.S.marketingAutomation).values({ companyId: k.companyId, winBackDays: 60 }).onConflictDoUpdate({ target: k.S.marketingAutomation.companyId, set: { winBackDays: 60 } })
      await svc.processWinBacks()
      const to = sent.map((m) => m.to)
      expect(to).toContain(`lapsed-${t.set}@example.com`)
      expect(to).not.toContain(`lately-${t.set}@example.com`)
      expect(to).not.toContain(`nothing-${t.set}@example.com`)
      // The built-in wording speaks in the trade's own word.
      const mail = sent.find((m) => m.to === `lapsed-${t.set}@example.com`)!
      expect(mail.html).toContain(`your last ${t.word}`)
      void nothing
    })
  }

  test('a trade without a clear idea of coming back (or without email marketing) is offered no win-back', () => {
    expect(lastActivityFor('crm-homecare')).toBeUndefined()
    expect(lastActivityFor('crm-roof')).toBeUndefined()
    expect(lastActivityFor(undefined)).toBeUndefined()
  })
})

describe('a delivered order asks for a review', () => {
  test('delivered or picked up asks when Review Requests is on and requests are switched on; otherwise nothing', async () => {
    const reviewRows = async (contactId: string) => (await db().select().from(k.S.reviewRequest).where(and(eq(k.S.reviewRequest.contactId, contactId), eq(k.S.reviewRequest.companyId, k.companyId)))) as any[]
    const c = await customer({ email: 'happy@example.com' })
    const mk = async (status: string, fulfillment = 'ship') => (await db().insert(k.S.storeOrder).values({
      companyId: k.companyId, contactId: c.id, provider: 'stripe', providerSessionId: `cs_t_${Math.random().toString(36).slice(2, 12)}`, status, fulfillment, customerEmail: 'happy@example.com', subtotalCents: 2000, totalCents: 2000,
      orderNumber: `T-rv-${Math.random().toString(36).slice(2, 8)}`, fulfilledAt: new Date(),
    }).returning())[0]
    // Review Requests off for the shop: nothing.
    await features(ON)
    const a = await mk('shipped')
    expect((await k.O('PATCH', `/api/admin/orders/${a.id}/status`, { status: 'delivered' })).status).toBe(200)
    await k.settle()
    expect(await reviewRows(c.id)).toHaveLength(0)
    // On, and the owner has switched requests on in Reviews › Settings.
    await features([...ON, 'google_reviews'])
    await db().update(k.S.company).set({ settings: { reviewRequestEnabled: true, reviewRequestDelay: 24, googleReviewUrl: 'https://g.page/r/example/review' } }).where(eq(k.S.company.id, k.companyId))
    const b = await mk('shipped')
    expect((await k.O('PATCH', `/api/admin/orders/${b.id}/status`, { status: 'delivered' })).status).toBe(200)
    await k.settle()
    expect(await reviewRows(c.id)).toHaveLength(1)
    // Once per customer per 30 days, even for a second order.
    const p = await mk('ready_for_pickup', 'pickup')
    expect((await k.O('PATCH', `/api/admin/orders/${p.id}/status`, { status: 'picked_up' })).status).toBe(200)
    await k.settle()
    expect(await reviewRows(c.id)).toHaveLength(1)
  })
})
