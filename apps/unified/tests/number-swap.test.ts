// THE WEBSITE NUMBER SWAP (CallRail's dynamic number insertion; crm/comms/numberSwap.ts + numberSwapRules.ts + site/public/scripts/
// number-swap.ts). Through the real server as field service (nothing leaves the machine):
//   · a visit is read as CallRail reads it — ad click ids and paid tags, search engines, social, Yelp, email, other sites, direct;
//   · the website is shown the tracking number for where the visitor came from (the most particular rule wins: a utm_source of
//     its own, then the source, then every visitor), in place of the business's own number; nothing with the switch off;
//   · a visitor pool hands each live visitor their own number and keeps it for the visit; a call to it is credited with that
//     visit's source, campaign, search words and landing page; a plain website number with its rule's source;
//   · the owner sets it per number (checked), the site loads the script only when a number is set, and the line to paste
//     elsewhere is given.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { twilioSignatureFor } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { classifyVisit } from '../server/crm/comms/numberSwapRules.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', slug = ''
const TOKEN = 'platform-token'
const S = () => t.schema as any
const ON = ['contacts', 'jobs', 'call_tracking', 'call_tracking_numbers', 'website']
const setFeatures = async (list: string[]) => { await t.db.update(S().company).set({ enabledFeatures: list } as any).where(eq(S().company.id, companyId)); t.services.features.forgetFeatures() }
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any, headers: r.headers })
const visit = (visitor: string, page: string, referrer = '') => t.app.request(`http://localhost/api/public/number-swap/${slug}/visit`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ visitor, page, referrer }) }).then(json)
const num = async (phoneNumber: string, swapSource: string | null, inPool = false, extra: Record<string, unknown> = {}) =>
  ((await (t.db as any).insert(S().trackingNumber).values({ companyId, phoneNumber, forwardTo: '+17155550100', name: phoneNumber, active: true, swapSource, inPool, provider: 'twomiah', ...extra }).returning())[0])
const twilio = (path: string, params: Record<string, string>) => {
  const url = `http://localhost${path}`
  return t.app.request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, url, params) }, body: new URLSearchParams(params).toString() })
}
let ads: any, poolA: any, poolB: any, every: any, mailer: any

beforeAll(async () => {
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: TOKEN })
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  slug = s.company.slug
  await t.db.update(S().company).set({ phone: '(715) 555-0100' } as any).where(eq(S().company.id, companyId))
  await setFeatures(ON)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  await t.db.insert(S().website).values({ companyId } as any)
  await t.db.insert(S().page).values({ companyId, slug: 'about', title: 'About', isPublished: true, sections: [{ type: 'text', variant: 'plain', data: { title: 'About us', body: 'Call (715) 555-0100.' } }] } as any)
}, 120_000)

test('a visit is read as CallRail reads it', () => {
  const r = (page: string, referrer = '') => classifyVisit({ page, referrer })
  expect(r('https://acme.test/?gclid=abc&utm_campaign=Furnace%20Fall&utm_term=furnace%20repair')).toMatchObject({ rules: ['google_ads', 'all'], source: 'google', medium: 'cpc', campaign: 'Furnace Fall', keyword: 'furnace repair', landingPage: 'https://acme.test/' })
  expect(r('https://acme.test/x?utm_source=google&utm_medium=cpc').rules).toEqual(['utm:google', 'google_ads', 'all'])
  expect(r('https://acme.test/', 'https://www.google.com/').rules).toEqual(['google_organic', 'all'])
  expect(r('https://acme.test/', 'https://www.google.co.uk/').rules).toEqual(['google_organic', 'all'])
  expect(r('https://acme.test/?utm_source=google&utm_medium=organic&utm_campaign=gbp').rules).toEqual(['utm:google', 'google_business', 'all'])
  expect(r('https://acme.test/?msclkid=1').rules).toEqual(['bing_ads', 'all'])
  expect(r('https://acme.test/', 'https://www.bing.com/').rules).toEqual(['bing_organic', 'all'])
  expect(r('https://acme.test/', 'https://duckduckgo.com/').rules).toEqual(['other_search', 'all'])
  expect(r('https://acme.test/?fbclid=1').rules).toEqual(['facebook', 'all'])
  expect(r('https://acme.test/', 'https://l.instagram.com/').rules).toEqual(['facebook', 'all'])
  expect(r('https://acme.test/', 'https://www.yelp.com/biz/acme').rules).toEqual(['yelp', 'all'])
  expect(r('https://acme.test/?utm_source=newsletter&utm_medium=email').rules).toEqual(['utm:newsletter', 'email', 'all'])
  expect(r('https://acme.test/', 'https://neighborsblog.test/post').rules).toEqual(['referral', 'all'])
  expect(r('https://acme.test/', 'https://acme.test/about').rules).toEqual(['direct', 'all'])
  expect(r('https://acme.test/').rules).toEqual(['direct', 'all'])
})

test('the owner sets it per number, checked', async () => {
  ads = await num('+17155550111', null)
  expect((await call(`/api/calltracking/numbers/${ads.id}`, { method: 'PUT', json: { swapSource: 'myspace' } })).status).toBe(400)
  expect((await call(`/api/calltracking/numbers/${ads.id}`, { method: 'PUT', json: { swapSource: 'utm:<x>' } })).status).toBe(400)
  expect((await call(`/api/calltracking/numbers/${ads.id}`, { method: 'PUT', json: { inPool: 'yes' } })).status).toBe(400)
  expect((await call(`/api/calltracking/numbers/${ads.id}`, { method: 'PUT', json: { swapSource: 'GOOGLE_ADS' } })).status).toBe(200)
  const list = await json(await call('/api/calltracking/numbers'))
  expect(list.body.data.find((n: any) => n.id === ads.id)).toMatchObject({ swapSource: 'google_ads', inPool: false })
  const settings = await json(await call('/api/calltracking/settings'))
  expect(settings.body.numberSwapScript).toBe(`<script src="https://localhost/scripts/number-swap.js" data-slug="${slug}" defer></script>`)
})

test('each visitor is shown the number for where they came from, the most particular rule first; nothing for the rest', async () => {
  expect((await visit('visitor-direct-1', 'https://acme.test/')).body).toEqual({ number: null })
  every = await num('+17155550144', 'all')
  mailer = await num('+17155550155', 'utm:mailer')
  const a = await visit('visitor-ad-0001', 'https://acme.test/?gclid=zz')
  expect(a.body).toEqual({ number: '(715) 555-0111', tel: '+17155550111', replace: '7155550100' })
  expect(a.headers.get('access-control-allow-origin')).toBe('*')
  expect((await visit('visitor-direct-1', 'https://acme.test/')).body.number).toBe('(715) 555-0144')
  expect((await visit('visitor-mail-01', 'https://acme.test/?utm_source=mailer')).body.number).toBe('(715) 555-0155')
  expect((await visit('bad', 'https://acme.test/')).status).toBe(400)
  expect((await visit('visitor-ok-0001', 'javascript:alert(1)')).status).toBe(400)
})

test('a visitor pool: each live visitor their own number, kept for the visit; a call is credited with that visit', async () => {
  poolA = await num('+17155550122', 'google_organic', true)
  poolB = await num('+17155550133', 'google_organic', true)
  const g = 'https://www.google.com/'
  const v1 = await visit('visitor-pool-001', 'https://acme.test/furnace-repair?utm_term=furnace', g)
  const v2 = await visit('visitor-pool-002', 'https://acme.test/ac-tune-up', g)
  expect(new Set([v1.body.number, v2.body.number])).toEqual(new Set(['(715) 555-0122', '(715) 555-0133']))
  // Visitor 1 reads another page: the same number, and the visit stays live.
  expect((await visit('visitor-pool-001', 'https://acme.test/furnace-repair?utm_term=furnace', g)).body.number).toBe(v1.body.number)
  const v1Number = v1.body.tel as string
  // A call to visitor 1's number is theirs: Google organic, the page they landed on, their search words.
  await twilio(`/api/calltracking/webhook/twilio/${companyId}`, { CallSid: 'CA' + '1'.repeat(32), From: '+16085550101', To: v1Number, CallStatus: 'completed', CallDuration: '40', Direction: 'inbound' })
  const [c1] = await (t.db as any).select().from(S().callLog).where(eq(S().callLog.providerId, 'CA' + '1'.repeat(32)))
  expect(c1).toMatchObject({ source: 'google', medium: 'organic', keyword: 'furnace', landingPage: 'https://acme.test/furnace-repair' })
  // A plain website number's call: its rule's source, where the owner named none.
  await twilio(`/api/calltracking/webhook/twilio/${companyId}`, { CallSid: 'CA' + '2'.repeat(32), From: '+16085550102', To: '+17155550111', CallStatus: 'completed', CallDuration: '20', Direction: 'inbound' })
  const [c2] = await (t.db as any).select().from(S().callLog).where(eq(S().callLog.providerId, 'CA' + '2'.repeat(32)))
  expect(c2).toMatchObject({ source: 'google', medium: 'cpc' })
  // A third live visitor with the pool full: the number seen longest ago.
  await (t.db as any).update(S().callTrackingVisit).set({ lastSeenAt: new Date(Date.now() - 10 * 60_000) }).where(eq(S().callTrackingVisit.visitorId, 'visitor-pool-002'))
  expect((await visit('visitor-pool-003', 'https://acme.test/', g)).body.number).toBe(v2.body.number)
})

test('the site loads the script only with a website number set and the switch on; the script is served', async () => {
  const js = await t.call('/scripts/number-swap.js')
  expect(js.status).toBe(200)
  expect(await js.text()).toContain('/api/public/number-swap/')
  expect(await (await t.call('/about')).text()).toContain(`<script src="/scripts/number-swap.js" data-slug="${slug}" defer></script>`)
  await setFeatures(ON.filter((f) => f !== 'call_tracking_numbers'))
  try {
    expect(await (await t.call('/about')).text()).not.toContain('number-swap.js')
    expect((await visit('visitor-ad-0001', 'https://acme.test/?gclid=zz')).body).toEqual({ number: null })
  } finally { await setFeatures(ON) }
  await (t.db as any).update(S().trackingNumber).set({ swapSource: null }).where(eq(S().trackingNumber.companyId, companyId))
  expect(await (await t.call('/about')).text()).not.toContain('number-swap.js')
})
