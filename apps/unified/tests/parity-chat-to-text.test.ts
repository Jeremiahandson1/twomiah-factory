// Parity tier 3 (11/10, field service): website chat-to-text — the website's "Text us" box. Through the real server as field service:
//   · the website carries the box only where chat_to_text and texting are on; its script is served;
//   · a message is a lead in the Lead Inbox, and the customer is found by their number (or made);
//   · with the "text me" box ticked the consent is kept and the message is in the texting inbox as their text; unticked, nothing is
//     threaded there; a bot's hidden-box fill is thanked and dropped; switched off, refused.
import { test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const S = () => t.schema as any
const post = async (body: any, ip = '10.0.0.1') => { const r = await t.call('/api/chat-to-text', { method: 'POST', json: body, headers: { 'X-Forwarded-For': ip } }); return { status: r.status, body: await r.json() as any } }
const setFeatures = async (list: string[]) => { await t.db.update(S().company).set({ enabledFeatures: list } as any).where(eq(S().company.id, companyId)); t.services.features.forgetFeatures() }
const ON = ['contacts', 'jobs', 'lead_inbox', 'two_way_texting', 'chat_to_text', 'website']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(ON)
  await (t.db as any).insert(S().contact).values({ companyId, name: 'Hank Homeowner', type: 'client', phone: '(608) 555-0111' })
  // A website with a published page, where the box is drawn.
  await t.db.insert(S().website).values({ companyId } as any)
  await t.db.insert(S().page).values({ companyId, slug: 'about', title: 'About', isPublished: true, sections: [{ type: 'text', variant: 'plain', data: { title: 'About us', body: 'Furnaces since 1990.' } }] } as any)
}, 120_000)

test('the website carries the box only with the switch on; its script is served', async () => {
  expect((await t.call('/scripts/chat.js')).status).toBe(200)
  const on = await (await t.call('/about')).text()
  expect(on).toContain('/scripts/chat.js')
  await setFeatures(ON.filter((f) => f !== 'chat_to_text'))
  try { expect(await (await t.call('/about')).text()).not.toContain('/scripts/chat.js') } finally { await setFeatures(ON) }
})

test('ticked: a lead, the known customer, the consent kept, and the message in the texting inbox', async () => {
  const r = await post({ name: 'Hank', phone: '608-555-0111', message: 'My furnace is making a noise', smsConsent: true, page: '/services' })
  expect(r.status).toBe(200)
  const leads = await (t.db as any).select().from(S().lead).where(eq(S().lead.companyId, companyId))
  expect(leads.some((l: any) => l.sourcePlatform === 'website_chat')).toBe(true)
  const [hank] = await (t.db as any).select().from(S().contact).where(eq(S().contact.name, 'Hank Homeowner'))
  const [conv] = await (t.db as any).select().from(S().smsConversation).where(and(eq(S().smsConversation.companyId, companyId), eq(S().smsConversation.phoneNumber, '+16085550111')))
  expect(conv.contactId).toBe(hank.id)
  const msgs = await (t.db as any).select().from(S().smsMessage).where(eq(S().smsMessage.conversationId, conv.id))
  expect(msgs.map((m: any) => [m.direction, m.body])).toEqual([['inbound', '[From the website chat] My furnace is making a noise']])
  const consent = await (t.db as any).select().from(S().smsConsent).where(eq(S().smsConsent.companyId, companyId))
  expect(consent.length).toBe(1)
})

test('unticked: a lead and a new customer, nothing in the texting inbox; a bot is thanked and dropped', async () => {
  const r = await post({ name: 'Nora New', phone: '608-555-0199', message: 'Quote for an AC?' }, '10.0.0.2')
  expect(r.status).toBe(200)
  const [nora] = await (t.db as any).select().from(S().contact).where(eq(S().contact.name, 'Nora New'))
  expect(nora.source).toBe('website_chat')
  expect((await (t.db as any).select().from(S().smsConversation).where(eq(S().smsConversation.phoneNumber, '+16085550199'))).length).toBe(0)
  const before = (await (t.db as any).select().from(S().lead)).length
  expect((await post({ name: 'Bot', phone: '608-555-0177', message: 'spam', website: 'http://spam' }, '10.0.0.3')).status).toBe(200)
  expect((await (t.db as any).select().from(S().lead)).length).toBe(before)
})

test('a missing message or a bad number is refused in words; switched off, refused', async () => {
  expect((await post({ name: 'X', phone: '608-555-0123', message: '' }, '10.0.0.4')).body.error).toBe('Your message, please')
  expect((await post({ name: 'X', phone: '12', message: 'hi' }, '10.0.0.4')).status).toBe(400)
  await setFeatures(ON.filter((f) => f !== 'chat_to_text'))
  expect((await post({ name: 'X', phone: '608-555-0123', message: 'hi' }, '10.0.0.5')).status).toBe(404)
})
