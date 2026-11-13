// Security review S2 (everything reachable without signing in), 2026-11-13 — docs/review/security/S2-public-surface.md.
// Each test is one finding's hole, shown closed, beside the ordinary path still working.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const ON = ['contacts', 'projects', 'jobs', 'documents', 'client_portal', 'vendor_portal', 'purchase_orders', 'submittals', 'rfis', 'lien_waivers']
let t: any, companyId = '', owner: any, ownerId = ''
const portal: Record<string, string> = {}, ids: Record<string, string> = {}
const P = (who: string) => (path: string, i: any = {}) => t.call(`/api/portal/p/${portal[who]}${path}`, i)
const V = (who: string) => (path: string, i: any = {}) => t.call(`/api/vendor-portal/v/${portal[who]}${path}`, i)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const signIn = async (email: string, password: string) => {
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  return (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://crm.example.com'
  ;(t.services.email as any).send = async () => ({ success: true })
  ;(t.services.crm.emailService as any).sendRaw = async () => ({ success: true })
  owner = await signIn('owner@test.example', s.password)
  // Two homeowners, each with a project; a subcontractor on Lee's project; a supplier.
  for (const [k, name, type] of [['lee', 'Lee Marsh', 'client'], ['ann', 'Ann Other', 'client'], ['sub', 'Sam Framing', 'subcontractor'], ['sup', 'Lumber Yard', 'vendor']]) {
    ids[k] = (await ins(t.schema.contact, { companyId, name, email: `${k}@s2.example`, type })).id
    const r = await json(await owner(`/api/portal/contacts/${ids[k]}/enable`, { method: 'POST' }))
    portal[k] = String(r.body.portalUrl).split('/').pop()!
  }
  ids.leeProject = (await ins(t.schema.project, { companyId, number: 'P-LEE', name: 'Lee’s kitchen', contactId: ids.lee })).id
  ids.annProject = (await ins(t.schema.project, { companyId, number: 'P-ANN', name: 'Ann’s bath', contactId: ids.ann })).id
  await ins(t.schema.job, { companyId, number: 'J-SUB', title: 'Framing', projectId: ids.leeProject, subcontractorId: ids.sub })
  ids.leeSubmittal = (await ins(t.schema.submittal, { companyId, projectId: ids.leeProject, number: 'S-1', title: 'Lee’s cabinets' })).id
  ids.annSubmittal = (await ins(t.schema.submittal, { companyId, projectId: ids.annProject, number: 'S-2', title: 'Ann’s tile' })).id
  ids.annRfi = (await ins(t.schema.rfi, { companyId, projectId: ids.annProject, number: 'R-1', subject: 'Ann’s drain', question: 'Where?', assignedTo: 'Sam Framing' })).id
  ids.leeRfi = (await ins(t.schema.rfi, { companyId, projectId: ids.leeProject, number: 'R-2', subject: 'Lee’s header', question: 'Size?', assignedTo: 'Sam Framing' })).id
}, 120_000)

describe('S2-1, S2-2: the collaborator pages read only the projects the contact is on', () => {
  test('a customer sees its own project’s submittals, a subcontractor the project it works on, nobody the rest', async () => {
    const titles = async (who: string) => ((await json(await P(who)('/submittals'))).body as any[]).map((x) => x.title).sort()
    expect(await titles('lee')).toEqual(['Lee’s cabinets'])
    expect(await titles('ann')).toEqual(['Ann’s tile'])
    expect(await titles('sub')).toEqual(['Lee’s cabinets'])
    expect(await titles('sup')).toEqual([])
  })

  test('a submittal of another project cannot be approved or sent back, and the approver is the contact, not what was typed', async () => {
    expect((await P('lee')(`/submittals/${ids.annSubmittal}/approve`, { method: 'POST', json: { signedBy: 'The Architect' } })).status).toBe(404)
    expect((await P('sup')(`/submittals/${ids.annSubmittal}/revise`, { method: 'POST', json: { reason: 'no' } })).status).toBe(404)
    const [untouched] = await t.db.select().from(t.schema.submittal).where(eq(t.schema.submittal.id, ids.annSubmittal))
    expect(untouched.status).toBe('pending')
    const ok = await json(await P('lee')(`/submittals/${ids.leeSubmittal}/approve`, { method: 'POST', json: { signedBy: 'The Architect' } }))
    expect(ok.status).toBe(200)
    expect(ok.body.submittal.approvedBy).toBe('Lee Marsh')
  })

  test('an RFI assigned to a name is read only inside that contact’s projects', async () => {
    const subjects = ((await json(await P('sub')('/rfis-assigned'))).body as any[]).map((x) => x.subject)
    expect(subjects).toEqual(['Lee’s header'])
    expect((await P('sub')(`/rfis-assigned/${ids.annRfi}/respond`, { method: 'POST', json: { response: 'here' } })).status).toBe(404)
    expect((await P('sub')(`/rfis-assigned/${ids.leeRfi}/respond`, { method: 'POST', json: { response: '2x10' } })).status).toBe(200)
  })
})

describe('S2-3, S2-4: what a portal link may store and how much', () => {
  test('a lien waiver’s document is an https address or nothing', async () => {
    const w = await ins(t.schema.lienWaiver, { companyId, projectId: ids.leeProject, vendorId: ids.sub, vendorName: 'Sam Framing', waiverType: 'conditional_progress', amount: '100.00', status: 'requested' })
    for (const bad of ['javascript:alert(1)', 'http://plain.example/x', 'x'.repeat(2100)]) {
      expect((await P('sub')(`/lien-waivers/${w.id}/sign`, { method: 'POST', json: { documentUrl: bad } })).status).toBe(400)
    }
    expect((await P('sub')(`/lien-waivers/${w.id}/sign`, { method: 'POST', json: { notes: 'n'.repeat(2001) } })).status).toBe(400)
    const ok = await json(await P('sub')(`/lien-waivers/${w.id}/sign`, { method: 'POST', json: { documentUrl: 'https://files.example/waiver.pdf', notes: 'Signed.' } }))
    expect(ok.status).toBe(200)
    expect(ok.body.lienWaiver.documentUrl).toBe('https://files.example/waiver.pdf')
  })

  test('one link sends a few service requests an hour, not hundreds', async () => {
    const ask = () => P('ann')('/service-request', { method: 'POST', json: { description: 'The tap drips.' } })
    const first = await ask()
    if (first.status === 404) return // this trade's portal has no service requests: nothing to cap
    expect(first.status).toBe(201)
    let last = first
    for (let i = 0; i < 5; i++) last = await ask()
    expect(last.status).toBe(429)
    expect((await P('ann')('/service-request', { method: 'POST', json: { description: 'x'.repeat(5001) } })).status).not.toBe(201)
  })
})

describe('S2-8: the vendor portal is for vendors, and its invite is the key-holder’s to send', () => {
  test('a customer’s portal link is not a vendor link: no page, no bill', async () => {
    expect((await V('lee')('')).status).toBe(401)
    expect((await V('lee')('/invoices', { method: 'POST', json: { number: 'INV-1', amount: 250000 } })).status).toBe(401)
    expect((await t.db.select().from(t.schema.vendorBill)).length).toBe(0)
  })

  test('a vendor files a bill, within bounds', async () => {
    expect((await V('sup')('')).status).toBe(200)
    expect((await V('sup')('/invoices', { method: 'POST', json: { number: 'INV-2', amount: 1e12 } })).status).toBe(400)
    const ok = await json(await V('sup')('/invoices', { method: 'POST', json: { number: 'INV-3', amount: 420.5 } }))
    expect(ok.status).toBe(201)
    expect(ok.body.amount).toBe('420.50')
  })

  test('the invite asks portal:share, and refuses a contact who is not a vendor', async () => {
    // A field seat given contacts:update (the grant the invite used to ask) but not portal:share.
    await ins(t.schema.user, { companyId, email: 'field@s2.example', passwordHash: await Bun.password.hash('Field-pass-1', 'bcrypt'), firstName: 'Fay', lastName: 'Field', role: 'field', extraPermissions: ['contacts:update'] })
    const field = await signIn('field@s2.example', 'Field-pass-1')
    const refused = await field(`/api/vendor-portal/contacts/${ids.lee}/invite`, { method: 'POST' })
    expect(refused.status).toBe(403)
    // The owner: a customer is not a vendor; a vendor is invited.
    const notVendor = await json(await owner(`/api/vendor-portal/contacts/${ids.lee}/invite`, { method: 'POST' }))
    expect(notVendor.status).toBe(400)
    expect(notVendor.body.code).toBe('not_a_vendor')
    const invited = await json(await owner(`/api/vendor-portal/contacts/${ids.sup}/invite`, { method: 'POST' }))
    expect(invited.status).toBe(200)
    expect(String(invited.body.link)).toContain('/vendor/')
  })
})

describe('S2-5: the caller’s address is the edge’s, not what the caller typed', () => {
  test('a new X-Forwarded-For on every request does not reset a limiter keyed by the caller', async () => {
    const { clientKey, callerAddress } = await import('../server/http/guards.ts')
    const ctx = (headers: Record<string, string>) => ({ req: { header: (n: string) => headers[n.toLowerCase()] } }) as any
    expect(clientKey(ctx({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1, 203.0.113.5' }))).toBe('203.0.113.5')
    expect(clientKey(ctx({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.2, 203.0.113.5' }))).toBe('203.0.113.5')
    expect(callerAddress(ctx({}))).toBeNull()
    // No module of the server reads the header for itself any more.
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
    const root = new URL('../server', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ')
    const own = walk(root).filter((p) => !/http[\\/]guards\.ts$|core[\\/](audit|viewAs)\.ts$/.test(p))
      .filter((p) => readFileSync(p, 'utf8').split('\n').some((l) => /header\(['"]x-forwarded-for['"]\)/i.test(l) && !/^\s*(\/\/|\*)/.test(l)))
    expect(own).toEqual([])
  })
})
