// Home care's staff messages (/api/messages): threads between the office and caregivers. Moved from
// templates/crm-homecare/backend/src/routes/messages.ts.
//
// A thread is read and answered by its participants; the office may read and answer any. Everyone else gets the same
// 404 as a thread that does not exist.
//
// Changes from the template:
//   · permissions: every signed-in person used these (caregivers message the office from their phone), so every action
//     is care-portal:read — the area's permission a caregiver holds — with the template's narrowing kept: a thread is
//     its participants' (and whoever holds care-portal:update — core/caregiverAccess.ts actsForAnyone; the template drew
//     the line by role);
//   · scoped to the company: the inbox, the recipient picker (the company's own people), every thread and message; a
//     new thread's recipients must be the company's people (the template wrote any id it was sent);
//   · replies: the inbox and the picker are { data, pagination } lists (RULEBOOK §3).
import { Hono, type Context } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { messageThreads, messageThreadParticipants, messages, user } from '../../../db/schema/index.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

const all = <T,>(c: Context, rows: T[]) => listAll(c, rows)

export function createMessageRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const can = d.permissions.requirePermission('care-portal:read')

  async function mayUseThread(me: AppEnv['Variables']['user'], threadId: string): Promise<boolean> {
    const [thread] = await db.select({ id: messageThreads.id }).from(messageThreads)
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.companyId, me.companyId))).limit(1)
    if (!thread) return false
    if (await actsForAnyone(d, me, 'care-portal:update')) return true
    const [p] = await db.select({ id: messageThreadParticipants.id }).from(messageThreadParticipants)
      .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.userId, me.userId))).limit(1)
    return !!p
  }

  // GET /inbox — the threads I take part in, newest first, each with its latest message.
  app.get('/inbox', can, async (c) => {
    const me = c.get('user')
    const threads = await db.select({
      id: messageThreads.id,
      subject: messageThreads.subject,
      threadType: messageThreads.threadType,
      isBroadcast: messageThreads.isBroadcast,
      createdById: messageThreads.createdById,
      createdAt: messageThreads.createdAt,
      updatedAt: messageThreads.updatedAt,
      lastReadAt: messageThreadParticipants.lastReadAt,
      joinedAt: messageThreadParticipants.joinedAt,
    }).from(messageThreadParticipants)
      .innerJoin(messageThreads, eq(messageThreadParticipants.threadId, messageThreads.id))
      .where(and(eq(messageThreadParticipants.userId, me.userId), eq(messageThreads.companyId, me.companyId)))
      .orderBy(desc(messageThreads.updatedAt))
    if (threads.length === 0) return all(c, [])
    const latestMessages = await db.select({
      threadId: messages.threadId,
      body: messages.body,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      senderFirstName: user.firstName,
      senderLastName: user.lastName,
    }).from(messages)
      .innerJoin(user, eq(messages.senderId, user.id))
      .where(and(eq(messages.companyId, me.companyId), inArray(messages.threadId, threads.map((t: any) => t.id)), eq(messages.isDeleted, false)))
      .orderBy(desc(messages.createdAt))
    const latestMap: Record<string, any> = {}
    for (const msg of latestMessages) if (!latestMap[msg.threadId]) latestMap[msg.threadId] = msg
    return all(c, threads.map((t: any) => {
      const latest = latestMap[t.id]
      return {
        ...t,
        unread: !t.lastReadAt || (t.updatedAt && t.lastReadAt < t.updatedAt),
        latestMessage: latest ? { body: String(latest.body).substring(0, 100), senderName: `${latest.senderFirstName} ${latest.senderLastName}`, createdAt: latest.createdAt } : null,
      }
    }))
  })

  // GET /users — the company's active people, for the recipient picker.
  app.get('/users', can, async (c) => {
    const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role }).from(user)
      .where(and(eq(user.companyId, c.get('user').companyId), eq(user.isActive, true)))
      .orderBy(user.lastName)
    return all(c, rows)
  })

  // GET /unread-count — threads with something I have not read.
  app.get('/unread-count', can, async (c) => {
    const me = c.get('user')
    const rows = await db.select({
      threadId: messageThreadParticipants.threadId,
      lastReadAt: messageThreadParticipants.lastReadAt,
      threadUpdatedAt: messageThreads.updatedAt,
    }).from(messageThreadParticipants)
      .innerJoin(messageThreads, eq(messageThreadParticipants.threadId, messageThreads.id))
      .where(and(eq(messageThreadParticipants.userId, me.userId), eq(messageThreads.companyId, me.companyId)))
    return one(c, { count: rows.filter((r: any) => !r.lastReadAt || (r.threadUpdatedAt && r.lastReadAt < r.threadUpdatedAt)).length })
  })

  // GET /thread/:id — every message, and it is marked read for me.
  app.get('/thread/:id', can, async (c) => {
    const me = c.get('user')
    const threadId = c.req.param('id')
    if (!(await mayUseThread(me, threadId))) return fail(c, 404, 'Thread not found')
    const [thread] = await db.select().from(messageThreads).where(and(eq(messageThreads.id, threadId), eq(messageThreads.companyId, me.companyId))).limit(1)
    const threadMessages = await db.select({
      id: messages.id,
      threadId: messages.threadId,
      senderId: messages.senderId,
      body: messages.body,
      isDeleted: messages.isDeleted,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
      senderFirstName: user.firstName,
      senderLastName: user.lastName,
    }).from(messages)
      .innerJoin(user, eq(messages.senderId, user.id))
      .where(and(eq(messages.threadId, threadId), eq(messages.companyId, me.companyId)))
      .orderBy(messages.createdAt)
    const participants = await db.select({ userId: messageThreadParticipants.userId, firstName: user.firstName, lastName: user.lastName })
      .from(messageThreadParticipants)
      .innerJoin(user, eq(messageThreadParticipants.userId, user.id))
      .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.companyId, me.companyId)))
    await db.update(messageThreadParticipants).set({ lastReadAt: new Date() })
      .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.userId, me.userId), eq(messageThreadParticipants.companyId, me.companyId)))
    const formatted = threadMessages.map(({ senderFirstName, senderLastName, ...msg }: any) => ({ ...msg, senderName: `${senderFirstName} ${senderLastName}` }))
    return one(c, { thread, messages: formatted, participants })
  })

  // POST /thread/:id/reply
  app.post('/thread/:id/reply', can, async (c) => {
    const me = c.get('user')
    const threadId = c.req.param('id')
    const { body } = await c.req.json().catch(() => ({} as any))
    if (typeof body !== 'string' || !body.trim()) return fail(c, 400, 'Message body is required')
    if (!(await mayUseThread(me, threadId))) return fail(c, 404, 'Thread not found')
    const [msg] = await db.insert(messages).values({ companyId: me.companyId, threadId, senderId: me.userId, body: body.trim() }).returning()
    await db.update(messageThreads).set({ updatedAt: new Date() }).where(and(eq(messageThreads.id, threadId), eq(messageThreads.companyId, me.companyId)))
    return one(c, msg, 201)
  })

  // POST /send — a new thread, its first message and its participants (the sender included).
  app.post('/send', can, async (c) => {
    const me = c.get('user')
    const { subject, body, recipientIds, isBroadcast } = await c.req.json().catch(() => ({} as any))
    if (typeof subject !== 'string' || !subject.trim()) return fail(c, 400, 'Subject is required')
    if (typeof body !== 'string' || !body.trim()) return fail(c, 400, 'Message body is required')
    if (!Array.isArray(recipientIds) || !recipientIds.length) return fail(c, 400, 'At least one recipient is required')
    const wanted = [...new Set([me.userId, ...recipientIds.map(String)])]
    const known = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, me.companyId), inArray(user.id, wanted)))
    if (known.length !== wanted.length) return fail(c, 400, 'One or more recipients were not found')
    const [thread] = await db.insert(messageThreads).values({
      companyId: me.companyId,
      subject: subject.trim(),
      createdById: me.userId,
      threadType: recipientIds.length > 1 ? 'group' : 'direct',
      isBroadcast: isBroadcast === true,
    }).returning()
    const [msg] = await db.insert(messages).values({ companyId: me.companyId, threadId: thread.id, senderId: me.userId, body: body.trim() }).returning()
    await db.insert(messageThreadParticipants).values(wanted.map((userId) => ({
      companyId: me.companyId,
      threadId: thread.id,
      userId,
      lastReadAt: userId === me.userId ? new Date() : null,
    })))
    return one(c, { thread, message: msg }, 201)
  })

  return app
}
