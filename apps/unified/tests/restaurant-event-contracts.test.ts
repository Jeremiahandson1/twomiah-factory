// Restaurant & bar parity #1 (docs/parity/restaurant-1-proposal-esign.md): a venue's contract templates with merge fields, chosen
// per event, and a proposal signed by several people in a send order — the client, a second client signer, the venue's
// countersignature — each with a drawn signature, typed name, consent and time kept; the PDF carries every signature; the event
// books only when the LAST one signs. On the real server (bootFood, a restaurant tenant); each test fails without the change.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { pdfFacts } from './pdfText.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_guarantee', 'event_minimums', 'event_proposals', 'event_contracts']
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let k: Awaited<ReturnType<typeof bootFood>>
let today = '', clientId = '', roomId = '', viewerToken = ''
const V = async (method: string, path: string) => {
  const res = await k.t.call(path, { method, headers: { Authorization: `Bearer ${viewerToken}`, host: 'bar.test' } })
  const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}
  return { status: res.status, json: j }
}
const later = (n: number) => dayBefore(today, -n)
const mailsTo = (to: string) => k.mails.filter((m) => m.to === to)
const tokenOf = (path: string) => path.split('/').pop()!
const link = (tok: string, p = '') => `/api/proposal-links/${tok}${p}`
const sign = (tok: string, who: string, extra: Record<string, unknown> = {}) => k.pub('POST', link(tok, '/accept'), { signature: SIG, signedBy: who, consent: true, ...extra })

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: [...BASE, ...DEPTH] })
  today = await venueToday(k.t.db, k.companyId)
  const svc = k.t.services.crm.emailService as any
  svc.send = async (to: string, template: string, data: any) => { k.mails.push({ to, subject: String(data.subject ?? data.headline ?? template), html: JSON.stringify(data) }); return { success: true } }
  await (k.t.db as any).insert(k.S.user).values({ email: 'viewer@bar.test', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId: k.companyId })
  viewerToken = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@bar.test', password: 'Seat-pass-1' } })).json() as any).accessToken
  clientId = (await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })).json.id
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 10 }, email: 'events@venue.test', name: 'The Loft Venue' }).where(eq(k.S.company.id, k.companyId))
  roomId = (await k.O('POST', '/api/event-spaces', { name: 'The Loft', seatedCapacity: 50, standingCapacity: 80 })).json.id
  await k.O('POST', '/api/event-minimums', { spaceId: roomId, label: 'Any night', amount: 1500 })
}, 60_000)
afterAll(() => k.restore())

const TEMPLATE = [
  'EVENT CONTRACT between {{venue_name}} and {{client_name}} ({{client_email}}).',
  'Event: {{event_name}} on {{event_date}}, {{event_hours}}, in {{room_name}} ({{room_capacity}}) for {{head_count}} guests.',
  'Menu:\n{{menu}}',
  'Subtotal {{subtotal}}, tax {{tax}}, total {{total}}.',
  'Deposit {{deposit_amount}}. Schedule:\n{{deposit_schedule}}',
  '{{guarantee_terms}}',
  '{{minimum_terms}}',
  'Second signer: {{second_signer_name}}. Questions: {{venue_phone}} {{venue_email}}.',
].join('\n')

describe('contract templates per venue, with merge fields', () => {
  let templateId = ''
  test('only the owner or admin writes a template; any seat that reads proposals can read them; the seat without the right is refused', async () => {
    expect((await k.M('POST', '/api/event-contracts', { name: 'Wedding contract', body: TEMPLATE })).status).toBe(403)
    expect((await k.B('GET', '/api/event-contracts')).status).toBe(403)
    const made = await k.O('POST', '/api/event-contracts', { name: 'Wedding contract', body: TEMPLATE, isDefault: true })
    expect(made.status).toBe(201); templateId = made.json.id
    expect((await k.M('GET', '/api/event-contracts')).json.data.map((t: any) => t.name)).toContain('Wedding contract')
    expect((await k.M('PUT', `/api/event-contracts/${templateId}`, { name: 'x' })).status).toBe(403)
    expect((await k.M('DELETE', `/api/event-contracts/${templateId}`)).status).toBe(403)
  })

  test('a template with a field that does not exist, no text or no name is refused with a sentence; the list of fields comes from the server', async () => {
    const bad = await k.O('POST', '/api/event-contracts', { name: 'Typo', body: 'Hello {{clientname}}' })
    expect(bad.status).toBe(400); expect(bad.json.error).toMatch(/clientname.*not a merge field/)
    expect((await k.O('POST', '/api/event-contracts', { name: 'Open', body: 'Hello {{client_name' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-contracts', { name: '', body: 'x' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-contracts', { name: 'Empty', body: '   ' })).status).toBe(400)
    const fields = (await k.M('GET', '/api/event-contracts/fields')).json.data.map((f: any) => f.id)
    for (const f of ['client_name', 'event_date', 'room_name', 'head_count', 'menu', 'total', 'deposit_schedule', 'guarantee_terms', 'minimum_terms']) expect(fields).toContain(f)
  })

  test('one default at a time', async () => {
    const second = await k.O('POST', '/api/event-contracts', { name: 'Corporate contract', body: 'Corporate: {{event_name}} for {{client_name}}', isDefault: true })
    const list = (await k.O('GET', '/api/event-contracts')).json.data
    expect(list.filter((t: any) => t.isDefault).map((t: any) => t.id)).toEqual([second.json.id])
    await k.O('PUT', `/api/event-contracts/${templateId}`, { isDefault: true })
    expect((await k.O('GET', '/api/event-contracts')).json.data.filter((t: any) => t.isDefault).map((t: any) => t.id)).toEqual([templateId])
  })

  test('the preview fills every field from the event: client, date, room, head count, menu, totals, deposit schedule, guarantee and minimum terms', async () => {
    const ev = await k.O('POST', '/api/events', { name: 'Diaz Rehearsal', eventDate: later(120), status: 'tentative', guestCount: 20, spaceId: roomId, contactId: clientId, startTime: '17:00', endTime: '21:00' })
    await k.O('POST', `/api/events/${ev.json.id}/menu`, { name: 'Welcome drink', unitPrice: 10, quantity: 20 })
    await k.O('POST', `/api/events/${ev.json.id}/payments`, { label: 'Deposit', amount: 200, dueDate: later(30) })
    const text = (await k.M('GET', `/api/event-contracts/${templateId}/preview?eventId=${ev.json.id}`)).json.text as string
    expect(text).toContain('The Loft Venue'); expect(text).toContain('Harper Diaz'); expect(text).toContain('harper@client.test')
    expect(text).toContain('Diaz Rehearsal'); expect(text).toMatch(/\b20\d\d\b/); expect(text).toContain('17:00 – 21:00')
    expect(text).toContain('The Loft'); expect(text).toContain('50 seated, 80 standing'); expect(text).toContain('for 20 guests')
    expect(text).toContain('Welcome drink — 20 × $10.00 = $200.00')
    expect(text).toMatch(/Deposit \$200\.00/); expect(text).toMatch(/Deposit — \$200\.00, due /)
    expect(text).toContain('final guest count is due 7 days before'); expect(text).toContain('minimum of $1,500.00')
    expect(text).not.toMatch(/\{\{/)
    expect((await k.M('GET', `/api/event-contracts/${templateId}/preview?eventId=nope`)).status).toBe(404)
  })

  test('with the feature off the templates are gone and a proposal cannot ask for one', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_contracts')])
    expect((await k.O('GET', '/api/event-contracts')).status).toBe(403)
    const ev = await k.O('POST', '/api/events', { name: 'No contract', eventDate: later(130), status: 'tentative', contactId: clientId })
    const asked = await k.O('POST', '/api/event-proposals', { eventId: ev.json.id, signers: [{ role: 'client' }, { role: 'venue' }] })
    expect(asked.status).toBe(400); expect(asked.json.error).toMatch(/not switched on/)
    const plain = await k.O('POST', '/api/event-proposals', { eventId: ev.json.id })
    expect(plain.status).toBe(201); expect(plain.json.contractBody).toBeNull()
    await k.features([...BASE, ...DEPTH])
  })
})

describe('several signers, in order — the event books when the last one signs', () => {
  let eventId = '', propId = '', templateId = '', optId = '', steak = ''
  let tokens: string[] = []
  test('a proposal carries the chosen template and the signers in their send order; the client must come first', async () => {
    templateId = (await k.O('GET', '/api/event-contracts')).json.data.find((t: any) => t.isDefault).id
    const ev = await k.O('POST', '/api/events', { name: 'Diaz Wedding', eventDate: later(150), status: 'tentative', guestCount: 20, spaceId: roomId, contactId: clientId, startTime: '17:00', endTime: '21:00' })
    eventId = ev.json.id
    await k.O('POST', `/api/events/${eventId}/menu`, { name: 'Welcome drink', unitPrice: 10, quantity: 20 })
    await k.O('POST', `/api/events/${eventId}/payments`, { label: 'Deposit', amount: 200, dueDate: later(30) })
    const options = [{ title: 'Choose your main', kind: 'single', required: true, choices: [{ label: 'Steak', price: 40 }, { label: 'Fish', price: 32 }] }]
    const signers = [{ role: 'client' }, { role: 'client_second', name: 'Sam Diaz', email: 'sam@client.test' }, { role: 'venue', name: 'Pat Manager' }]
    expect((await k.B('POST', '/api/event-proposals', { eventId, options, signers })).status).toBe(403)
    // The client signs first; a second signer needs a name and a real email; a role is not repeated.
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, signers: [{ role: 'venue' }, { role: 'client' }] })).json.error).toMatch(/client signs first/i)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, signers: [{ role: 'client' }, { role: 'client_second', name: 'Sam' }] })).status).toBe(400)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, signers: [{ role: 'client' }, { role: 'client_second', name: 'Sam', email: 'not-an-email' }] })).status).toBe(400)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, signers: [{ role: 'client' }, { role: 'client' }] })).status).toBe(400)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, signers: [{ role: 'boss' }] })).status).toBe(400)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options, contractTemplateId: 'nope', signers })).status).toBe(400)
    const made = await k.O('POST', '/api/event-proposals', { eventId, options, signers, contractTemplateId: templateId })
    expect(made.status).toBe(201); propId = made.json.id
    expect(made.json.contractName).toBe('Wedding contract')
    expect(made.json.signers.map((s: any) => [s.position, s.role, s.status])).toEqual([[1, 'client', 'draft'], [2, 'client_second', 'draft'], [3, 'venue', 'draft']])
    optId = made.json.options[0].id; steak = made.json.options[0].choices[0].id
  })

  test('sending emails only the first signer; the others have links that wait their turn', async () => {
    const n = { client: mailsTo('harper@client.test').length, second: mailsTo('sam@client.test').length, venue: mailsTo('events@venue.test').length }
    const sent = await k.O('POST', `/api/event-proposals/${propId}/send`)
    expect(sent.status).toBe(200)
    expect(mailsTo('harper@client.test').length).toBe(n.client + 1)
    expect(mailsTo('sam@client.test').length).toBe(n.second); expect(mailsTo('events@venue.test').length).toBe(n.venue)
    const staff = (await k.O('GET', `/api/event-proposals/${propId}`)).json
    expect(staff.signers.map((s: any) => [s.role, s.status])).toEqual([['client', 'sent'], ['client_second', 'waiting'], ['venue', 'waiting']])
    tokens = staff.signers.map((s: any) => tokenOf(s.path))
    expect(new Set(tokens).size).toBe(3)
    // The links are the secret: a seat that can read but not edit money sees names and stages, never a link or an email.
    const seen = (await V('GET', `/api/event-proposals/${propId}`)).json
    expect(JSON.stringify(seen.signers)).not.toMatch(/event-proposal\/|@client\.test|@venue\.test/)
    // The venue (third) cannot sign before the client or the second signer.
    const early = await sign(tokens[2], 'Pat Manager', { selections: { [optId]: [steak] } })
    expect(early.status).toBe(409); expect(early.json.code).toBe('not_your_turn')
    expect(early.json.error).toMatch(/has to sign first/)
  })

  test('the guest sees the contract filled in with their choice, and who has signed', async () => {
    const v = await k.pub('GET', link(tokens[0]))
    expect(v.status).toBe(200)
    expect(v.json.contract.name).toBe('Wedding contract')
    expect(v.json.contract.text).toContain('Harper Diaz'); expect(v.json.contract.text).toContain('Second signer: Sam Diaz.')
    expect(JSON.stringify(v.json)).not.toMatch(/signatureHash|signedIp|publicToken|companyId/)
    expect(v.json.signers.map((s: any) => [s.roleLabel, s.status])).toEqual([['Client', 'sent'], ['Second client signer', 'waiting'], ['Venue (countersignature)', 'waiting']])
    expect(v.json.you).toMatchObject({ position: 1, role: 'client', status: 'sent' })
    const pick = await k.pub('PUT', link(tokens[0], '/choices'), { selections: { [optId]: [steak] } })
    // $200 drink + $800 steak = $1,000 of the $1,500 minimum: the shortfall is worked out again at $500, so the total is $1,500 + 10% tax.
    expect(pick.json.contract.text).toContain('Steak'); expect(pick.json.contract.text).toContain('Food and beverage minimum shortfall — 1 × $500.00 = $500.00'); expect(pick.json.contract.text).toContain('total $1,650.00')
    expect(pick.json.minimum).toMatchObject({ required: 1500, spend: 1000, shortfall: 500 })
    // The second signer cannot make the choices.
    expect((await k.pub('PUT', link(tokens[1], '/choices'), { selections: { [optId]: [steak] } })).status).toBe(409)
  })

  test('the first signature is kept but books nothing; the next signer is emailed; the choices are locked', async () => {
    const n = mailsTo('sam@client.test').length
    const first = await sign(tokens[0], 'Harper Diaz', { selections: { [optId]: [steak] } })
    expect(first.status).toBe(200); expect(first.json.status).toBe('partly_signed')
    const got = (await k.O('GET', `/api/events/${eventId}`)).json
    expect(got.event.status).toBe('tentative'); expect(got.event.bookedAt).toBeFalsy()
    expect(got.menu.some((l: any) => /Steak/.test(l.name))).toBe(false)
    // The invoice for the scheduled deposit already exists; the guest's choice is not on it until the date is booked.
    expect(Number(got.invoice.total)).toBe(1650)
    expect(mailsTo('sam@client.test').length).toBe(n + 1)
    expect(mailsTo('sam@client.test').at(-1)!.subject).toMatch(/your signature is needed/)
    expect((await k.pub('GET', link(tokens[0]))).json.signers.map((s: any) => s.status)).toEqual(['signed', 'sent', 'waiting'])
    expect((await sign(tokens[0], 'Harper Diaz')).json.code).toBe('already_signed')
    expect((await k.pub('PUT', link(tokens[0], '/choices'), { selections: { [optId]: [] } })).json.code).toBe('choices_locked')
    // Still the venue's turn is not yet.
    expect((await sign(tokens[2], 'Pat Manager')).json.code).toBe('not_your_turn')
    // The proposal is still out: staff see it part signed and cannot be tricked into replacing the signed words by editing.
    const staff = (await k.O('GET', `/api/event-proposals/${propId}`)).json
    expect(staff.status).toBe('partly_signed')
    expect((await k.O('PUT', `/api/event-proposals/${propId}`, { message: 'late' })).status).toBe(409)
  })

  test('the second signer signs what the first chose, a typed name, consent and drawn signature required; still not booked', async () => {
    expect((await k.pub('POST', link(tokens[1], '/accept'), { signedBy: 'Sam Diaz', consent: true })).status).toBe(400)
    expect((await k.pub('POST', link(tokens[1], '/accept'), { signature: SIG, consent: true })).status).toBe(400)
    expect((await k.pub('POST', link(tokens[1], '/accept'), { signature: SIG, signedBy: 'Sam Diaz' })).status).toBe(400)
    const n = mailsTo('events@venue.test').length
    // Their own selections in the body change nothing: they sign what was chosen.
    const second = await sign(tokens[1], 'Sam Diaz', { selections: { [optId]: [] } })
    expect(second.status).toBe(200); expect(second.json.status).toBe('partly_signed')
    expect(mailsTo('events@venue.test').length).toBe(n + 1)
    expect((await k.O('GET', `/api/events/${eventId}`)).json.event.status).toBe('tentative')
  })

  test('the venue’s countersignature is the last: it books the date, makes the menu lines and the invoice, and the client is told', async () => {
    const n = mailsTo('harper@client.test').length
    const last = await sign(tokens[2], 'Pat Manager')
    expect(last.status).toBe(200); expect(last.json.status).toBe('accepted')
    const got = (await k.O('GET', `/api/events/${eventId}`)).json
    expect(got.event.status).toBe('confirmed'); expect(got.event.bookedAt).toBeTruthy()
    expect(got.menu.some((l: any) => /Steak/.test(l.name) && l.quantity === 20)).toBe(true)
    // What the contract said is what the bill says.
    expect(Number(got.invoice.total)).toBe(1650)
    expect(mailsTo('harper@client.test').length).toBe(n + 1)
    expect(mailsTo('harper@client.test').at(-1)!.subject).toMatch(/date is booked/i)
    expect((await sign(tokens[2], 'Pat Manager')).status).toBe(409)
  })

  test('each signer’s drawn signature, typed name, consent words and time are kept, and the audit trail has all three', async () => {
    const staff = (await k.O('GET', `/api/event-proposals/${propId}`)).json
    expect(staff.status).toBe('accepted')
    expect(staff.signers.map((s: any) => [s.role, s.name, s.status])).toEqual([['client', 'Harper Diaz', 'signed'], ['client_second', 'Sam Diaz', 'signed'], ['venue', 'Pat Manager', 'signed']])
    expect(staff.signers.every((s: any) => /^[0-9a-f]{64}$/.test(s.signatureHash) && s.consentAt && s.signedAt)).toBe(true)
    expect(new Set(staff.signers.map((s: any) => s.signatureHash)).size).toBe(3)
    const rows = await (k.t.db as any).select().from(k.S.eventProposalSigner).where(eq(k.S.eventProposalSigner.proposalId, propId))
    expect(rows.every((r: any) => r.signature === SIG && r.consentText && r.signedIp !== undefined && r.status === 'signed')).toBe(true)
    const audits = (await (k.t.db as any).select().from(k.S.auditLog).where(eq(k.S.auditLog.entityId, propId))).filter((a: any) => a.action === 'event_proposal.signed')
    expect(audits.map((a: any) => a.userName).sort()).toEqual(['Harper Diaz', 'Pat Manager', 'Sam Diaz'])
    expect(audits.map((a: any) => a.metadata.signerRole).sort()).toEqual(['client', 'client_second', 'venue'])
  })

  test('the PDF carries the contract, every signer, every typed name and every drawn signature', async () => {
    const pdf = Buffer.from(await (await k.t.call(link(tokens[0], '/pdf'), { headers: { host: 'bar.test' } })).arrayBuffer())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const { text, images } = pdfFacts(pdf)
    expect(images).toBe(3)
    for (const s of ['Wedding contract', 'Signatures', 'Signed by Harper Diaz', 'Signed by Sam Diaz', 'Signed by Pat Manager', 'Client', 'Second client signer', 'Venue (countersignature)', 'Agreed to sign electronically']) expect(text).toContain(s)
    expect(text).toContain('EVENT CONTRACT between The Loft Venue and Harper Diaz')
    const staff = await k.O('GET', `/api/event-proposals/${propId}/pdf`)
    expect(staff.status).toBe(200)
  })
})

describe('what was sent is what is signed', () => {
  test('editing the template after a proposal is sent changes nothing the guest reads or signs', async () => {
    const t = (await k.O('GET', '/api/event-contracts')).json.data.find((x: any) => x.isDefault)
    const ev = await k.O('POST', '/api/events', { name: 'Frozen Gala', eventDate: later(160), status: 'tentative', guestCount: 10, contactId: clientId })
    const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.json.id, contractTemplateId: t.id })).json
    const sent = (await k.O('POST', `/api/event-proposals/${p.id}/send`)).json
    const tok = tokenOf(sent.path)
    const before = (await k.pub('GET', link(tok))).json.contract.text
    await k.O('PUT', `/api/event-contracts/${t.id}`, { body: 'CHANGED {{client_name}}' })
    expect((await k.pub('GET', link(tok))).json.contract.text).toBe(before)
    await k.O('PUT', `/api/event-contracts/${t.id}`, { body: t.body })
  })

  test('a single-signer proposal with no template works as it always did: one signature books it', async () => {
    const ev = await k.O('POST', '/api/events', { name: 'Plain Party', eventDate: later(170), status: 'tentative', guestCount: 10, contactId: clientId })
    const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.json.id, contractTemplateId: null })).json
    expect(p.contractBody).toBeNull()
    const tok = tokenOf((await k.O('POST', `/api/event-proposals/${p.id}/send`)).json.path)
    const done = await sign(tok, 'Harper Diaz')
    expect(done.json.status).toBe('accepted'); expect(done.json.contract).toBeNull(); expect(done.json.signers).toHaveLength(1)
    expect((await k.O('GET', `/api/events/${ev.json.id}`)).json.event.status).toBe('confirmed')
  })

  test('a taken room refuses the last signature but keeps the ones already given; any signer can decline for everyone', async () => {
    const mk = async (name: string, date: string) => {
      const ev = (await k.O('POST', '/api/events', { name, eventDate: date, status: 'enquiry', guestCount: 10, spaceId: roomId, contactId: clientId, startTime: '12:00', endTime: '15:00' })).json
      const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.id, signers: [{ role: 'client' }, { role: 'venue' }] })).json
      const staff = (await k.O('POST', `/api/event-proposals/${p.id}/send`)).json
      return { ev, p, toks: staff.signers.map((s: any) => tokenOf(s.path)) as string[] }
    }
    const a = await mk('Race', later(180))
    expect((await sign(a.toks[0], 'Harper Diaz')).status).toBe(200)
    expect((await k.O('POST', '/api/events', { name: 'Rival', eventDate: later(180), status: 'confirmed', spaceId: roomId, startTime: '13:00', endTime: '16:00' })).status).toBe(201)
    const refused = await sign(a.toks[1], 'Pat Manager')
    expect(refused.status).toBe(409); expect(refused.json.code).toBe('space_held')
    const staff = (await k.O('GET', `/api/event-proposals/${a.p.id}`)).json
    expect(staff.status).toBe('partly_signed'); expect(staff.signers.map((s: any) => s.status)).toEqual(['signed', 'sent'])
    expect((await k.O('GET', `/api/events/${a.ev.id}`)).json.event.status).toBe('enquiry')
    // The venue declines: the whole proposal is declined, the first signature stays on record.
    expect((await k.pub('POST', link(a.toks[1], '/decline'), { reason: 'Room taken' })).json.status).toBe('declined')
    expect((await sign(a.toks[0], 'Harper Diaz')).status).toBe(409)
  })
})
