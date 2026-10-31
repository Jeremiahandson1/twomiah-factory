// Consumer financing, finished as far as it can be without the lender (Wisetack), field service AND basic:
//   · every guess about the partner API is behind ONE adapter (lender.ts `wisetack`): the service and the routes name none of
//     it (read here, as source);
//   · the sandbox harness runs only with keys a person supplies, never touches the production names, and calls nothing without
//     them — no test here, or anywhere, calls a live API (a fetcher is injected);
//   · every screen, message and page that shows a payment, an APR or a term carries the lender's DISCLOSURE, verbatim;
//   · each business connects its own merchant account (stored on its own company row);
//   · the phone only opens the lender's page (tests/mobile/financing-phone.test.ts).
import { describe, test, expect, beforeAll } from 'bun:test'
import crypto from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { DISCLOSURE, wisetack, WEBHOOK_PATH } from '../server/crm/financing/lender.ts'
import { runSandbox, formatReport } from '../server/crm/financing/sandbox.ts'
import { crmTemplates } from '../server/crm/messages.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend/src/featureRegistry'

const ROOT = path.join(import.meta.dir, '..', '..', '..')
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/** Wisetack's marketing-toolkit disclosure, pinned here so an edit to lender.ts cannot quietly change what customers are shown. */
const TOOLKIT = 'All financing is subject to credit approval. Your terms may vary. Payment options through Wisetack are provided by our lending partners. For example, a $5,500 purchase could cost $253.54 per month for 24 months, based on a 9.9% APR, or $1,833.33 per month for 3 months, based on a 0% APR. Offers range from 0 to 35.9% APR based on amount requested and creditworthiness. Not all merchants and lending partners participate in 0% interest programs. Terms range from 3 - 120 months and may vary based on merchant, lending partner, or transaction size. State interest rate caps may apply. No prepaid finance charges or participation fees. See additional terms at wisetack.com/faqs.'

describe('one adapter', () => {
  test('the disclosure is the toolkit’s text, word for word', () => { expect(DISCLOSURE).toBe(TOOLKIT) })

  test('the service and the routes name nothing of the partner API — only the adapter does', () => {
    for (const file of ['apps/unified/server/crm/financing/service.ts', 'apps/unified/server/crm/financing/routes.ts']) {
      const text = src(file)
      for (const guess of ['process.env', 'WISETACK_', 'x-wisetack', 'createHmac', 'timingSafeEqual', 'Bearer', "'/transactions'", '/transactions`', 'webhook/wisetack', 'sha256']) {
        expect({ file, guess, found: text.includes(guess) }).toEqual({ file, guess, found: false })
      }
    }
    // …and every guess is marked in the one file.
    expect(src('apps/unified/server/crm/financing/lender.ts').match(/SPEC-PENDING/g)!.length).toBeGreaterThanOrEqual(6)
  })

  test('the adapter is complete: credentials, header, callback, open, verify, parse', () => {
    expect(wisetack.id).toBe('wisetack')
    expect(wisetack.signatureHeader).toBe('x-wisetack-signature')
    expect(wisetack.callbackUrl('https://crm.example.com/')).toBe(`https://crm.example.com${WEBHOOK_PATH}`)
    const raw = JSON.stringify({ eventId: 'e1', transactionId: 't1', status: 'Paid', amount: '100.00' })
    const sig = crypto.createHmac('sha256', 's3cret').update(raw).digest('hex')
    expect(wisetack.verifyWebhook(raw, sig, 's3cret')).toBe(true)
    expect(wisetack.verifyWebhook(raw + ' ', sig, 's3cret')).toBe(false)
    expect(wisetack.parseEvent(JSON.parse(raw))).toMatchObject({ eventId: 'e1', transactionId: 't1', status: 'funded', amount: 100 })
  })
})

describe('the sandbox harness', () => {
  const keys = { WISETACK_SANDBOX_URL: 'https://sandbox.example.test/api', WISETACK_SANDBOX_KEY: 'sbx-key', WISETACK_SANDBOX_MERCHANT_ID: 'sbx-merchant-1', WISETACK_SANDBOX_CONFIRM: 'sandbox' }
  const never: typeof fetch = (async () => { throw new Error('the harness called the network') }) as any

  test('without keys it does nothing and calls nothing', async () => {
    for (const env of [{}, { WISETACK_SANDBOX_URL: keys.WISETACK_SANDBOX_URL }, { ...keys, WISETACK_SANDBOX_KEY: '' }]) {
      const r = await runSandbox(env, never)
      expect(r.ran).toBe(false); expect(r.skipped).toMatch(/No sandbox run/)
    }
  })

  test('keys are not enough: you must say they are sandbox keys, over https', async () => {
    expect((await runSandbox({ ...keys, WISETACK_SANDBOX_CONFIRM: undefined }, never)).skipped).toMatch(/WISETACK_SANDBOX_CONFIRM=sandbox/)
    expect((await runSandbox({ ...keys, WISETACK_SANDBOX_URL: 'http://sandbox.example.test' }, never)).skipped).toMatch(/https/)
  })

  test('the production names are never read: a live key in the environment does not start a run', async () => {
    const r = await runSandbox({ WISETACK_API_URL: 'https://api.live.test', WISETACK_API_KEY: 'live-key', WISETACK_WEBHOOK_SECRET: 'live-secret' }, never)
    expect(r.ran).toBe(false)
  })

  test('with keys it opens an application at the sandbox and reports each guess', async () => {
    const calls: Array<{ url: string; auth: string | null; body: any }> = []
    const fake: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) })
      return Response.json({ transactionId: 'sbx_1', applyUrl: 'https://sandbox.wisetack.test/apply/sbx_1', status: 'Pending' })
    }) as any
    const raw = JSON.stringify({ eventId: 'ev9', transactionId: 'sbx_1', status: 'Confirmed' })
    const sample = JSON.stringify({ signature: crypto.createHmac('sha256', 'whsec').update(raw).digest('hex'), body: raw })
    const r = await runSandbox({ ...keys, WISETACK_SANDBOX_WEBHOOK_SECRET: 'whsec', WISETACK_SANDBOX_WEBHOOK_SAMPLE: '/tmp/sample.json' }, fake, () => sample)
    expect(r.ran).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://sandbox.example.test/api/transactions')
    expect(calls[0].auth).toBe('Bearer sbx-key')
    expect(calls[0].body).toMatchObject({ merchantId: 'sbx-merchant-1', amount: '1000.00' })
    expect(r.checks.map((c) => [c.name, c.ok])).toEqual([['open an application', true], ['webhook signature', true], ['a tampered body is refused', true], ['webhook event body', true]])
    expect(formatReport(r)).toContain('confirmed every guess')
  })

  test('a sandbox that disagrees is reported by name, pointing at the one file to fix', async () => {
    const refusing: typeof fetch = (async () => Response.json({ message: 'unknown route' }, { status: 404 })) as any
    const r = await runSandbox(keys, refusing)
    const open = r.checks.find((c) => c.name === 'open an application')!
    expect(open.ok).toBe(false); expect(open.detail).toContain('lender.ts')
    const raw = JSON.stringify({ eventId: 'e', transactionId: 't', status: 'Paid' })
    const wrong = await runSandbox({ ...keys, WISETACK_SANDBOX_WEBHOOK_SECRET: 'a', WISETACK_SANDBOX_WEBHOOK_SAMPLE: 'x' }, refusing, () => JSON.stringify({ signature: 'deadbeef', body: raw }))
    expect(wrong.checks.find((c) => c.name === 'webhook signature')!.ok).toBe(false)
    expect(formatReport(wrong)).toContain('Some guesses were not confirmed')
  })

  test('no webhook sample: that check says it was not run, and fails the report rather than passing quietly', async () => {
    const ok: typeof fetch = (async () => Response.json({ transactionId: 'x', applyUrl: 'https://s.test/x' })) as any
    const r = await runSandbox(keys, ok)
    expect(r.checks.find((c) => c.name === 'webhook signature')).toMatchObject({ ok: false })
    expect(r.checks.find((c) => c.name === 'webhook signature')!.detail).toContain('not run')
  })
})

describe('payment wording carries the disclosure', () => {
  /** Every source file that talks about financing AND shows a payment, an APR or a term. */
  const TRIGGER = /\/\s?mo\b|per month|\bAPR\b|monthly payment|asLowAs/
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', 'tests', 'templates', 'docs', 'demo'].includes(name)) continue
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|ejs)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['apps/unified/server', 'apps/unified/web/src', 'apps/unified/site', 'packages/tenant-ui/src', 'packages/tenant-backend/src', 'apps/mobile/src', 'apps/mobile/app']) walk(path.join(ROOT, d))

  test('every file that shows a payment, an APR or a term for consumer financing also shows the disclosure', () => {
    // The RV dealership's own F&I desk (Octane, a different lender and product) is not this lender's wording.
    // …nor are the two files that only configure it: the feature's name and the calculator's editor fields (what is shown is calculator.ejs).
    const other = /\/rv\/|FIPage|homecare|featureRegistry\.ts|sectionFields\.ts/
    const offenders = files.filter((f) => !other.test(f) && !f.endsWith('financing/lender.ts')).filter((f) => {
      const t = readFileSync(f, 'utf8')
      return /consumer_financing|api\/financing|wisetack|financing/i.test(t) && TRIGGER.test(t) && !/disclosure|DISCLOSURE/.test(t)
    }).map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  test('the phone shows no payment, APR or term at all', () => {
    for (const f of files.filter((x) => /apps\/mobile/.test(x) && /financing/i.test(readFileSync(x, 'utf8')))) {
      expect({ f: path.relative(ROOT, f), trigger: TRIGGER.test(readFileSync(f, 'utf8')) }).toEqual({ f: path.relative(ROOT, f), trigger: false })
    }
  })

  test('the email carries the disclosure in both its HTML and its text', () => {
    const m = crmTemplates.financingApplication({ contactName: 'Ann', companyName: 'Acme', amount: '$9,000.00', lender: 'Wisetack', url: 'https://wisetack.us/x', disclosure: DISCLOSURE } as any, { primaryColor: '#000', companyName: 'Acme' } as any, {} as any)
    expect(m.text).toContain(DISCLOSURE)
    expect(m.html.replace(/&#39;|&apos;/g, "'")).toContain(DISCLOSURE.replace(/&/g, '&amp;').slice(0, 120))
  })
})

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = '', token = '', contactId = ''
    const sent: any[] = []
    const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
    const json = async (r: Response) => r.json() as any
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const ON = ['contacts', 'jobs', 'quotes', 'invoices', 'consumer_financing']
    const PREQUAL = 'https://wisetack.us/#/merchant-9/prequalify'

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await features(ON)
      ;(t.services.crm.emailService as any).send = async (...args: any[]) => { sent.push(args); return { success: true } }
      token = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
      contactId = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', phone: '6085550100', type: 'client' } as any).returning())[0].id
    }, 120_000)

    test('the registry offers it to field service and basic (hidden until the lender is real)', () => {
      const def = FEATURE_REGISTRY.find((f) => f.id === 'consumer_financing')!
      expect(def.templates).toEqual(expect.arrayContaining(['crm-fieldservice', 'crm-basic']))
      expect(def.hidden).toBe(true)
    })

    test('closed without the feature, whatever the seat', async () => {
      await features(ON.filter((f) => f !== 'consumer_financing'))
      try { expect([403, 404]).toContain((await as('/api/financing/status')).status) } finally { await features(ON) }
    })

    test('the business connects its own merchant account; it is kept on its company and no one else’s', async () => {
      expect((await json(await as('/api/financing/status'))).connected).toBe(false)
      const put = await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'merchant-9', prequalUrl: PREQUAL } })
      expect(put.status).toBe(200)
      const [row] = await t.db.select({ i: t.schema.company.integrations }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
      expect((row.i as any).financing.wisetack).toMatchObject({ merchantId: 'merchant-9', prequalUrl: PREQUAL })
      const others = await t.db.select({ id: t.schema.company.id }).from(t.schema.company)
      expect(others.every((c: any) => c.id === companyId)).toBe(true) // this tenant has one business: the credential lives on its row, not in the server's environment
      expect((await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'm', prequalUrl: 'https://evil.example/x' } })).status).toBe(400)
    })

    test('a quote gets the lender’s estimate with the disclosure verbatim; the customer’s page and the email carry it too', async () => {
      const q = await json(await as('/api/quotes', { method: 'POST', json: { name: 'Furnace', contactId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: 6000 }] } }))
      const panel = await json(await as(`/api/financing/quotes/${q.id}`))
      expect(panel.offer).toMatchObject({ lender: 'Wisetack', amount: 6000, disclosure: TOOLKIT })
      expect((await as(`/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
      const [row] = await t.db.select({ token: t.schema.quote.publicToken }).from(t.schema.quote).where(eq(t.schema.quote.id, q.id))
      const page = await json(await t.call(`/api/financing-public/d/${row.token}`))
      expect(page.disclosure).toBe(TOOLKIT)
      const app = await json(await as(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' }))
      expect(app).toMatchObject({ status: 'not_started', applicationUrl: PREQUAL })
      sent.length = 0
      expect((await as(`/api/financing/applications/${app.id}/send`, { method: 'POST', json: { channel: 'email' } })).status).toBe(200)
      const mail = sent.find((a) => a[1] === 'financingApplication')
      expect(mail[2].disclosure).toBe(TOOLKIT)
      expect(mail[2].url).toBe(PREQUAL)
    })

    test('out of the lender’s range there is no estimate and no wording at all', async () => {
      const q = await json(await as('/api/quotes', { method: 'POST', json: { name: 'Tiny', contactId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: 100 }] } }))
      const panel = await json(await as(`/api/financing/quotes/${q.id}`))
      expect(panel.offer).toBeNull(); expect(panel.reason).toMatch(/\$500/)
    })

    test('the seat that may open an application is financing:create; a crew seat and a viewer are refused', async () => {
      for (const [role, want] of [['field', 403], ['viewer', 403]] as const) {
        await t.db.insert(t.schema.user).values({ email: `${role}@fin.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId } as any)
        const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: `${role}@fin.example`, password: 'Seat-pass-1' } }))).accessToken
        const q = await json(await as('/api/quotes', { method: 'POST', json: { name: 'Roof', contactId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: 8000 }] } }))
        expect((await t.call(`/api/financing/quotes/${q.id}/applications`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` } })).status).toBe(want)
      }
    })
  })
}

describe('the website calculator', () => {
  test('shows a payment and an APR only with the lender’s disclosure beside them', async () => {
    const ejs = (await import('ejs')).default
    const view = path.join(ROOT, 'apps/unified/site/views/sections/financing/calculator.ejs')
    const withIt = await ejs.renderFile(view, { data: { apr: 7.99 }, settings: {}, words: {}, site: null, live: null, md: (s: string) => s, currentPath: '/', isFirst: false, smsConsent: '', disclosure: TOOLKIT })
    expect(withIt).toContain('data-financing-disclosure')
    expect(withIt).toContain('See additional terms at wisetack.com/faqs.')
    expect(withIt).toContain('% APR')
    const without = await ejs.renderFile(view, { data: { apr: 7.99 }, settings: {}, words: {}, site: null, live: null, md: (s: string) => s, currentPath: '/', isFirst: false, smsConsent: '', disclosure: '' })
    expect(without).not.toContain('APR'); expect(without).not.toContain('/mo')
    const bare = await ejs.renderFile(view, { data: {}, settings: {}, words: {}, site: null, live: null, md: (s: string) => s, currentPath: '/', isFirst: false, smsConsent: '' })
    expect(bare).not.toContain('APR')
  })
})
