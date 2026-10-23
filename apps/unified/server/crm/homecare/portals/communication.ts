// Home care's office communication: the communication log (notes of calls and emails with clients, families and
// caregivers) and the office's message board. Moved from
// templates/crm-homecare/backend/src/routes/{communication,communicationLog}.ts — two routers, mounted at
// /api/communication and /api/communication-log.
//
// Both were office-only (requireAdmin on every path — no caregiver screen calls them; caregivers message through
// /api/messages). Permissions, not rank: reading is care-portal:update (a caregiver holds only care-portal:read),
// writing care-portal:create / :update / :delete.
//
// Changes from the template:
//   · scoped to the company: every read, write and thread; a thread's participants must be the company's people;
//   · POST /api/communication/log spread the request body into the row (any column, the id and the author included);
//     it now writes the same named fields as POST /api/communication-log, the author from the session (fixed);
//   · a board message is posted only into a thread the person takes part in (or by the office) — the template posted
//     into any thread id, and listed any thread's messages (fixed: the same rule as /api/messages);
//   · the author's name is looked up (the app's sign-in carries no name; the template wrote "undefined undefined");
//   · replies through server/http/reply.ts: GET /log is { data, pagination } (was { logs, total }), the threads, a
//     thread's messages, follow-ups and an entity's log are lists.
import { Hono, type Context } from 'hono'
import { and, asc, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { createActorName } from '@twomiah/tenant-backend'
import { communicationLog, messageThreads, messageThreadParticipants, messages, user } from '../../../db/schema/index.ts'
import { fail, list, one, done, listAll } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

const all = <T,>(c: Context, rows: T[]) => listAll(c, rows)
const blankToNull = (v: unknown) => (v === undefined || v === null || v === '' ? null : v)

/** A log entry's fields from a request body: only these, blank optional fields as null (C-06: "" into a date 500'd). */
function logFields(b: any) {
  return {
    logType: typeof b?.logType === 'string' && b.logType ? b.logType : 'note',
    direction: (blankToNull(b?.direction) as string | null),
    subject: (blankToNull(b?.subject) as string | null),
    body: String(b?.body ?? ''),
    clientId: (blankToNull(b?.clientId) as string | null),
    followUpDate: (blankToNull(b?.followUpDate) as string | null),
    followUpDone: b?.followUpDone === true,
    isPinned: b?.isPinned === true,
  }
}

export function createCommunicationRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const actorName = createActorName({ db, tables: { user } })

  // ── Communication log ──

  // GET /log?entityType&entityId&page&limit — pinned first, newest first.
  app.get('/log', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const { entityType, entityId } = c.req.query()
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    const limit = Math.max(parseInt(c.req.query('limit') || '30') || 30, 1)
    const conditions: any[] = [eq(communicationLog.companyId, me.companyId)]
    if (entityType) conditions.push(eq(communicationLog.entityType, entityType))
    if (entityId) conditions.push(eq(communicationLog.entityId, entityId))
    const where = and(...conditions)
    const [logs, [{ value: total }]] = await Promise.all([
      db.select({
        id: communicationLog.id,
        entityType: communicationLog.entityType,
        entityId: communicationLog.entityId,
        logType: communicationLog.logType,
        direction: communicationLog.direction,
        subject: communicationLog.subject,
        body: communicationLog.body,
        loggedById: communicationLog.loggedById,
        loggedByName: communicationLog.loggedByName,
        clientId: communicationLog.clientId,
        followUpDate: communicationLog.followUpDate,
        followUpDone: communicationLog.followUpDone,
        isPinned: communicationLog.isPinned,
        createdAt: communicationLog.createdAt,
        updatedAt: communicationLog.updatedAt,
        loggedByFirstName: user.firstName,
        loggedByLastName: user.lastName,
      }).from(communicationLog)
        .leftJoin(user, eq(communicationLog.loggedById, user.id))
        .where(where)
        .orderBy(desc(communicationLog.isPinned), desc(communicationLog.createdAt))
        .offset((page - 1) * limit)
        .limit(limit),
      db.select({ value: count() }).from(communicationLog).where(where),
    ])
    const formatted = logs.map(({ loggedByFirstName, loggedByLastName, ...rest }: any) => ({
      ...rest,
      loggedBy: loggedByFirstName ? { firstName: loggedByFirstName, lastName: loggedByLastName } : null,
    }))
    return list(c, formatted, { page, limit, total: Number(total) })
  })

  app.post('/log', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    if (!b?.entityType || !b?.entityId || !b?.body) return fail(c, 400, 'entityType, entityId, and body are required')
    const [log] = await db.insert(communicationLog).values({
      companyId: me.companyId,
      entityType: String(b.entityType),
      entityId: String(b.entityId),
      ...logFields(b),
      loggedById: me.userId,
      loggedByName: await actorName(me),
    }).returning()
    return one(c, log, 201)
  })

  app.patch('/log/:id/pin', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const [log] = await db.select().from(communicationLog).where(and(eq(communicationLog.id, id), eq(communicationLog.companyId, me.companyId))).limit(1)
    if (!log) return fail(c, 404, 'Message not found')
    const [updated] = await db.update(communicationLog).set({ isPinned: !log.isPinned, updatedAt: new Date() })
      .where(and(eq(communicationLog.id, id), eq(communicationLog.companyId, me.companyId))).returning()
    return one(c, updated)
  })

  app.patch('/log/:id/follow-up', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const [updated] = await db.update(communicationLog).set({ followUpDone: true, updatedAt: new Date() })
      .where(and(eq(communicationLog.id, c.req.param('id')), eq(communicationLog.companyId, me.companyId))).returning()
    // The template answered 200 with nothing for an unknown id.
    if (!updated) return fail(c, 404, 'Log entry not found')
    return one(c, updated)
  })

  // ── The message board: threads ──

  /** May this person read and post in this thread of their company? Its participants, and the office. */
  async function mayUseThread(me: AppEnv['Variables']['user'], threadId: string): Promise<boolean> {
    const [thread] = await db.select({ id: messageThreads.id }).from(messageThreads)
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.companyId, me.companyId))).limit(1)
    if (!thread) return false
    if (await actsForAnyone(d, me, 'care-portal:update')) return true
    const [p] = await db.select({ id: messageThreadParticipants.id }).from(messageThreadParticipants)
      .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.userId, me.userId))).limit(1)
    return !!p
  }

  app.get('/threads', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const participantRows = await db.select({ threadId: messageThreadParticipants.threadId }).from(messageThreadParticipants)
      .where(and(eq(messageThreadParticipants.userId, me.userId), eq(messageThreadParticipants.companyId, me.companyId)))
    const threadIds = participantRows.map((r: any) => r.threadId)
    if (threadIds.length === 0) return all(c, [])
    const threadRows = await db.select().from(messageThreads)
      .where(and(eq(messageThreads.companyId, me.companyId), inArray(messageThreads.id, threadIds)))
      .orderBy(desc(messageThreads.updatedAt))
    const results = await Promise.all(threadRows.map(async (thread: typeof messageThreads.$inferSelect) => {
      const [participants, latestMessages, [{ value: messageCount }]] = await Promise.all([
        db.select({
          id: messageThreadParticipants.id,
          threadId: messageThreadParticipants.threadId,
          userId: messageThreadParticipants.userId,
          lastReadAt: messageThreadParticipants.lastReadAt,
          joinedAt: messageThreadParticipants.joinedAt,
          userFirstName: user.firstName,
          userLastName: user.lastName,
        }).from(messageThreadParticipants)
          .leftJoin(user, eq(messageThreadParticipants.userId, user.id))
          .where(and(eq(messageThreadParticipants.threadId, thread.id), eq(messageThreadParticipants.companyId, me.companyId))),
        db.select().from(messages).where(and(eq(messages.threadId, thread.id), eq(messages.companyId, me.companyId))).orderBy(desc(messages.createdAt)).limit(1),
        db.select({ value: count() }).from(messages).where(and(eq(messages.threadId, thread.id), eq(messages.companyId, me.companyId))),
      ])
      return {
        ...thread,
        participants: participants.map(({ userFirstName, userLastName, ...p }: any) => ({ ...p, user: { firstName: userFirstName, lastName: userLastName } })),
        messages: latestMessages,
        _count: { messages: messageCount },
      }
    }))
    return all(c, results)
  })

  app.post('/threads', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { subject, threadType, isBroadcast, participantIds } = await c.req.json().catch(() => ({} as any))
    if (typeof subject !== 'string' || !subject.trim()) return fail(c, 400, 'Subject is required')
    const allIds = [...new Set([me.userId, ...(Array.isArray(participantIds) ? participantIds.map(String) : [])])]
    const known = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, me.companyId), inArray(user.id, allIds)))
    if (known.length !== allIds.length) return fail(c, 400, 'One or more participants were not found')
    const [thread] = await db.insert(messageThreads).values({
      companyId: me.companyId,
      subject: subject.trim(),
      threadType: typeof threadType === 'string' && threadType ? threadType : (allIds.length > 2 ? 'group' : 'direct'),
      isBroadcast: isBroadcast === true,
      createdById: me.userId,
    }).returning()
    await db.insert(messageThreadParticipants).values(allIds.map((id) => ({ companyId: me.companyId, threadId: thread.id, userId: id })))
    const participants = await db.select().from(messageThreadParticipants)
      .where(and(eq(messageThreadParticipants.threadId, thread.id), eq(messageThreadParticipants.companyId, me.companyId)))
    return one(c, { ...thread, participants }, 201)
  })

  // A thread's messages, oldest first; it is marked read for me.
  app.get('/threads/:id/messages', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const threadId = c.req.param('id')
    if (!(await mayUseThread(me, threadId))) return fail(c, 404, 'Thread not found')
    const messageRows = await db.select({
      id: messages.id,
      threadId: messages.threadId,
      senderId: messages.senderId,
      body: messages.body,
      isDeleted: messages.isDeleted,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
      senderFirstName: user.firstName,
      senderLastName: user.lastName,
      senderRole: user.role,
    }).from(messages)
      .leftJoin(user, eq(messages.senderId, user.id))
      .where(and(eq(messages.threadId, threadId), eq(messages.companyId, me.companyId), eq(messages.isDeleted, false)))
      .orderBy(asc(messages.createdAt))
    await db.update(messageThreadParticipants).set({ lastReadAt: new Date() })
      .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.userId, me.userId), eq(messageThreadParticipants.companyId, me.companyId)))
    return all(c, messageRows.map(({ senderFirstName, senderLastName, senderRole, ...rest }: any) => ({
      ...rest,
      sender: { firstName: senderFirstName, lastName: senderLastName, role: senderRole },
    })))
  })

  app.post('/threads/:id/messages', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const threadId = c.req.param('id')
    const { body } = await c.req.json().catch(() => ({} as any))
    if (typeof body !== 'string' || !body.trim()) return fail(c, 400, 'Message body is required')
    if (!(await mayUseThread(me, threadId))) return fail(c, 404, 'Thread not found')
    const [message] = await db.insert(messages).values({ companyId: me.companyId, threadId, senderId: me.userId, body: body.trim() }).returning()
    const [sender] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user)
      .where(and(eq(user.id, me.userId), eq(user.companyId, me.companyId))).limit(1)
    await db.update(messageThreads).set({ updatedAt: new Date() }).where(and(eq(messageThreads.id, threadId), eq(messageThreads.companyId, me.companyId)))
    return one(c, { ...message, sender }, 201)
  })

  return app
}

/** /api/communication-log: one entity's notes, the open follow-ups, and a note's edit and removal. */
export function createCommunicationLogRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const actorName = createActorName({ db, tables: { user } })

  // GET /follow-ups/pending — open follow-ups, soonest first.
  app.get('/follow-ups/pending', perm('care-portal:update'), async (c) => {
    const rows = await db.select().from(communicationLog)
      .where(and(eq(communicationLog.companyId, c.get('user').companyId), eq(communicationLog.followUpDone, false), isNotNull(communicationLog.followUpDate)))
      .orderBy(asc(communicationLog.followUpDate))
    return all(c, rows)
  })

  // GET /:entityType/:entityId
  app.get('/:entityType/:entityId', perm('care-portal:update'), async (c) => {
    const rows = await db.select().from(communicationLog)
      .where(and(
        eq(communicationLog.companyId, c.get('user').companyId),
        eq(communicationLog.entityType, c.req.param('entityType')),
        eq(communicationLog.entityId, c.req.param('entityId')),
      ))
      .orderBy(desc(communicationLog.createdAt))
    return all(c, rows)
  })

  // POST / — a note. Blank optional fields arrive as "" and are stored as null (C-06).
  app.post('/', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    if (!b?.entityType || !b?.entityId || !b?.body) return fail(c, 400, 'entityType, entityId, and body are required')
    const [row] = await db.insert(communicationLog).values({
      companyId: me.companyId,
      entityType: String(b.entityType),
      entityId: String(b.entityId),
      ...logFields(b),
      loggedById: me.userId,
      loggedByName: await actorName(me),
    }).returning()
    return one(c, row, 201)
  })

  // PUT /:id — the fields sent change; a field not sent stays as it is (the query builder leaves undefined out).
  app.put('/:id', perm('care-portal:update'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    const [row] = await db.update(communicationLog).set({
      logType: b.logType,
      direction: b.direction,
      subject: b.subject,
      body: b.body,
      clientId: b.clientId === '' ? null : b.clientId,
      followUpDate: b.followUpDate === '' ? null : b.followUpDate,
      followUpDone: b.followUpDone,
      isPinned: b.isPinned,
      updatedAt: new Date(),
    }).where(and(eq(communicationLog.id, c.req.param('id')), eq(communicationLog.companyId, me.companyId))).returning()
    if (!row) return fail(c, 404, 'Log entry not found')
    return one(c, row)
  })

  app.delete('/:id', perm('care-portal:delete'), async (c) => {
    const [row] = await db.delete(communicationLog)
      .where(and(eq(communicationLog.id, c.req.param('id')), eq(communicationLog.companyId, c.get('user').companyId))).returning()
    if (!row) return fail(c, 404, 'Log entry not found')
    return done(c)
  })

  return app
}
