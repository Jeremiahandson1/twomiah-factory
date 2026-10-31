// "Export everything": one ZIP with every list the business has, for this business only, with no secrets in it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { inflateRawSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { exportPlan, isSecretColumn } from '../server/data/exportAll.ts'
import { zip } from '../server/core/zip.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let s: Awaited<ReturnType<typeof seedOwner>>
let ownerToken = '', managerToken = ''
let otherCompanyId = ''

const as = (p: string, tok: string) => t.call(p, { headers: { Authorization: `Bearer ${tok}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

/** The files of a ZIP, read back by its central directory (not by our writer). */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const body = buf.subarray(dataAt, dataAt + size)
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString('utf8')
    p += 46 + nameLen + extra + comment
  }
  return out
}

beforeAll(async () => {
  t = await bootTenant()
  s = await seedOwner(t)
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId: s.company.id } as any)
  ownerToken = await login('owner@test.example', s.password)
  managerToken = await login('manager@test.example', 'Manager-pass-1')
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
  otherCompanyId = other.id
  await t.db.insert(t.schema.contact).values([
    { companyId: s.company.id, name: 'Ann, "Annie" Able', email: 'ann@example.com', type: 'client' },
    { companyId: otherCompanyId, name: 'Zed Stranger', email: 'zed@elsewhere.example', type: 'client' },
  ] as any)
  const [q] = await t.db.insert(t.schema.quote).values({ companyId: s.company.id, number: 'Q-1', name: 'Deck', subtotal: '100', total: '100' } as any).returning()
  await t.db.insert(t.schema.quoteLineItem).values({ quoteId: q.id, description: 'Boards', quantity: '1', unitPrice: '100', total: '100' } as any)
  const [oq] = await t.db.insert(t.schema.quote).values({ companyId: otherCompanyId, number: 'Q-9', name: 'Stranger deck', subtotal: '5', total: '5' } as any).returning()
  await t.db.insert(t.schema.quoteLineItem).values({ quoteId: oq.id, description: 'Stranger boards', quantity: '1', unitPrice: '5', total: '5' } as any)
  await t.db.insert(t.schema.photo).values({ companyId: s.company.id, filename: 'a.jpg', originalName: 'front.jpg', caption: 'Front of house' } as any)
}, 120_000)

describe('export everything', () => {
  test('the owner downloads one ZIP with the lists, the website pages and the media list', async () => {
    const res = await as('/api/export-everything', ownerToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/test-builders-everything-\d{4}-\d{2}-\d{2}\.zip/)
    const files = unzip(Buffer.from(await res.arrayBuffer()))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'manifest.csv', 'data/contact.csv', 'data/quote.csv', 'data/quote_line_item.csv', 'data/user.csv', 'website/media.csv']))
    expect(files['data/contact.csv']).toContain('"Ann, ""Annie"" Able"')
    expect(files['website/media.csv']).toContain('Front of house')
    expect(files['manifest.csv']).toContain('data/contact.csv,contact,1')
  })

  test('only this business: the other company’s rows, and its child rows, are not in it', async () => {
    const files = unzip(Buffer.from(await (await as('/api/export-everything', ownerToken)).arrayBuffer()))
    const all = Object.values(files).join('\n')
    expect(all).not.toContain('Zed Stranger')
    expect(all).not.toContain('Stranger deck')
    expect(all).not.toContain('Stranger boards')
    expect(all).not.toContain('Other Co')
    expect(files['data/quote_line_item.csv']).toContain('Boards')
  })

  test('no password, token or secret leaves — the user file has no such column, and the hash is nowhere', async () => {
    const files = unzip(Buffer.from(await (await as('/api/export-everything', ownerToken)).arrayBuffer()))
    const header = files['data/user.csv'].split('\r\n')[0].split(',')
    expect(header).toContain('email')
    for (const col of header) expect(isSecretColumn(col)).toBe(false)
    expect(header).not.toContain('password_hash')
    const [u] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example'))
    expect(Object.values(files).join('\n')).not.toContain(u.passwordHash)
    expect(files['manifest.csv']).toMatch(/data\/user\.csv,user,\d+,.*password_hash/)
  })

  test('only an owner or admin: a manager is refused, a visitor is signed out', async () => {
    expect((await as('/api/export-everything', managerToken)).status).toBe(403)
    expect((await t.call('/api/export-everything')).status).toBe(401)
  })

  test('each download is an audit row', async () => {
    await as('/api/export-everything', ownerToken)
    await new Promise((r) => setTimeout(r, 50))
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, 'everything'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].action).toBe('export')
    expect(rows[0].companyId).toBe(s.company.id)
  })

  test('every table of the schema is exported, scoped or deliberately left out', () => {
    const plan = exportPlan()
    expect(plan.filter((p) => p.how === 'unclassified')).toEqual([])
    expect(plan.length).toBe(466) // 10/31 store parity: +store_segments, +store_followups, +store_suppliers, +store_purchase_orders, +store_purchase_order_lines, +store_shopper_cards; 10/30: +saved_request, contractor #173, field service #169, restaurant-bar #171, store #174, landscaping #168, roofing #170, home care #172, salon #167; 10/31: +client_billing_splits
  })
})

describe('the ZIP writer', () => {
  test('writes files other tools read back byte for byte, including non-ASCII names', () => {
    const buf = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/é.csv', data: 'x,y\r\n1,2\r\n'.repeat(1000) }])
    const back = unzip(buf)
    expect(back['a.txt']).toBe('hello')
    expect(back['dir/é.csv']).toBe('x,y\r\n1,2\r\n'.repeat(1000))
  })
})
