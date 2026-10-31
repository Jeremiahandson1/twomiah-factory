// Row 7 of the roofing parity brief (docs/parity/roof-gbb-proposals.md #5, #15, #16, "Still needed"), through the real server as the
// roofing vertical:
//   · the pages around the options: a cover page, About Us, sections placed in line, files for the whole proposal and for one option
//     (a manufacturer's brochure), the options' order flipped without losing the customer's choice, a photo or PDF uploaded straight
//     from the editor;
//   · the terms split into clauses the customer INITIALS before they sign — refused without them, kept as records after;
//   · a COSIGNER (the insurance carrier): the customer signs, the cosigner is sent a private link, and the quote is approved only when
//     the cosigner has signed too; the customer can change nothing in between; a proposal changed after the customer signed is not
//     cosigned; the link opens that one proposal and nothing else;
//   · the PDF carries the cover, About Us, sections, initials, both signatures and the attached PDFs' pages.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import sharp from 'sharp'
import PDFKit from 'pdfkit'
import { PDFDocument } from 'pdf-lib'
import { bootTenant, seedOwner } from './harness.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string; data: any }> = []
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Lee Marsh', consent: true }
const FEATURES = ['jobs', 'contacts', 'quotes', 'invoices', 'quote_proposals']
let homeId = ''
const PNG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a8' } }).png().toBuffer()
const pdfOf = (pages: number, text: string) => new Promise<Buffer>((resolve) => {
  const d = new PDFKit(); const chunks: Buffer[] = []
  d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks)))
  for (let i = 0; i < pages; i++) { if (i) d.addPage(); d.text(`${text} page ${i + 1}`) }
  d.end()
})

function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) { for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1'); out += '\n' }
  }
  return out
}
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const upload = (who: string, quoteId: string, bytes: Buffer, name: string, type: string) => {
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return as(who)(`/api/quotes/${quoteId}/proposal/file`, { method: 'POST', body: fd })
}
const OPTIONS = [
  { name: 'Good', tier: 'good', lines: [{ description: 'Supreme 3-tab shingles', quantity: 1, unitPrice: 5000 }] },
  { name: 'Better', tier: 'better', lines: [{ description: 'Timberline HDZ shingles', quantity: 1, unitPrice: 6500 }] },
  { name: 'Best', tier: 'best', lines: [{ description: 'Designer shingles', quantity: 1, unitPrice: 9500 }] },
]
const DOC = {
  coverTitle: 'Roof replacement for 12 Elm St', coverSubtitle: 'Prepared for Lee Marsh', aboutUs: 'Ridgeline has roofed Akron since 1998.',
  sections: [{ title: 'Our process', body: 'We tear off, dry in and finish in two days.', placement: 'before_options' }, { title: 'Our promise', body: 'We clean up every nail.', placement: 'after_options' }],
  termsClauses: [{ text: 'Payment is due on completion.' }, { text: 'Hidden rot is billed at cost.' }],
  attachments: [], cosigner: null as any,
}
async function newQuote(opts: { document?: any; options?: any[]; extra?: Record<string, unknown> } = {}) {
  const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: homeId, name: 'Roof replacement', taxRate: 0, terms: 'Work starts when the permit is issued.', lineItems: [{ description: 'Tear-off and disposal', quantity: 1, unitPrice: 2000 }], ...(opts.extra || {}) } }))
  expect(q.status).toBe(201)
  const id = q.body.id as string
  const saved = await json(await as('owner')(`/api/quotes/${id}/proposal`, { method: 'PUT', json: { options: opts.options ?? OPTIONS } }))
  expect(saved.status).toBe(200)
  if (opts.document) expect((await as('owner')(`/api/quotes/${id}/proposal/document`, { method: 'PUT', json: opts.document })).status).toBe(200)
  const r = await as('owner')(`/api/quotes/${id}/send`, { method: 'POST' })
  expect(r.status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  const read = await json(await as('owner')(`/api/quotes/${id}`))
  return { id, link, read, opt: (n: string) => read.body.proposal.options.find((o: any) => o.name === n) }
}
const portal = (link: string, id: string, path: string, init: any = {}) => t.call(`/api/portal/d/${link}/quotes/${id}${path}`, init)
const pickOpt = async (link: string, id: string, optionId: string) => json(await portal(link, id, '/choose-option', { method: 'POST', json: { optionId } }))
const cosign = (token: string, path = '', init: any = {}) => t.call(`/api/portal/c/${token}${path}`, init)

beforeAll(async () => {
  process.env.FRONTEND_URL ||= 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing', email: 'office@roofer.example' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(FEATURES)
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  const email: any = t.services.email
  const realSend = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ to, template, data }); return realSend(to, template, data, options) }
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  await t.db.insert(t.schema.user).values({ email: 'book@test.example', passwordHash: hash, firstName: 'Bo', lastName: 'Keeper', role: 'viewer', companyId } as any)
  tokens.viewer = await login('book@test.example', 'Seat-pass-1')
  homeId = (((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()) as any[])[0]).id
}, 120_000)

describe('the pages around the options', () => {
  test('the office saves a cover, About Us, sections and terms; the customer reads them; the cosigner is not on the customer page', async () => {
    const q = await newQuote({ document: { ...DOC, cosigner: { name: 'Dana Adjuster', email: 'dana@carrier.example', role: 'Insurance carrier' } } })
    const doc = q.read.body.document
    expect(doc).toMatchObject({ coverTitle: 'Roof replacement for 12 Elm St', aboutUs: 'Ridgeline has roofed Akron since 1998.' })
    expect(doc.sections.map((s: any) => [s.title, s.placement])).toEqual([['Our process', 'before_options'], ['Our promise', 'after_options']])
    expect(doc.termsClauses.map((c: any) => c.text)).toEqual(['Payment is due on completion.', 'Hidden rot is billed at cost.'])
    expect(doc.cosigner).toMatchObject({ name: 'Dana Adjuster', email: 'dana@carrier.example', status: 'waiting_for_customer' })
    expect(doc.cosigner.path).toMatch(/^\/c\/[0-9a-f]{64}$/)
    const seen = await json(await portal(q.link, q.id, ''))
    expect(seen.body.document.coverTitle).toBe('Roof replacement for 12 Elm St')
    expect(seen.body.document.termsClauses.map((c: any) => [c.text, c.initials])).toEqual([['Payment is due on completion.', null], ['Hidden rot is billed at cost.', null]])
    expect(seen.body.document.cosigner).toEqual({ name: 'Dana Adjuster', role: 'Insurance carrier', status: 'waiting_for_customer' })
    // Nothing of the cosigner's address or link reaches the customer.
    expect(JSON.stringify(seen.body)).not.toContain('dana@carrier.example')
    expect(JSON.stringify(seen.body)).not.toContain(doc.cosigner.path.slice(3))
  })

  test('the rules: a seat without quotes:update, the switch off, a bad cosigner, too many sections, a bad photo address', async () => {
    const q = await newQuote()
    const put = (body: any, who = 'owner') => as(who)(`/api/quotes/${q.id}/proposal/document`, { method: 'PUT', json: body })
    expect((await put(DOC, 'viewer')).status).toBe(403)
    expect((await put({ ...DOC, cosigner: { name: 'Dana', email: 'not-an-email' } })).status).toBe(400)
    expect((await put({ ...DOC, sections: Array.from({ length: 13 }, (_, i) => ({ title: `S${i}`, body: 'x', placement: 'top' })) })).status).toBe(400)
    expect((await put({ ...DOC, coverPhoto: 'javascript:alert(1)' })).status).toBe(400)
    expect((await put({ ...DOC, sections: [{ title: ' ', body: 'x', placement: 'top' }] })).status).toBe(400)
    await setFeatures(FEATURES.filter((f) => f !== 'quote_proposals'))
    expect((await put(DOC)).status).toBe(403)
    await setFeatures(FEATURES)
    expect((await put(DOC)).status).toBe(200)
    // Cleared by saving empty pages.
    const cleared = await json(await put({ sections: [], termsClauses: [], attachments: [] }))
    expect(cleared.body.document.termsClauses).toEqual([])
  })

  test('a photo or a PDF is uploaded straight from the editor and kept; anything else is refused', async () => {
    const q = await newQuote()
    const photo = await json(await upload('owner', q.id, PNG, 'roof.png', 'image/png'))
    expect(photo.status).toBe(201)
    expect(photo.body.url).toMatch(new RegExp(`^/media/photos/${companyId}/proposal/${q.id}/[0-9a-f]{32}\\.png$`))
    expect(t.store.objects.get(photo.body.url.slice('/media/'.length))?.contentType).toBe('image/png')
    const brochure = await json(await upload('owner', q.id, await pdfOf(1, 'GAF'), 'GAF Timberline brochure.pdf', 'application/pdf'))
    expect(brochure.status).toBe(201)
    expect(brochure.body).toMatchObject({ name: 'GAF Timberline brochure.pdf', contentType: 'application/pdf' })
    // A page of HTML sent as an image is not an image; a seat that may not edit the quote cannot upload.
    expect((await upload('owner', q.id, Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png')).status).toBe(400)
    expect((await upload('viewer', q.id, PNG, 'roof.png', 'image/png')).status).toBe(403)
    // The uploaded photo is a photo the option may show.
    const saved = await json(await as('owner')(`/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: [{ ...OPTIONS[0], photos: [photo.body.url] }, OPTIONS[1]] } }))
    expect(saved.status).toBe(200)
    expect(saved.body.proposal.options[0].photos).toEqual([photo.body.url])
  })

  test('an option carries its own brochure; the customer is shown it; the order flips and the choice stays', async () => {
    const q = await newQuote()
    const brochure = await json(await upload('owner', q.id, await pdfOf(2, 'Brochure'), 'Brochure.pdf', 'application/pdf'))
    const withFiles = OPTIONS.map((o, i) => (i === 1 ? { ...o, attachments: [{ name: brochure.body.name, url: brochure.body.url }] } : o))
    const saved = await json(await as('owner')(`/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: withFiles } }))
    expect(saved.body.proposal.options[1].attachments).toEqual([{ name: 'Brochure.pdf', url: brochure.body.url }])
    expect((await as('owner')(`/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: [{ ...OPTIONS[0], attachments: [{ name: 'x', url: 'ftp://x/y.pdf' }] }, OPTIONS[1]] } })).status).toBe(400)
    const ids = saved.body.proposal.options.map((o: any) => o.id)
    await as('owner')(`/api/quotes/${q.id}/proposal/choose`, { method: 'POST', json: { optionId: ids[1] } })
    const flipped = await json(await as('owner')(`/api/quotes/${q.id}/proposal/order`, { method: 'PUT', json: { optionIds: [...ids].reverse() } }))
    expect(flipped.status).toBe(200)
    expect(flipped.body.proposal.options.map((o: any) => o.name)).toEqual(['Best', 'Better', 'Good'])
    expect(flipped.body.proposal.chosenOptionId).toBe(ids[1])
    expect(Number(flipped.body.total)).toBe(8500)
    // Every option once; none from another quote; a seat that may not edit.
    expect((await as('owner')(`/api/quotes/${q.id}/proposal/order`, { method: 'PUT', json: { optionIds: [ids[0], ids[0], ids[1]] } })).status).toBe(400)
    expect((await as('owner')(`/api/quotes/${q.id}/proposal/order`, { method: 'PUT', json: { optionIds: [ids[0], ids[1]] } })).status).toBe(400)
    expect((await as('viewer')(`/api/quotes/${q.id}/proposal/order`, { method: 'PUT', json: { optionIds: ids } })).status).toBe(403)
  })
})

describe('the terms are initialed', () => {
  test('signing without initials on every term is refused with the terms named; with them it is kept as a record', async () => {
    const q = await newQuote({ document: DOC })
    await pickOpt(q.link, q.id, q.opt('Better').id)
    const clauses = (await json(await portal(q.link, q.id, ''))).body.document.termsClauses
    const none = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: SIGN }))
    expect(none.status).toBe(400)
    expect(none.body.code).toBe('initials_required')
    expect(Object.keys(none.body.fields).sort()).toEqual(clauses.map((c: any) => c.id).sort())
    const partial = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: { [clauses[0].id]: 'LM' } } }))
    expect(partial.status).toBe(400)
    expect(Object.keys(partial.body.fields)).toEqual([clauses[1].id])
    const bad = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: { [clauses[0].id]: '12', [clauses[1].id]: 'LM' } } }))
    expect(bad.status).toBe(400)
    // Nothing was approved by the refusals.
    expect(['sent', 'viewed']).toContain((await json(await as('owner')(`/api/quotes/${q.id}`))).body.status)
    const ok = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: { [clauses[0].id]: 'lm', [clauses[1].id]: 'LM' } } }))
    expect(ok.status).toBe(200)
    const marks = await t.db.select().from(t.schema.quoteProposalMark).where(eq(t.schema.quoteProposalMark.quoteId, q.id)) as any[]
    expect(marks.filter((m) => m.kind === 'initials').map((m) => [m.clauseId, m.initials, m.name]).sort()).toEqual(clauses.map((c: any) => [c.id, 'LM', 'Lee Marsh']).sort())
    expect(marks.every((m) => m.documentHash === (marks[0] as any).documentHash)).toBe(true)
    const after = await json(await portal(q.link, q.id, ''))
    expect(after.body.status).toBe('approved')
    expect(after.body.document.termsClauses.map((c: any) => c.initials)).toEqual(['LM', 'LM'])
    // The fingerprint of what was signed covers the initialed terms.
    const row = ((await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, q.id))) as any[])[0]
    expect(row.signatureHash).toBe(marks[0].documentHash)
  })

  test('a proposal with no terms to initial signs exactly as before', async () => {
    const q = await newQuote({ document: { ...DOC, termsClauses: [] } })
    await pickOpt(q.link, q.id, q.opt('Good').id)
    expect((await portal(q.link, q.id, '/approve', { method: 'POST', json: SIGN })).status).toBe(200)
  })
})

describe('the cosigner', () => {
  const COSIGNER = { name: 'Dana Adjuster', email: 'dana@carrier.example', role: 'Insurance carrier' }
  const INIT = (clauses: any[]) => Object.fromEntries(clauses.map((c) => [c.id, 'LM']))
  const CSIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Dana Adjuster', consent: true }

  test('the customer signs; the quote is NOT approved; the cosigner is emailed their own link; the customer can change nothing', async () => {
    const q = await newQuote({ document: { ...DOC, cosigner: COSIGNER } })
    await pickOpt(q.link, q.id, q.opt('Better').id)
    const clauses = (await json(await portal(q.link, q.id, ''))).body.document.termsClauses
    const mailBefore = sent.length
    const signed = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: INIT(clauses) } }))
    expect(signed.status).toBe(200)
    expect(signed.body.awaitingCosigner).toMatchObject({ name: 'Dana Adjuster', emailed: true })
    // Not approved: no approval, no deposit, the job's value untouched, until the cosigner signs.
    const mid = await json(await as('owner')(`/api/quotes/${q.id}`))
    expect(['sent', 'viewed']).toContain(mid.body.status)
    expect(mid.body.signature).toBeFalsy()
    expect(mid.body.document.cosigner.status).toBe('waiting')
    const mail = sent.slice(mailBefore).find((m) => m.template === 'quoteCosign')!
    expect(mail.to).toBe('dana@carrier.example')
    expect(mail.data.cosignPath).toBe(mid.body.document.cosigner.path)
    expect(mail.data.signerName).toBe('Lee Marsh')
    // The customer's page says so, and every change is refused while they wait.
    const page = await json(await portal(q.link, q.id, ''))
    expect(page.body.document.cosigner).toEqual({ name: 'Dana Adjuster', role: 'Insurance carrier', status: 'waiting' })
    const moved = await pickOpt(q.link, q.id, q.opt('Best').id)
    expect(moved.status).toBe(400)
    expect(moved.body.error).toContain('Dana Adjuster still has to sign')
    expect((await json(await portal(q.link, q.id, '/choose-upgrade', { method: 'POST', json: { lineItemId: 'x', selected: true } }))).status).toBe(400)
  })

  test('the cosigner signs on their own link: only then is the quote approved, with the customer\'s signature and both on record', async () => {
    const q = await newQuote({ document: { ...DOC, cosigner: COSIGNER }, extra: { depositType: 'percent', depositValue: 10 } })
    await pickOpt(q.link, q.id, q.opt('Better').id)
    const clauses = (await json(await portal(q.link, q.id, ''))).body.document.termsClauses
    await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: INIT(clauses) } })
    const token = (await json(await as('owner')(`/api/quotes/${q.id}`))).body.document.cosigner.path.slice(3)
    const seen = await json(await cosign(token))
    expect(seen.status).toBe(200)
    expect(seen.body.cosigner).toMatchObject({ name: 'Dana Adjuster', state: 'ready', customerName: 'Lee Marsh' })
    expect(seen.body.quote).toMatchObject({ number: expect.any(String), total: '8500.00' })
    expect(seen.body.quote.document.termsClauses.map((c: any) => c.initials)).toEqual(['LM', 'LM'])
    // A wrong link opens nothing; the signature, name and consent are all required.
    expect((await cosign('0'.repeat(64))).status).toBe(404)
    expect((await cosign('short')).status).toBe(404)
    expect((await cosign(token, '/sign', { method: 'POST', json: { ...CSIGN, consent: false } })).status).toBe(400)
    expect((await cosign(token, '/sign', { method: 'POST', json: { ...CSIGN, signedBy: ' ' } })).status).toBe(400)
    const done = await json(await cosign(token, '/sign', { method: 'POST', json: CSIGN }))
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('approved')
    const row = ((await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, q.id))) as any[])[0]
    expect(row).toMatchObject({ status: 'approved', signedBy: 'Lee Marsh' })
    expect(row.signature).toBe(SIGN.signature)
    const marks = await t.db.select().from(t.schema.quoteProposalMark).where(eq(t.schema.quoteProposalMark.quoteId, q.id)) as any[]
    expect(marks.filter((m) => m.kind === 'cosigner_signature').map((m) => m.name)).toEqual(['Dana Adjuster'])
    expect(marks.filter((m) => m.kind === 'customer_signature').length).toBe(1)
    const audits = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, q.id)) as any[]
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['quote.signed_awaiting_cosigner', 'quote.cosigned', 'quote.signed']))
    // The deposit the quote asks was raised only now, with the approval.
    expect((await json(await portal(q.link, q.id, ''))).body.deposit).toBeTruthy()
    // Signing twice, or after approval, is refused.
    expect((await cosign(token, '/sign', { method: 'POST', json: CSIGN })).status).toBe(400)
    expect((await json(await cosign(token))).body.cosigner.state).toBe('signed')
  })

  test('the cosigner cannot sign before the customer; a proposal changed after the customer signed is not cosigned', async () => {
    const q = await newQuote({ document: { ...DOC, termsClauses: [], cosigner: COSIGNER } })
    const token = q.read.body.document.cosigner.path.slice(3)
    expect((await json(await cosign(token))).body.cosigner.state).toBe('not_yet')
    const early = await json(await cosign(token, '/sign', { method: 'POST', json: CSIGN }))
    expect(early.status).toBe(400)
    expect(early.body.error).toContain('has not signed yet')
    await pickOpt(q.link, q.id, q.opt('Better').id)
    await portal(q.link, q.id, '/approve', { method: 'POST', json: SIGN })
    // The office edits what the customer signed.
    expect((await as('owner')(`/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: [{ description: 'Tear-off and disposal', quantity: 1, unitPrice: 2500 }] } })).status).toBe(200)
    const late = await json(await cosign(token, '/sign', { method: 'POST', json: CSIGN }))
    expect(late.status).toBe(409)
    expect(late.body.error).toContain('changed after Lee Marsh signed')
    expect((((await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, q.id))) as any[])[0]).status).not.toBe('approved')
  })

  test('the office can send the cosigner the link again; a new cosigner address kills the old link; the link shows no other quote', async () => {
    const q = await newQuote({ document: { ...DOC, termsClauses: [], cosigner: COSIGNER } })
    const resend = () => as('owner')(`/api/quotes/${q.id}/proposal/cosigner/send`, { method: 'POST' })
    expect((await resend()).status).toBe(400)
    await pickOpt(q.link, q.id, q.opt('Good').id)
    await portal(q.link, q.id, '/approve', { method: 'POST', json: SIGN })
    const before = sent.length
    expect((await resend()).status).toBe(200)
    expect(sent.slice(before).filter((m) => m.template === 'quoteCosign').length).toBe(1)
    const oldToken = (await json(await as('owner')(`/api/quotes/${q.id}`))).body.document.cosigner.path.slice(3)
    // A seat that may not edit quotes does not get the link, nor can it resend.
    expect((await as('viewer')(`/api/quotes/${q.id}/proposal/cosigner/send`, { method: 'POST' })).status).toBe(403)
    expect(JSON.stringify((await json(await as('viewer')(`/api/quotes/${q.id}`))).body)).not.toContain(oldToken)
    // Another person as cosigner: the old link stops.
    await as('owner')(`/api/quotes/${q.id}/proposal/document`, { method: 'PUT', json: { ...DOC, termsClauses: [], cosigner: { name: 'Sam Spouse', email: 'sam@home.example', role: 'Spouse' } } })
    expect((await cosign(oldToken)).status).toBe(404)
    const fresh = (await json(await as('owner')(`/api/quotes/${q.id}`))).body.document.cosigner
    expect(fresh.path.slice(3)).not.toBe(oldToken)
    // The link answers for its own proposal only: no route lists or opens anything else.
    expect((await cosign(fresh.path.slice(3), '/../quotes')).status).toBeGreaterThanOrEqual(400)
  })
})

describe('the PDF', () => {
  test('it carries the cover, About Us, sections, the terms with initials, both signatures and the attached PDFs', async () => {
    const q = await newQuote({ document: { ...DOC, cosigner: { name: 'Dana Adjuster', email: 'dana@carrier.example', role: 'Insurance carrier' } } })
    const proposalPdf = await json(await upload('owner', q.id, await pdfOf(2, 'Proposal brochure'), 'Proposal brochure.pdf', 'application/pdf'))
    const optionPdf = await json(await upload('owner', q.id, await pdfOf(3, 'Better brochure'), 'Better brochure.pdf', 'application/pdf'))
    const cover = await json(await upload('owner', q.id, PNG, 'cover.png', 'image/png'))
    await as('owner')(`/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: OPTIONS.map((o, i) => (i === 1 ? { ...o, attachments: [{ name: 'Better brochure.pdf', url: optionPdf.body.url }] } : o)) } })
    await as('owner')(`/api/quotes/${q.id}/proposal/document`, { method: 'PUT', json: { ...DOC, coverPhoto: cover.body.url, attachments: [{ name: 'Proposal brochure.pdf', url: proposalPdf.body.url }], cosigner: { name: 'Dana Adjuster', email: 'dana@carrier.example', role: 'Insurance carrier' } } })
    const options = (await json(await as('owner')(`/api/quotes/${q.id}`))).body.proposal.options
    const pages = async (buf: ArrayBuffer) => (await PDFDocument.load(buf)).getPageCount()
    // Before a choice every option's files follow (the proposal's 2 pages and the Better brochure's 3).
    const before = await (await as('owner')(`/api/quotes/${q.id}/pdf`)).arrayBuffer()
    const text = pdfText(new Uint8Array(before))
    for (const s of ['Roof replacement for 12 Elm St', 'Prepared for Lee Marsh', 'About Ridgeline Roofing', 'Ridgeline has roofed Akron since 1998.', 'Our process', 'Our promise', 'Hidden rot is billed at cost.', 'Initials:', '______']) expect(text).toContain(s)
    const base = await pages(before) - 5
    expect(base).toBeGreaterThanOrEqual(2)
    // Chosen, initialed and signed by both: the chosen option's brochure only, the initials and both signatures printed.
    await pickOpt(q.link, q.id, options[1].id)
    const clauses = (await json(await portal(q.link, q.id, ''))).body.document.termsClauses
    await portal(q.link, q.id, '/approve', { method: 'POST', json: { ...SIGN, initials: Object.fromEntries(clauses.map((c: any) => [c.id, 'LM'])) } })
    const token = (await json(await as('owner')(`/api/quotes/${q.id}`))).body.document.cosigner.path.slice(3)
    await cosign(token, '/sign', { method: 'POST', json: { signature: 'data:image/png;base64,' + PNG.toString('base64'), signedBy: 'Dana Adjuster', consent: true } })
    const after = await (await portal(q.link, q.id, '/pdf')).arrayBuffer()
    const t2 = pdfText(new Uint8Array(after))
    expect(t2).toMatch(/Initials:\s*LM/)
    expect(t2).not.toContain('______')
    expect(t2).toContain('Signed by the customer')
    expect(t2).toContain('Cosigned (Insurance carrier)')
    expect(t2).toContain('Dana Adjuster')
    expect(await pages(after)).toBeGreaterThan(base + 4)
  })
})
