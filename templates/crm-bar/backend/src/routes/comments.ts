import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import comments from '../services/comments.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * EVERY ROUTE HERE ASKS THE QUESTION ITS RECORD ASKS. (comments POST was open to every seat)
 *
 * This router had no permission check on any route: a viewer could post, edit and react, and any seat could read
 * the comments and activity on any record — and the company-wide activity feed — whatever that seat may see of the
 * record itself. A comment is ON a record, so it follows the record:
 *
 *   read a record's comments or activity     <resource>:read     (job → jobs:read, change-order → change-orders:read)
 *   post, edit, react on one                  <resource>:update   — a read-only seat reads, it does not write
 *   delete someone else's comment             company:update      (owner / admin; was the role NAMES 'admin','owner')
 *   the company-wide feed, one person's trail audit:read         — the history of who did what, owner / admin (T61)
 *
 * An entity type that is not a resource name in the permission matrix is held by nobody but the owner ('*'), so it
 * fails closed. The service's own checks (company scope, author-only edit) stay underneath.
 */
const ENTITY = /^[a-z][a-z-]{1,40}$/
const resourceOf = (entityType: string) => (entityType.endsWith('s') ? entityType : entityType + 's')
const may = async (c: any, permission: string) => {
  const user = c.get('user') as any
  return hasPermission(user.role, permission, await getExtraPermissions(user.userId))
}
const refuse = (c: any, permission: string) => c.json({ error: `You do not have permission to do that (${permission}).` }, 403)

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
  if (!(await may(c, 'audit:read'))) return refuse(c, 'audit:read')
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
  if (!ENTITY.test(entityType)) return c.json({ error: 'Unknown record type' }, 400)
  const permission = `${resourceOf(entityType)}:read`
  if (!(await may(c, permission))) return refuse(c, permission)
  const result = await comments.getComments(user.companyId, entityType, entityId)
  return c.json(result)
})

// A route that names only the comment asks the question of the record the comment is on.
const recordOf = async (c: any) => {
  const user = c.get('user') as any
  return comments.getCommentEntity(c.req.param('commentId'), user.companyId)
}

/**
 * ABOVE POST /:entityType/:entityId, and it has to stay there. (the T38 fault, a third time)
 *
 * `/<commentId>/react` is two segments — exactly what `/:entityType/:entityId` matches. Registered after it, this
 * route was never reached: a reaction was stored as a COMMENT, on a record of type <commentId> with id "react".
 */
app.post('/:commentId/react', async (c) => {
  const user = c.get('user') as any
  const commentId = c.req.param('commentId')
  // toggleReaction has no company scope of its own: the comment must be this company's first.
  const rec = await recordOf(c)
  if (!rec) return c.json({ error: 'Comment not found' }, 404)
  const permission = `${resourceOf(rec.entityType)}:update`
  if (!(await may(c, permission))) return refuse(c, permission)
  const { reaction = 'like' } = await c.req.json()
  const result = await comments.toggleReaction(
    commentId,
    user.userId,
    reaction
  )
  return c.json(result)
})

app.post('/:entityType/:entityId', async (c) => {
  const user = c.get('user') as any
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  if (!ENTITY.test(entityType)) return c.json({ error: 'Unknown record type' }, 400)
  const permission = `${resourceOf(entityType)}:update`
  if (!(await may(c, permission))) return refuse(c, permission)
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
  const rec = await recordOf(c)
  if (!rec) return c.json({ error: 'Comment not found' }, 404)
  const permission = `${resourceOf(rec.entityType)}:update`
  if (!(await may(c, permission))) return refuse(c, permission)
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
  const rec = await recordOf(c)
  if (!rec) return c.json({ error: 'Comment not found' }, 404)
  // Removing your own comment is part of writing on the record; removing anyone's is moderating the company's.
  const moderator = await may(c, 'company:update')
  const permission = `${resourceOf(rec.entityType)}:update`
  if (!moderator && !(await may(c, permission))) return refuse(c, permission)
  await comments.deleteComment(
    commentId,
    user.companyId,
    user.userId,
    moderator
  )
  return c.body(null, 204)
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
  if (!(await may(c, 'audit:read'))) return refuse(c, 'audit:read')
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
  if (!ENTITY.test(entityType)) return c.json({ error: 'Unknown record type' }, 400)
  const permission = `${resourceOf(entityType)}:read`
  if (!(await may(c, permission))) return refuse(c, permission)
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
