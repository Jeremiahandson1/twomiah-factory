// The database side of the website's chat-to-text (crm/comms/chatToText.ts): the customer found by the last ten digits of their
// number (as the texting inbox matches a texter), or made; and the visitor's message threaded into the texting inbox as their text.
import { and, eq, or, sql } from 'drizzle-orm'
import { contact, smsConversation, smsMessage } from '../db/schema/index.ts'

export async function contactForPhone(db: any, companyId: string, phone: string, name: string): Promise<string> {
  const last10 = phone.replace(/\D/g, '').slice(-10)
  const digits = (col: any) => sql`right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), 10)`
  const [found] = await db.select({ id: contact.id }).from(contact)
    .where(and(eq(contact.companyId, companyId), or(sql`${digits(contact.mobile)} = ${last10}`, sql`${digits(contact.phone)} = ${last10}`))).limit(1)
  if (found) return found.id
  const [made] = await db.insert(contact).values({ companyId, name, mobile: phone, type: 'lead', source: 'website_chat' } as any).returning({ id: contact.id })
  return made.id
}

export async function threadWebsiteMessage(db: any, companyId: string, phone: string, contactId: string, text: string): Promise<void> {
  let [conv] = await db.select().from(smsConversation).where(and(eq(smsConversation.companyId, companyId), eq(smsConversation.phoneNumber, phone))).limit(1)
  if (!conv) [conv] = await db.insert(smsConversation).values({ companyId, phoneNumber: phone, contactId, status: 'active' } as any).returning()
  await db.insert(smsMessage).values({ conversationId: conv.id, direction: 'inbound', body: text, status: 'received' } as any)
  await db.update(smsConversation).set({ lastMessageAt: new Date(), unreadCount: sql`${smsConversation.unreadCount} + 1`, status: 'active', contactId: conv.contactId || contactId } as any).where(eq(smsConversation.id, conv.id))
}
