import { Hono } from 'hono'
import { eq, and, desc, asc, count, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { communicationLog, users, messageThreads, messageThreadParticipants, messages } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Communication Log
app.get('/log', async (c) => {
  const { entityType, entityId, page = '1', limit = '30' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const conditions: any[] = []
  if (entityType) conditions.push(eq(communicationLog.entityType, entityType))
  if (entityId) conditions.push(eq(communicationLog.entityId, entityId))

  const where = conditions.length > 0 ? and(...conditions) : undefined

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
      loggedByFirstName: users.firstName,
      loggedByLastName: users.lastName,
    })
      .from(communicationLog)
      .leftJoin(users, eq(communicationLog.loggedById, users.id))
      .where(where)
      .orderBy(desc(communicationLog.isPinned), desc(communicationLog.createdAt))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(communicationLog).where(where),
  ])

  const formatted = logs.map(({ loggedByFirstName, loggedByLastName, ...rest }) => ({
    ...rest,
    loggedBy: loggedByFirstName ? { firstName: loggedByFirstName, lastName: loggedByLastName } : null,
  }))

  return c.json({ logs: formatted, total })
})

app.post('/log', async (c) => {
  const body = await c.req.json()
  const user = c.get('user') as any
  const [log] = await db.insert(communicationLog).values({
    ...body,
    loggedById: user.userId,
    loggedByName: `${user.firstName} ${user.lastName}`,
  }).returning()
  return c.json(log, 201)
})

app.patch('/log/:id/pin', async (c) => {
  const id = c.req.param('id')
  const [log] = await db.select().from(communicationLog).where(eq(communicationLog.id, id)).limit(1)
  if (!log) return c.json({ error: 'Message not found' }, 404)
  const [updated] = await db.update(communicationLog).set({ isPinned: !log.isPinned, updatedAt: new Date() }).where(eq(communicationLog.id, id)).returning()
  return c.json(updated)
})

app.patch('/log/:id/follow-up', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(communicationLog).set({ followUpDone: true, updatedAt: new Date() }).where(eq(communicationLog.id, id)).returning()
  return c.json(updated)
})

// Message Board - Threads
app.get('/threads', async (c) => {
  const user = c.get('user') as any

  // Get thread IDs the user participates in
  const participantRows = await db.select({ threadId: messageThreadParticipants.threadId })
    .from(messageThreadParticipants)
    .where(eq(messageThreadParticipants.userId, user.userId))

  const threadIds = participantRows.map(r => r.threadId)
  if (threadIds.length === 0) return c.json([])

  // Get threads
  const threadRows = await db.select()
    .from(messageThreads)
    .where(
      threadIds.length === 1
        ? eq(messageThreads.id, threadIds[0])
        : sql`${messageThreads.id} IN (${sql.join(threadIds.map(id => sql`${id}`), sql`, `)})`
    )
    .orderBy(desc(messageThreads.updatedAt))

  // For each thread, get participants with user info, latest message, and message count
  const results = await Promise.all(threadRows.map(async (thread) => {
    const [participants, latestMessages, [{ value: messageCount }]] = await Promise.all([
      db.select({
        id: messageThreadParticipants.id,
        threadId: messageThreadParticipants.threadId,
        userId: messageThreadParticipants.userId,
        lastReadAt: messageThreadParticipants.lastReadAt,
        joinedAt: messageThreadParticipants.joinedAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
        .from(messageThreadParticipants)
        .leftJoin(users, eq(messageThreadParticipants.userId, users.id))
        .where(eq(messageThreadParticipants.threadId, thread.id)),
      db.select()
        .from(messages)
        .where(eq(messages.threadId, thread.id))
        .orderBy(desc(messages.createdAt))
        .limit(1),
      db.select({ value: count() }).from(messages).where(eq(messages.threadId, thread.id)),
    ])

    return {
      ...thread,
      participants: participants.map(({ userFirstName, userLastName, ...p }) => ({
        ...p,
        user: { firstName: userFirstName, lastName: userLastName },
      })),
      messages: latestMessages,
      _count: { messages: messageCount },
    }
  }))

  return c.json(results)
})

app.post('/threads', async (c) => {
  const user = c.get('user') as any
  const { subject, threadType, isBroadcast, participantIds } = await c.req.json()
  const allIds = [...new Set([user.userId, ...(participantIds || [])])]

  const [thread] = await db.insert(messageThreads).values({
    subject,
    threadType,
    isBroadcast,
    createdById: user.userId,
  }).returning()

  // Create participants
  await db.insert(messageThreadParticipants).values(
    allIds.map(id => ({ threadId: thread.id, userId: id }))
  )

  const participants = await db.select()
    .from(messageThreadParticipants)
    .where(eq(messageThreadParticipants.threadId, thread.id))

  return c.json({ ...thread, participants }, 201)
})

// Messages in thread
app.get('/threads/:id/messages', async (c) => {
  const threadId = c.req.param('id')
  const user = c.get('user') as any

  const messageRows = await db.select({
    id: messages.id,
    threadId: messages.threadId,
    senderId: messages.senderId,
    body: messages.body,
    isDeleted: messages.isDeleted,
    createdAt: messages.createdAt,
    updatedAt: messages.updatedAt,
    senderFirstName: users.firstName,
    senderLastName: users.lastName,
    senderRole: users.role,
  })
    .from(messages)
    .leftJoin(users, eq(messages.senderId, users.id))
    .where(and(eq(messages.threadId, threadId), eq(messages.isDeleted, false)))
    .orderBy(asc(messages.createdAt))

  // Mark as read
  await db.update(messageThreadParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(messageThreadParticipants.threadId, threadId), eq(messageThreadParticipants.userId, user.userId)))

  const formatted = messageRows.map(({ senderFirstName, senderLastName, senderRole, ...rest }) => ({
    ...rest,
    sender: { firstName: senderFirstName, lastName: senderLastName, role: senderRole },
  }))

  return c.json(formatted)
})

app.post('/threads/:id/messages', async (c) => {
  const threadId = c.req.param('id')
  const user = c.get('user') as any
  const { body } = await c.req.json()

  const [message] = await db.insert(messages).values({
    threadId,
    senderId: user.userId,
    body,
  }).returning()

  // Get sender info
  const [sender] = await db.select({ firstName: users.firstName, lastName: users.lastName })
    .from(users).where(eq(users.id, user.userId)).limit(1)

  await db.update(messageThreads).set({ updatedAt: new Date() }).where(eq(messageThreads.id, threadId))

  return c.json({ ...message, sender }, 201)
})

export default app
