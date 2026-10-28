// "Text opened on your phone — not confirmed sent": the record of the Text button (packages/tenant-ui/src/text/TextButton.tsx).
// The button opens the user's OWN texting app (or shows a QR code for their phone); Twomiah never sees whether the text was
// sent, so the row says what is known — it was opened — and nothing more. A QR shown on a computer counts as opened too.
//
//   POST /api/text-activity/contact/:id   a text was opened to this contact   (asks contacts:read — the permission to read it)
//   POST /api/text-activity/lead/:id      …to this lead                       (asks leads:read — the Lead Inbox's own)
//   GET  /api/text-activity/contact/:id   the contact's activity rows, newest first (contacts:read, as the contact itself)
//
// Same permission as reading the record, on the server: the button hides itself from a seat without it (packages/tenant-ui),
// and this refuses it regardless (tests/text-activity.test.ts). The row is the table `activity` (db/schema/crm.ts) —
// entityType contact|lead, action 'text_started', the chosen message in metadata.
//
// What is kept of the message: which one (id and label) — NOT its words. An invoice or quote message carries the document's
// private /d/<token> link, which the quote routes deliberately keep from seats that do not administer quotes; the activity
// card is read by everyone who reads the contact.
import { Hono } from 'hono'
import { z } from 'zod'
import { ownContactScope } from '@twomiah/tenant-backend'
import { and, desc, eq } from 'drizzle-orm'
import { activity, contact, lead, user } from '../db/schema/index.ts'
import type { AppEnv } from '../http/env.ts'
import { fail, one, listAll } from '../http/reply.ts'

export const TEXT_STARTED = 'text_started'
/** The words the activity card shows for it, exactly (the owner's wording, 2026-10-28). */
export const TEXT_STARTED_LABEL = 'Text opened on your phone — not confirmed sent'

const bodySchema = z.object({
  /** textMessages.ts ids. */
  message: z.enum(['blank', 'invoice', 'quote', 'ready']),
  label: z.string().trim().min(1).max(120),
})
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()

export function createTextActivityRoutes(d: { db: any; requirePermission: (p: string) => any; canSee?: (role: string, permission: string, userId?: string) => Promise<boolean>; ownContacts?: (userId: string) => any }) {
  const { db, requirePermission } = d
  /**
   * A contact is read by the people the contact's own door lets in: contacts:read, and — for a seat without contacts:read-all
   * (a field seat) — only the customers on its own jobs. The same scope function the contact routes use; a contact outside it
   * is "not found", as it is there.
   */
  const contactVisible = async (me: any, id: string): Promise<boolean> => {
    const [exists] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, id), eq(contact.companyId, me.companyId))).limit(1)
    if (!exists) return false
    const scope = await ownContactScope(d, me)
    if (!scope) return true
    const [inScope] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, id), scope)).limit(1)
    return !!inScope
  }
  const app = new Hono<AppEnv>()

  const record = (entity: 'contact' | 'lead', table: any) => async (c: any) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const found = entity === 'contact'
      ? await contactVisible(me, id)
      : !!(await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.companyId, me.companyId))).limit(1))[0]
    if (!found) return fail(c, 404, entity === 'lead' ? 'Lead not found' : 'Contact not found')
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Say which message was chosen.')
    const [made] = await db.insert(activity).values({
      companyId: me.companyId, userId: me.userId, entityType: entity, entityId: id, action: TEXT_STARTED,
      description: TEXT_STARTED_LABEL, metadata: { message: parsed.data.message, label: stripTags(parsed.data.label) },
    }).returning()
    return one(c, { id: made.id, action: made.action, createdAt: made.createdAt }, 201)
  }
  app.post('/contact/:id', requirePermission('contacts:read'), record('contact', contact))
  app.post('/lead/:id', requirePermission('leads:read'), record('lead', lead))

  app.get('/contact/:id', requirePermission('contacts:read'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    if (!(await contactVisible(me, id))) return fail(c, 404, 'Contact not found')
    const rows = await db.select({
      id: activity.id, action: activity.action, description: activity.description, metadata: activity.metadata, createdAt: activity.createdAt,
      firstName: user.firstName, lastName: user.lastName,
    }).from(activity).leftJoin(user, eq(user.id, activity.userId))
      .where(and(eq(activity.companyId, me.companyId), eq(activity.entityType, 'contact'), eq(activity.entityId, id)))
      .orderBy(desc(activity.createdAt)).limit(100)
    return listAll(c, rows.map((r: any) => ({
      id: r.id, action: r.action, description: r.description, metadata: r.metadata, createdAt: r.createdAt,
      by: `${r.firstName || ''} ${r.lastName || ''}`.trim() || null,
    })))
  })
  return app
}
