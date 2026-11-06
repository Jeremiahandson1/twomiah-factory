// Invoice scanning for receiving (restaurant-bar parity #7, bar_invoice_scan; BevSpot / Toast invoice capture).
//   · the matching rule, the reader's JSON and the file sniff are pure and checked with known words and numbers;
//   · the REAL reader (Claude over the Messages API) runs here against a FAKE Anthropic that answers as the API documents: nothing in
//     this file reaches the live service, and so nothing here can say how well the real model reads a real invoice;
//   · the point of the whole feature: reading a photo changes NOTHING (no count, no cost, no order) until a person confirms, and a
//     confirmed invoice becomes one received order, once.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { aliasKey, lineWarnings, reviewLines, splitWords, suggestItem, suggestVendor, type StockLite } from '../server/crm/bar/barInvoiceMatch.ts'
import { parseRead, sniffMediaType } from '../server/crm/bar/barInvoiceReader.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

const stock = (id: string, name: string, packSize = 1, vendorId: string | null = null, packCostCents: number | null = null): StockLite => ({ id, name, packName: 'case', packSize, vendorId, packCostCents })

describe('matching a printed line to a stock item (pure)', () => {
  const items = [stock('lite', 'Miller Lite', 24), stock('bud', 'Bud Light', 24), stock('wings', 'Chicken Wings', 1), stock('ipa', 'Spotted Cow', 6), stock('cow2', 'Spotted Cow Light', 1)]
  test('pack words and sizes are not part of the name', () => {
    expect(splitWords('Miller Lite 24/12oz Btl').name).toEqual(['miller', 'lite'])
    expect(splitWords('Miller Lite 24/12oz Btl').size).toEqual(['24/12oz'])
    expect(aliasKey("Lite, Miller (case of 24)")).toBe(aliasKey('MILLER LITE 24PK'))
  })
  test('the same name matches surely; most shared words matches but is marked for a second look only when not clear; nothing close matches nothing', () => {
    expect(suggestItem('Miller Lite 24/12oz Btl', null, items, {}, null)).toEqual({ stockItemId: 'lite', matchedBy: 'name', sure: true })
    expect(suggestItem('Wings, Chicken', '40 lb', items, {}, null)).toEqual({ stockItemId: 'wings', matchedBy: 'name', sure: true })
    // "Spotted Cow" is the name of one item and two thirds of another: the exact one wins, and is sure.
    expect(suggestItem('Spotted Cow 6pk', null, items, {}, null)).toMatchObject({ stockItemId: 'ipa', sure: true })
    // Two items that differ only by a pack word ("Keg") are the same name to the rule: it offers one but is NOT sure.
    expect(suggestItem('Spotted Cow 6pk', null, [stock('a', 'Spotted Cow'), stock('b', 'Spotted Cow Keg')], {}, null)).toMatchObject({ matchedBy: 'name', sure: false })
    // Two of three words of a longer name: offered, but not sure.
    const half = suggestItem('Spotted Cow Draft', null, [stock('cow2', 'Spotted Cow Light')], {}, null)
    expect(half).toMatchObject({ stockItemId: 'cow2', matchedBy: 'name', sure: false })
    expect(suggestItem('Budweiser', null, items, {}, null)).toBeNull()
    expect(suggestItem('Delivery charge', null, items, {}, null)).toBeNull()
  })
  test('what a person matched by hand last time is matched again, and the invoice\'s own vendor breaks a tie', () => {
    expect(suggestItem('BL Longneck', null, items, { [aliasKey('BL Longneck')]: 'bud' }, null)).toEqual({ stockItemId: 'bud', matchedBy: 'saved', sure: true })
    // A saved match to an item that is gone is ignored, not followed.
    expect(suggestItem('BL Longneck', null, items, { [aliasKey('BL Longneck')]: 'gone' }, null)).toBeNull()
    const twins = [stock('a', 'House Vodka', 1, 'v1'), stock('b', 'House Vodka', 1, 'v2')]
    expect(suggestItem('House Vodka 1.75L', null, twins, {}, 'v2')?.stockItemId).toBe('b')
    expect(suggestVendor('Johnson Brothers of Wisconsin, Inc.', [{ id: 'v1', name: 'Johnson Brothers' }, { id: 'v2', name: 'Capital Beverage' }])).toBe('v1')
    expect(suggestVendor('Somebody Else', [{ id: 'v1', name: 'Johnson Brothers' }])).toBeNull()
  })
  test('a line is flagged for a second look in words: unmatched, guessed, no quantity, total that does not add up, a price that jumped', () => {
    const base = { n: 0, text: 'x', size: null, qty: 2, packCostCents: 3000, lineTotalCents: 6000, stockItemId: 'lite', matchedBy: 'name' as const, sure: true, skip: false }
    expect(lineWarnings(base, { packCostCents: 3000 })).toEqual([])
    expect(lineWarnings({ ...base, stockItemId: null, matchedBy: null, sure: false }, null)).toEqual(['Not matched to a stock item yet.'])
    expect(lineWarnings({ ...base, sure: false }, { packCostCents: 3000 })).toEqual(['Matched by a guess. Check it is the right item.'])
    expect(lineWarnings({ ...base, qty: null }, { packCostCents: 3000 })).toContain('How many came?')
    expect(lineWarnings({ ...base, lineTotalCents: 6500 }, { packCostCents: 3000 })).toContain('Quantity times price does not equal the line total on the invoice.')
    expect(lineWarnings({ ...base, lineTotalCents: 6010 }, { packCostCents: 3000 })).toEqual([])   // a cent or two of rounding is not flagged
    expect(lineWarnings({ ...base, packCostCents: 4600, lineTotalCents: 9200 }, { packCostCents: 3000 })).toEqual(['The price is 53% higher than last time. Check the size or the quantity.'])
    expect(lineWarnings({ ...base, skip: true, qty: null }, null)).toEqual([])
  })
  test('review lines carry the match; nothing is skipped on its own', () => {
    const lines = reviewLines([{ text: 'Miller Lite 24pk', size: '24/12oz', qty: 3, packCostCents: 2899, lineTotalCents: 8697 }, { text: 'Fuel surcharge', size: null, qty: 1, packCostCents: 500, lineTotalCents: 500 }], items, {}, null)
    expect(lines.map((l) => [l.stockItemId, l.skip])).toEqual([['lite', false], [null, false]])
  })
})

describe('the reader\'s JSON and the file sniff (pure)', () => {
  test('dollars become whole cents, bad numbers become nothing, a line with no words is dropped', () => {
    const r = parseRead('```json\n' + JSON.stringify({ supplier: ' Johnson  Brothers ', invoiceNumber: 'INV-1042', invoiceDate: '2026-10-28', total: '$1,234.56', lines: [
      { description: 'Miller Lite', size: '24/12oz', quantity: 3, unitPrice: 28.99, lineTotal: 86.97 },
      { description: 'Bud Light', quantity: '2', unitPrice: '30.10', lineTotal: null },
      { description: '', quantity: 1, unitPrice: 1 },
      { description: 'Wings', quantity: -4, unitPrice: 'n/a' },
    ] }) + '\n```')!
    expect(r.supplier).toBe('Johnson Brothers'); expect(r.invoiceDate).toBe('2026-10-28'); expect(r.totalCents).toBe(123456)
    expect(r.lines).toEqual([
      { text: 'Miller Lite', size: '24/12oz', qty: 3, packCostCents: 2899, lineTotalCents: 8697 },
      { text: 'Bud Light', size: null, qty: 2, packCostCents: 3010, lineTotalCents: null },
      { text: 'Wings', size: null, qty: null, packCostCents: null, lineTotalCents: null },
    ])
    expect(parseRead('I could not read this')).toBeNull()
    expect(parseRead('{"lines": "no"}')).toBeNull()
    expect(parseRead(JSON.stringify({ invoiceDate: '10/28/2026', lines: [] }))!.invoiceDate).toBeNull()
  })
  test('the kind of file is read from its first bytes, never from its name', () => {
    const pad = (b: number[]) => Uint8Array.from([...b, ...new Array(16).fill(0)])
    expect(sniffMediaType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMediaType(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(sniffMediaType(pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('application/pdf')
    expect(sniffMediaType(new TextEncoder().encode('<html>not a photo, it is a web page</html>'))).toBeNull()
  })
})

// ── The server ──────────────────────────────────────────────────────────────────────────────────────────────
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_stock']
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-fake-invoice-photo'), Buffer.alloc(40)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('fake invoice pdf'), Buffer.alloc(40)])
let k: Awaited<ReturnType<typeof bootFood>>
let realFetch: typeof fetch
const sent: Array<{ key: string | null; body: any }> = []
let reply: (body: any) => Response = () => new Response('{}', { status: 500 })
const objects = new Map<string, { body: Buffer; contentType: string }>()
const deleted: string[] = []
const answer = (j: unknown) => new Response(JSON.stringify({ content: [{ type: 'text', text: typeof j === 'string' ? j : JSON.stringify(j) }], usage: { input_tokens: 900, output_tokens: 300 }, model: 'claude-test' }), { status: 200, headers: { 'content-type': 'application/json' } })
const INVOICE = {
  supplier: 'Johnson Brothers of Wisconsin', invoiceNumber: 'JB-5531', invoiceDate: '2026-10-28', total: 273.97,
  lines: [
    { description: 'Miller Lite 24/12oz Btl', size: '24/12oz', quantity: 3, unitPrice: 28.99, lineTotal: 86.97 },
    { description: 'Chicken Wings Jumbo', size: '40 lb', quantity: 2, unitPrice: 62.5, lineTotal: 125 },
    { description: 'Lemon Lime Soda Mixer', size: null, quantity: 1, unitPrice: 12, lineTotal: 12 },
    { description: 'Fuel surcharge', size: null, quantity: 1, unitPrice: 50, lineTotal: 50 },
  ],
}
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const rows = async (table: any) => (await (k.t.db as any).select().from(table)) as any[]
/** A multipart upload as the browser and the phone send it. */
const upload = async (who: 'owner' | 'manager' | 'bartender', bytes: Buffer, name = 'invoice.jpg', extra: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(bytes)], name))
  for (const [a, b] of Object.entries(extra)) fd.set(a, b)
  const res = await k.t.app.request('/api/stock/invoices', { method: 'POST', headers: { Authorization: `Bearer ${k.tokens[who]}`, host: 'bar.test' }, body: fd })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}
const onHand = async (id: string) => ((await k.M('GET', '/api/stock/items')).json.stock as any[]).find((s) => s.id === id)
let lite: any, wings: any, vendor: any, mixer: any

beforeAll(async () => {
  k = await bootFood({ features: ON })
  realFetch = globalThis.fetch
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.anthropic.com/')) { const body = JSON.parse(String(init.body)); sent.push({ key: new Headers(init?.headers).get('x-api-key'), body }); return reply(body) }
    return inner(input, init)
  }) as any
  const storage = (k.t.services as any).crm.storage
  storage.put = async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) }
  storage.getObject = async (key: string) => objects.get(key) ?? null
  storage.deleteFile = async (key: string) => { deleted.push(key); objects.delete(key) }
  storage.storageConfigured = () => true
  vendor = await ins(k.S.barVendor, { companyId: k.companyId, name: 'Johnson Brothers' })
  lite = await ins(k.S.barStockItem, { companyId: k.companyId, name: 'Miller Lite', category: 'beer', unit: 'each', packName: 'case of 24', packSize: '24', packCostCents: 2600, vendorId: vendor.id })
  wings = await ins(k.S.barStockItem, { companyId: k.companyId, name: 'Chicken Wings', category: 'food', unit: 'lb', packName: 'case 40 lb', packSize: '40', packCostCents: 6000, vendorId: vendor.id })
  mixer = await ins(k.S.barStockItem, { companyId: k.companyId, name: 'Lemon Lime Soda', category: 'na', unit: 'each', packName: 'case of 24', packSize: '24', packCostCents: 1100 })
}, 60_000)
afterAll(() => { globalThis.fetch = realFetch; k.restore() })

describe('invoice scanning on the real server', () => {
  test('registered not ready; closed until the venue switches it on; only a manager reaches it', async () => {
    expect(FEATURE_MAP.bar_invoice_scan.hidden).toBe(true)
    expect((await k.M('GET', '/api/stock/invoices')).status).toBe(403)
    expect((await upload('manager', JPEG)).status).toBe(403)
    await k.features([...ON, 'bar_invoice_scan'])
    expect((await k.M('GET', '/api/stock/invoices')).status).toBe(200)
    // The bartender counts stock (bar:register) but does not manage it (bar:update): refused on every path.
    expect((await k.B('GET', '/api/stock/invoices')).status).toBe(403)
    expect((await upload('bartender', JPEG)).status).toBe(403)
    expect((await k.B('POST', '/api/stock/invoices/x/confirm', {})).status).toBe(403)
  })

  test('with no AI key on the server: the owner\'s sentence, never the setting\'s name; no call out, no file kept, no row', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const before = sent.length
    const r = await upload('manager', JPEG)
    expect(r.status).toBe(503)
    expect(r.json.error).toContain('support@twomiah.com'); expect(r.text).not.toContain('ANTHROPIC')
    expect(sent.length).toBe(before); expect(objects.size).toBe(0); expect(await rows(k.S.barInvoiceScan)).toHaveLength(0)
  })

  test('a file that is not a photo or a PDF, or is too big, is refused before any paid call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stand-in'
    const before = sent.length
    expect((await upload('manager', Buffer.from('<html>hello</html> and some more words here'), 'invoice.jpg')).status).toBe(415)
    expect((await upload('manager', Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]), 'big.jpg')).status).toBe(413)
    const none = await k.t.app.request('/api/stock/invoices', { method: 'POST', headers: { Authorization: `Bearer ${k.tokens.manager}`, host: 'bar.test' }, body: new FormData() })
    expect(none.status).toBe(400)
    expect(sent.length).toBe(before)
  })

  test('reading a photo changes NOTHING: the file goes to the reader as an image, the lines are matched, no count, no cost, no order', async () => {
    reply = () => answer(INVOICE)
    const wasLite = await onHand(lite.id)
    const r = await upload('manager', JPEG, 'jb-5531.jpg')
    expect(r.status).toBe(200)
    // The real reader's request, as Anthropic documents it: a base64 image block and the key in x-api-key.
    const call = sent.at(-1)!
    expect(call.key).toBe('sk-ant-test-stand-in')
    const block = call.body.messages[0].content[0]
    expect(block).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } })
    expect(Buffer.from(block.source.data, 'base64').equals(JPEG)).toBe(true)
    expect(call.body.max_tokens).toBeGreaterThan(0)
    const scan = r.json
    expect(scan).toMatchObject({ status: 'review', supplierName: 'Johnson Brothers of Wisconsin', invoiceNumber: 'JB-5531', invoiceDate: '2026-10-28', totalCents: 27397, vendorId: vendor.id, vendorName: 'Johnson Brothers', hasFile: true })
    // Matched: Miller Lite surely; the wings and the mixer are only guesses ("Jumbo", "Mixer" are extra words); the surcharge matches nothing. The vendor comes from the supplier's name.
    expect(scan.lines.map((l: any) => [l.text, l.stockItemId, l.matchedBy, l.sure])).toEqual([
      ['Miller Lite 24/12oz Btl', lite.id, 'name', true], ['Chicken Wings Jumbo', wings.id, 'name', false], ['Lemon Lime Soda Mixer', mixer.id, 'name', false], ['Fuel surcharge', null, null, false],
    ])
    expect(scan.needsAttention).toBe(3)
    expect(scan.lines[1].warnings).toEqual(['Matched by a guess. Check it is the right item.'])
    expect(scan.lines[3].warnings).toContain('Not matched to a stock item yet.')
    expect(scan.stock.length).toBe(3)
    // Nothing moved.
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(0)
    expect((await onHand(lite.id)).packCostCents).toBe(2600)
    expect((await onHand(lite.id)).onHand).toEqual(wasLite.onHand)
    expect(await rows(k.S.barPurchaseOrderLine)).toHaveLength(0)
    // The file is kept for the review, and a manager can open it.
    const file = await k.t.app.request(`/api/stock/invoices/${scan.id}/file`, { headers: { Authorization: `Bearer ${k.tokens.manager}`, host: 'bar.test' } })
    expect(file.status).toBe(200); expect(file.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await file.arrayBuffer()).equals(JPEG)).toBe(true)
    expect((await k.B('GET', `/api/stock/invoices/${scan.id}/file`)).status).toBe(403)
  })

  test('a PDF goes as a document block', async () => {
    reply = () => answer({ ...INVOICE, invoiceNumber: 'JB-PDF', lines: INVOICE.lines.slice(0, 1) })
    const r = await upload('manager', PDF, 'jb.pdf')
    expect(r.status).toBe(200)
    expect(sent.at(-1)!.body.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } })
    expect(r.json.fileType).toBe('application/pdf')
    await k.M('POST', `/api/stock/invoices/${r.json.id}/discard`, {})
  })

  test('a reading that fails leaves no row and no file: busy, unreadable, or no lines at all', async () => {
    const rowsBefore = (await rows(k.S.barInvoiceScan)).length, filesBefore = objects.size
    for (const [make, status, word] of [
      [() => new Response('{}', { status: 529 }), 502, 'busy'],
      [() => answer('I am sorry, I cannot read that.'), 502, 'could not be read'],
      [() => answer({ supplier: 'X', lines: [] }), 502, 'No product lines'],
    ] as const) {
      reply = make as any
      const r = await upload('manager', JPEG)
      expect(r.status).toBe(status); expect(r.json.error).toContain(word)
    }
    expect((await rows(k.S.barInvoiceScan)).length).toBe(rowsBefore); expect(objects.size).toBe(filesBefore)
  })

  let scanId = ''
  test('the person corrects the reading: a match, a quantity, a price, a skipped line, a line added; another business\'s item is refused', async () => {
    reply = () => answer(INVOICE)
    scanId = (await upload('manager', JPEG, 'jb-5531.jpg')).json.id
    // Confirming now is refused and changes nothing: the surcharge has no item.
    const early = await k.M('POST', `/api/stock/invoices/${scanId}/confirm`, {})
    expect(early.status).toBe(400); expect(early.json.error).toContain('Fuel surcharge')
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(0)
    // Another business's stock item cannot be named.
    const [other] = await (k.t.db as any).insert(k.S.company).values({ name: 'Other Bar', slug: 'other-bar', email: 'o@other.test' }).returning()
    const foreign = await ins(k.S.barStockItem, { companyId: other.id, name: 'Foreign', category: 'beer', unit: 'each', packName: 'case', packSize: '1' })
    expect((await k.M('PATCH', `/api/stock/invoices/${scanId}`, { lines: [{ n: 0, stockItemId: foreign.id }] })).status).toBe(404)
    expect((await k.M('PATCH', `/api/stock/invoices/${scanId}`, { lines: [{ n: 0, qty: -1 }] })).status).toBe(400)
    expect((await k.M('PATCH', `/api/stock/invoices/${scanId}`, { lines: [{ n: 0, packCostCents: 28.99 }] })).status).toBe(400)
    expect((await k.M('PATCH', `/api/stock/invoices/${scanId}`, { lines: [{ n: 99, qty: 1 }] })).status).toBe(404)
    const fixed = await k.M('PATCH', `/api/stock/invoices/${scanId}`, { invoiceNumber: 'JB-5531', lines: [
      { n: 1, stockItemId: wings.id },             // a guess checked by hand: the same item, now sure
      { n: 2, stockItemId: mixer.id },             // another
      { n: 3, skip: true },                        // the fuel surcharge is not stock
      { n: 1, qty: 2, packCostCents: 6250 },
    ] })
    expect(fixed.status).toBe(200)
    expect(fixed.json.lines[1]).toMatchObject({ stockItemId: wings.id, matchedBy: 'manual', sure: true, qty: 2, packCostCents: 6250 })
    expect(fixed.json.lines[2]).toMatchObject({ stockItemId: mixer.id, matchedBy: 'manual', sure: true })
    expect(fixed.json.lines[3].skip).toBe(true)
    expect(fixed.json.needsAttention).toBe(0)
    // The invoice's own total, against the lines that will be received.
    expect(fixed.json.linesTotalCents).toBe(8697 + 12500 + 1200)
    expect(fixed.json.differenceCents).toBe(27397 - (8697 + 12500 + 1200))
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(0)
  })

  test('CONFIRM makes one received order: on hand and prices move exactly as "It came in" moves them, and only once', async () => {
    // A finished count is the baseline on hand is estimated from.
    for (const [id, packs] of [[lite.id, 2], [wings.id, 1], [mixer.id, 0]] as const) await k.B('POST', '/api/stock/count/item', { stockItemId: id, packs, units: 0 })
    expect((await k.B('POST', '/api/stock/count/finish', {})).status).toBe(200)
    await new Promise((r) => setTimeout(r, 30))
    const before = Object.fromEntries(await Promise.all([lite, wings, mixer].map(async (i) => [i.id, (await onHand(i.id)).onHand])))
    expect(before[lite.id]).toBe(48)
    const done = await k.M('POST', `/api/stock/invoices/${scanId}/confirm`, {})
    expect(done.status).toBe(200)
    expect(done.json).toMatchObject({ lines: 3, totalCents: 8697 + 12500 + 1200 })
    expect(done.json.costChanges.map((c: any) => [c.name, c.fromCents, c.toCents])).toEqual([['Miller Lite', 2600, 2899], ['Chicken Wings', 6000, 6250], ['Lemon Lime Soda', 1100, 1200]])
    const [po] = await rows(k.S.barPurchaseOrder)
    expect(po).toMatchObject({ status: 'received', vendorId: vendor.id, receivedByName: 'Manager Seat' }); expect(po.note).toContain('JB-5531')
    expect((await rows(k.S.barPurchaseOrderLine)).map((l) => [l.stockItemId, Number(l.receivedPacks), l.receivedCostCents]).sort()).toEqual([[lite.id, 3, 2899], [wings.id, 2, 6250], [mixer.id, 1, 1200]].sort())
    // 3 cases of 24 more Miller Lite, 2 cases of 40 lb wings, 1 case of 24 sodas.
    expect((await onHand(lite.id)).onHand).toBe(before[lite.id] + 72)
    expect((await onHand(wings.id)).onHand).toBe(before[wings.id] + 80)
    expect((await onHand(mixer.id)).onHand).toBe(before[mixer.id] + 24)
    expect([(await onHand(lite.id)).packCostCents, (await onHand(wings.id)).packCostCents]).toEqual([2899, 6250])
    // Once: the second press is refused and makes no second order.
    const again = await k.M('POST', `/api/stock/invoices/${scanId}/confirm`, {})
    expect(again.status).toBe(409); expect(await rows(k.S.barPurchaseOrder)).toHaveLength(1)
    expect((await k.M('PATCH', `/api/stock/invoices/${scanId}`, { lines: [{ n: 0, qty: 9 }] })).status).toBe(409)
    expect((await k.M('POST', `/api/stock/invoices/${scanId}/discard`, {})).status).toBe(409)
    const shown = (await k.M('GET', `/api/stock/invoices/${scanId}`)).json
    expect(shown).toMatchObject({ status: 'confirmed', orderId: po.id, confirmedByName: 'Manager Seat' })
    // It is in the audit trail.
    const audits = await rows(k.S.auditLog)
    expect(audits.some((a) => a.entity === 'bar_invoice_scan' && JSON.stringify(a).includes('confirmed'))).toBe(true)
  })

  test('the same invoice number from the same supplier is refused unless the person says it is another delivery; a match made by hand is remembered', async () => {
    reply = () => answer(INVOICE)
    const dup = (await upload('manager', JPEG)).json
    // The mixer was checked by hand last time: it is matched the same way now, as a saved match.
    expect(dup.lines[2]).toMatchObject({ stockItemId: mixer.id, matchedBy: 'saved', sure: true })
    expect(dup.lines[1]).toMatchObject({ stockItemId: wings.id, matchedBy: 'saved', sure: true })
    expect(dup.duplicateOf).toMatchObject({ number: 1 })
    await k.M('PATCH', `/api/stock/invoices/${dup.id}`, { lines: [{ n: 3, skip: true }] })
    const refused = await k.M('POST', `/api/stock/invoices/${dup.id}/confirm`, {})
    expect(refused.status).toBe(409); expect(refused.json.error).toContain('already received')
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(1)
    expect((await k.M('POST', `/api/stock/invoices/${dup.id}/confirm`, { allowDuplicate: true })).status).toBe(200)
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(2)
  })

  test('discarding closes it, deletes the file, and changes nothing', async () => {
    reply = () => answer({ ...INVOICE, invoiceNumber: 'JB-9999' })
    const s = (await upload('manager', JPEG)).json
    const key = (await rows(k.S.barInvoiceScan)).find((r) => r.id === s.id).fileKey
    expect(objects.has(key)).toBe(true)
    expect((await k.M('POST', `/api/stock/invoices/${s.id}/discard`, {})).status).toBe(200)
    expect(deleted).toContain(key); expect(objects.has(key)).toBe(false)
    expect((await k.M('POST', `/api/stock/invoices/${s.id}/confirm`, {})).status).toBe(409)
    expect(await rows(k.S.barPurchaseOrder)).toHaveLength(2)
    expect(((await k.M('GET', '/api/stock/invoices')).json.data as any[]).some((i) => i.id === s.id)).toBe(false)
  })

  test('a day\'s reading is limited (each is a paid call), and the limit is the business\'s own', async () => {
    const have = (await rows(k.S.barInvoiceScan)).length
    const fill = Array.from({ length: 40 - have }, () => ({ companyId: k.companyId, status: 'discarded', lines: [] }))
    if (fill.length) await (k.t.db as any).insert(k.S.barInvoiceScan).values(fill)
    const before = sent.length
    const r = await upload('manager', JPEG)
    expect(r.status).toBe(429); expect(sent.length).toBe(before)
  })
})
