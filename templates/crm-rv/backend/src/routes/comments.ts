import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import comments from '../services/comments.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// COMMENTS
// ============================================

/**
 * ABOVE /:entityType/:entityId, and it has to stay there. (T38)
 *
 * Hono matches in registration order, and `/activity/feed` is two segments — exactly what
 * `/:entityType/:entityId` matches. So this answered as a comment lookup for an entity of type
 * "activity" with id "feed": HTTP 200 and an empty array, for ever, with no error anywhere. A
 * permanently empty activity feed is harder to notice than a 404.
 */
app.get('/activity/feed', async (c) => {
  const user = c.get('user') as any
  const { limit = '50', page = '1', types } = c.req.query() as any
  const entityTypes = types ? types.split(',') : null

  const result = await comments.getActivityFeed(user.companyId, {
    limit: parseInt(limit),
    page: parseInt(page),
    entityTypes,
  })

  return c.json(result)
})

app.get('/:entityType/:entityId', async (c) => {
  const user = c.get('user') as any
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  const result = await comments.getComments(user.companyId, entityType, entityId)
  return c.json(result)
})

app.post('/:entityType/:entityId', async (c) => {
  const user = c.get('user') as any
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  const { content, mentions, attachments, parentId } = await c.req.json()

  if (!content?.trim()) {
    return c.json({ error: 'Content is required' }, 400)
  }

  const comment = await comments.addComment({
    companyId: user.companyId,
    userId: user.userId,
    entityType,
    entityId,
    content: content.trim(),
    mentions: mentions || [],
    attachments: attachments || [],
    parentId,
  })

  return c.json(comment, 201)
})

app.put('/:commentId', async (c) => {
  const user = c.get('user') as any
  const commentId = c.req.param('commentId')
  const { content } = await c.req.json()

  if (!content?.trim()) {
    return c.json({ error: 'Content is required' }, 400)
  }

  const comment = await comments.updateComment(
    commentId,
    user.companyId,
    user.userId,
    content.trim()
  )

  return c.json(comment)
})

app.delete('/:commentId', async (c) => {
  const user = c.get('user') as any
  const commentId = c.req.param('commentId')
  const isAdmin = ['admin', 'owner'].includes(user.role)
  await comments.deleteComment(
    commentId,
    user.companyId,
    user.userId,
    isAdmin
  )
  return c.body(null, 204)
})

app.post('/:commentId/react', async (c) => {
  const user = c.get('user') as any
  const commentId = c.req.param('commentId')
  const { reaction = 'like' } = await c.req.json()
  const result = await comments.toggleReaction(
    commentId,
    user.userId,
    reaction
  )
  return c.json(result)
})

// ============================================
// ACTIVITY
// ============================================

/**
 * ABOVE /activity/:entityType/:entityId. (T38)
 *
 * Three segments against three: this was being answered as an activity lookup for entity type
 * "user". The id in the path made it look specific enough to be safe, and it was not.
 */
app.get('/activity/user/:userId', async (c) => {
  const user = c.get('user') as any
  const userId = c.req.param('userId')
  const limit = c.req.query('limit') || '50'
  const activities = await comments.getUserActivity(
    userId,
    user.companyId,
    { limit: parseInt(limit) }
  )
  return c.json(activities)
})

app.get('/activity/:entityType/:entityId', async (c) => {
  const user = c.get('user') as any
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  const limit = c.req.query('limit') || '50'

  const activities = await comments.getEntityActivity(
    user.companyId,
    entityType,
    entityId,
    { limit: parseInt(limit) }
  )

  return c.json(activities)
})

export default app
