import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { messageThreads, messageThreadParticipants, messages, users } from '../../db/schema.ts'
import { eq, and, desc, lt, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/messages/inbox — threads where current user is participant
app.get('/inbox', async (c) => {
  const user = c.get('user')

  const threads = await db
    .select({
      id: messageThreads.id,
      subject: messageThreads.subject,
      threadType: messageThreads.threadType,
      isBroadcast: messageThreads.isBroadcast,
      createdById: messageThreads.createdById,
      createdAt: messageThreads.createdAt,
      updatedAt: messageThreads.updatedAt,
      lastReadAt: messageThreadParticipants.lastReadAt,
      joinedAt: messageThreadParticipants.joinedAt,
    })
    .from(messageThreadParticipants)
    .innerJoin(messageThreads, eq(messageThreadParticipants.threadId, messageThreads.id))
    .where(eq(messageThreadParticipants.userId, user.userId))
    .orderBy(desc(messageThreads.updatedAt))

  // Get latest message preview + sender name for each thread
  const threadIds = threads.map((t) => t.id)
  if (threadIds.length === 0) return c.json([])

  const { inArray } = await import('drizzle-orm')
  const latestMessages = await db
    .select({
      threadId: messages.threadId,
      body: messages.body,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(and(inArray(messages.threadId, threadIds), eq(messages.isDeleted, false)))
    .orderBy(desc(messages.createdAt))

  // Build map of latest message per thread
  const latestMap: Record<string, any> = {}
  for (const msg of latestMessages) {
    if (!latestMap[msg.threadId]) {
      latestMap[msg.threadId] = msg
    }
  }

  const result = threads.map((t) => {
    const latest = latestMap[t.id]
    const unread = !t.lastReadAt || (t.updatedAt && t.lastReadAt < t.updatedAt)
    return {
      ...t,
      unread,
      latestMessage: latest
        ? {
            body: latest.body.substring(0, 100),
            senderName: `${latest.senderFirstName} ${latest.senderLastName}`,
            createdAt: latest.createdAt,
          }
        : null,
    }
  })

  return c.json(result)
})

// GET /api/messages/users — all active users for recipient picker
app.get('/users', async (c) => {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.lastName)

  return c.json(rows)
})

// GET /api/messages/unread-count
app.get('/unread-count', async (c) => {
  const user = c.get('user')

  const rows = await db
    .select({
      threadId: messageThreadParticipants.threadId,
      lastReadAt: messageThreadParticipants.lastReadAt,
      threadUpdatedAt: messageThreads.updatedAt,
    })
    .from(messageThreadParticipants)
    .innerJoin(messageThreads, eq(messageThreadParticipants.threadId, messageThreads.id))
    .where(eq(messageThreadParticipants.userId, user.userId))

  const count = rows.filter(
    (r) => !r.lastReadAt || (r.threadUpdatedAt && r.lastReadAt < r.threadUpdatedAt)
  ).length

  return c.json({ count })
})

// GET /api/messages/thread/:id — get all messages, mark as read
app.get('/thread/:id', async (c) => {
  const threadId = c.req.param('id')
  const user = c.get('user')

  const [thread] = await db
    .select()
    .from(messageThreads)
    .where(eq(messageThreads.id, threadId))
    .limit(1)

  if (!thread) return c.json({ error: 'Thread not found' }, 404)

  const threadMessages = await db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      senderId: messages.senderId,
      body: messages.body,
      isDeleted: messages.isDeleted,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt)

  const participants = await db
    .select({
      userId: messageThreadParticipants.userId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(messageThreadParticipants)
    .innerJoin(users, eq(messageThreadParticipants.userId, users.id))
    .where(eq(messageThreadParticipants.threadId, threadId))

  // Mark as read
  await db
    .update(messageThreadParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(messageThreadParticipants.threadId, threadId),
        eq(messageThreadParticipants.userId, user.userId)
      )
    )

  const formatted = threadMessages.map(({ senderFirstName, senderLastName, ...msg }) => ({
    ...msg,
    senderName: `${senderFirstName} ${senderLastName}`,
  }))

  return c.json({ thread, messages: formatted, participants })
})

// POST /api/messages/thread/:id/reply
app.post('/thread/:id/reply', async (c) => {
  const threadId = c.req.param('id')
  const user = c.get('user')
  const { body } = await c.req.json()

  if (!body?.trim()) return c.json({ error: 'Message body is required' }, 400)

  const [msg] = await db
    .insert(messages)
    .values({
      threadId,
      senderId: user.userId,
      body: body.trim(),
    })
    .returning()

  // Update thread updatedAt
  await db
    .update(messageThreads)
    .set({ updatedAt: new Date() })
    .where(eq(messageThreads.id, threadId))

  return c.json(msg, 201)
})

// POST /api/messages/send — create new thread + first message + participants
app.post('/send', async (c) => {
  const user = c.get('user')
  const { subject, body, recipientIds, isBroadcast } = await c.req.json()

  if (!subject?.trim()) return c.json({ error: 'Subject is required' }, 400)
  if (!body?.trim()) return c.json({ error: 'Message body is required' }, 400)
  if (!recipientIds?.length) return c.json({ error: 'At least one recipient is required' }, 400)

  // Create thread
  const [thread] = await db
    .insert(messageThreads)
    .values({
      subject: subject.trim(),
      createdById: user.userId,
      threadType: recipientIds.length > 1 ? 'group' : 'direct',
      isBroadcast: isBroadcast || false,
    })
    .returning()

  // Create first message
  const [msg] = await db
    .insert(messages)
    .values({
      threadId: thread.id,
      senderId: user.userId,
      body: body.trim(),
    })
    .returning()

  // Add all participants (including sender)
  const allParticipantIds = [...new Set([user.userId, ...recipientIds])]
  await db.insert(messageThreadParticipants).values(
    allParticipantIds.map((userId: string) => ({
      threadId: thread.id,
      userId,
      lastReadAt: userId === user.userId ? new Date() : null,
    }))
  )

  return c.json({ thread, message: msg }, 201)
})

export default app
