// Boots the real unified app on an in-memory database, with the built admin screens, so a screen can be looked at in a
// browser (Playwright). Not a test and not a deploy: nothing is sent anywhere.
//   cd apps/unified && bun run build:web && bun ../../docs/claims-true/tools/serve.ts [vertical] [port]
// Signs in as owner@test.example / Correct-horse-1 (manager@test.example / Manager-pass-1).
import path from 'node:path'
import { bootTenant, seedOwner } from '../../../apps/unified/tests/harness.ts'

// A stand-in Factory on localhost (FAKE_FACTORY=1) for the screens that talk to it: the subscription and the own-it licence.
// POST /__set {"license": null | {...}} changes what it answers, so one run can show the offer and the bought state.
let licenseState: any = null
if (process.env.FAKE_FACTORY) {
  const OFFER = { eligible: true, reason: null, planName: 'Starter', monthlyCents: 9900, months: 36, priceCents: 356400,
    includes: ['Read access to your business’s own code repository on GitHub, for the GitHub username you give — invited the moment you pay.', 'A full export of your business’s data: every list as a spreadsheet file, plus your website pages and media list — emailed to you as a download link that works for seven days.', 'The licence recorded against your account.'],
    terms: ['A licence lets you run this software for your own business. It is not a licence to resell it, rebrand it for other businesses, or offer it to others as a service (Terms of Service §7).', 'You get your own copy of the code to run yourself. Twomiah keeps its rights in the code; updates we make after today are not part of the licence unless we say so.', 'Buying it does not cancel your hosted Twomiah service. That subscription carries on, billed monthly, until you end it from your billing portal.'],
    termsVersion: '2026-10-28' }
  const fake = Bun.serve({ port: 4311, async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/__set') { licenseState = (await req.json()).license; return Response.json({ ok: true }) }
    if (u.pathname.endsWith('/license')) return Response.json({ ...OFFER, eligible: !licenseState, reason: licenseState ? 'This business already owns its licence.' : null, license: licenseState })
    if (u.pathname.endsWith('/subscription')) return Response.json({ plan: 'starter10', planName: 'Starter', product: 'crm', monthlyAmount: 99, billingCycle: 'monthly', billingType: 'subscription', status: 'active', billingStatus: 'active', nextBillingDate: '2026-11-20T00:00:00Z', trialEndsAt: null, seats: 10, hasStripeCustomer: true, syncedAt: new Date().toISOString(), charge: null })
    return Response.json({ error: 'not here' }, { status: 404 })
  } })
  process.env.FACTORY_URL = `http://localhost:${fake.port}`; process.env.TENANT_ID = 'tenant-1'; process.env.FACTORY_SYNC_KEY = 'sync-key'
}

const vertical = process.argv[2] || 'contractor'
const port = Number(process.argv[3] || 4310)
const dist = path.resolve(import.meta.dir, '../../../apps/unified/web/dist')
const t = await bootTenant({ adminDist: dist, vertical })
const s = await seedOwner(t)
await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId: s.company.id } as any)
await t.db.update(t.schema.company).set({ onboardingCompleted: true } as any).catch(() => {})
// A little business to export.
await t.db.insert(t.schema.contact).values([
  { companyId: s.company.id, name: 'Ann Able', email: 'ann@example.com', type: 'client' },
  { companyId: s.company.id, name: 'Bo Baker', email: 'bo@example.com', type: 'client' },
] as any)
const extra = process.argv[5] ? await import(path.resolve(process.argv[5])) : null
if (extra?.seed) await extra.seed(t, s)
Bun.serve({ port, fetch: (req) => t.app.fetch(req) })
console.log(`serving ${vertical} on http://localhost:${port}`)
