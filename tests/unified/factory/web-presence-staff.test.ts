// Staff setting a $19 Web presence customer up from the Factory (webPresence/staffCreate.ts): the same record as the signup, billed by
// an emailed invoice before anything is built, and the site built at once. And the page: the "Sell a download" section is drawn only
// when it can really sell (switch on and Stripe linked), and the privacy page then says what buying collects.
// Everything outside is stood in; no live call.
import { describe, test, expect } from 'bun:test'
import { fakeStore } from './fakeStore'
import { staffCreateWebPresence, type StaffCreateDeps } from '../../../apps/api/src/webPresence/staffCreate'
import { webPresenceRecord } from '../../../apps/api/src/webPresence/signup'
import { WebPresenceOffError } from '../../../apps/api/src/webPresence/switch'
import { renderOnePage } from '../../../apps/unified/server/site/onePage'
import { buildSpec } from '../../../apps/api/src/webPresence/spec'

const ON = { WEB_PRESENCE_ON: '1' }
const BODY = { name: 'The Hobby Starter', email: 'owner@hobby.test', industry: 'education', city: 'Eau Claire', state: 'WI' }

function deps(over: Partial<StaffCreateDeps> = {}) {
  const db = fakeStore({ tenants: [] })
  const order: string[] = []
  const d: StaffCreateDeps = {
    db, env: ON,
    allocateSlug: async (b) => b,
    compose: () => ({ pages: {} }),
    invoice: async (t) => { order.push('invoice:' + t.id); return { stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1' } },
    provision: async (id) => { order.push('provision:' + id); return { status: 'live' } },
    audit: async (id, what) => { order.push('audit:' + what) },
    ...over,
  }
  return { d, db, order }
}

describe('staff set a customer up', () => {
  test('the same record as the signup, invoiced first, then built; the subscription is recorded on the customer', async () => {
    const { d, db, order } = deps()
    const out = await staffCreateWebPresence(BODY, d, { userId: 'staff@twomiah.test' })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ success: true, siteStatus: 'live', invoiceUrl: 'https://invoice.stripe.com/i/1' })
    const id = out.body.tenantId as string
    expect(order).toEqual(['audit:web_presence_staff_create', 'invoice:' + id, 'provision:' + id])
    const { data: t } = await db.from('tenants').select('*').eq('id', id).single()
    expect(t).toMatchObject({ name: 'The Hobby Starter', plan: 'webpresence', monthly_amount: 19, billing_type: 'subscription', billing_status: 'pending', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })
    expect(t.intake_data.signup.source).toBe('staff')
    // The one builder: the signup's record and this one differ only in the source note.
    const built = await webPresenceRecord(BODY, d)
    if (!built.ok) throw new Error('record refused')
    const { intake_data: a, ...restA } = built.record as any
    const { intake_data: b, id: _id, created_at: _c, stripe_customer_id: _s, stripe_subscription_id: _ss, ...restB } = t
    expect(restB).toMatchObject(restA)
  })
  test('Stripe refusing the invoice builds nothing, and says so', async () => {
    const { d, order } = deps({ invoice: async () => { throw new Error('No Stripe price configured for plan: webpresence') } })
    const out = await staffCreateWebPresence(BODY, d, {})
    expect(out.status).toBe(502)
    expect(String(out.body.error)).toContain('Nothing was built')
    expect(order.some((o) => o.startsWith('provision'))).toBe(false)
  })
  test('a site that does not finish is reported, with the invoice still sent', async () => {
    const { d } = deps({ provision: async () => { throw new Error('Netlify down') } })
    const out = await staffCreateWebPresence(BODY, d, {})
    expect(out.status).toBe(200)
    expect(out.body.siteStatus).toBe('failed')
    expect(String(out.body.message)).toContain('Retry')
  })
  test('bad input is refused before anything is made; the plan switched off refuses entirely', async () => {
    const { d, db } = deps()
    expect((await staffCreateWebPresence({ name: 'x', email: 'a@b.test' }, d, {})).status).toBe(400)
    expect((await staffCreateWebPresence({ name: 'Acme', email: 'nope' }, d, {})).status).toBe(400)
    expect((await db.from('tenants').select('*')).data).toEqual([])
    await expect(staffCreateWebPresence(BODY, { ...d, env: {} }, {})).rejects.toBeInstanceOf(WebPresenceOffError)
  })
})

describe('the page draws "Sell a download" only when it can sell', () => {
  const spec = buildSpec('other', { downloads: true })
  const caps = Object.fromEntries(Object.entries(spec.caps).map(([k, v]) => [k, { anchor: v.anchor, ...(v.nav ? { nav: v.nav } : {}) }]))
  const model: any = {
    business: { name: 'The Hobby Starter', email: 'owner@hobby.test' }, look: { design: spec.designs[0].id, palette: {}, style: {} },
    forms: { lead: { on: false }, hiring: { on: false } },
    sections: [
      { id: 'hero', type: 'hero', variant: 'split', data: { title: 'Start a card club' } },
      { id: 'download', type: 'download', variant: 'buy', data: { name: 'Starter Kit', price: '99.00', includes: ['7 weekly guides'], license: 'One location', buttonLabel: 'Get the kit' } },
    ],
  }
  const draw = (sellsDownload: boolean) => renderOnePage({ model, vertical: 'basic', caps, origin: 'https://twomiah-hobby.netlify.app', sellsDownload, now: new Date(Date.UTC(2026, 10, 6)) })
  test('sellable: the section, its price, a Buy form posting to /api/buy, a menu link; the privacy page says what buying collects', async () => {
    const out = await draw(true)
    const html = out.files['index.html']
    expect(html).toContain('id="download"')
    expect(html).toContain('$99.00')
    expect(html).toMatch(/<form action="\/api\/buy" method="post"/)
    expect(html).toContain('Get the kit')
    expect(html).toContain('href="#download"')
    expect(out.sectionErrors).toEqual([])
    const privacy = out.files['privacy/index.html']
    expect(privacy).toContain('Buying a download')
    expect(privacy).not.toContain('no shop')
  })
  test('not sellable (switch off or Stripe not linked): no section, no menu link, no Buy form; the privacy page says no shop', async () => {
    const out = await draw(false)
    expect(out.files['index.html']).not.toContain('id="download"')
    expect(out.files['index.html']).not.toContain('/api/buy')
    expect(out.files['index.html']).not.toContain('href="#download"')
    expect(out.files['privacy/index.html']).toContain('no shop')
  })
})
