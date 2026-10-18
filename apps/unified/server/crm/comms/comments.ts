// /api/comments — comments, reactions and the activity log on any record. Moved from templates/crm/backend/src/
// routes/comments.ts and services/comments.ts; its raw SQL is in server/data/comments.ts.
//
// EVERY ROUTE ASKS THE QUESTION ITS RECORD ASKS. A comment is ON a record, so it follows the record:
//   read a record's comments or activity     <resource>:read     (job → jobs:read, change-order → change-orders:read)
//   post, edit, react on one                  <resource>:update
//   delete someone else's comment             company:update      (owner / admin)
//   the company-wide feed, one person's trail audit:read
// An entity type that is not a resource name in the permission matrix is held by nobody but the owner ('*'), so it
// fails closed. Company scope and author-only edit stay underneath.
//
// Route order matters (Hono matches in registration order): /activity/feed and /:commentId/react sit above
// /:entityType/:entityId, and /activity/user/:userId above /activity/:entityType/:entityId, or each is swallowed.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import * as q from '../../data/comments.ts'
import type { CrmDeps } from '../deps.ts'

const ENTITY = /^[a-z][a-z-]{1,40}$/
const resourceOf = (entityType: string) => (entityType.endsWith('s') ? entityType : entityType + 's')

export function createCommentsRoutes(d: CrmDeps) {
  const { db } = d
  const { hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, permission: string) => {
    const user = c.get('user')
    return hasPermission(user.role, permission, await getExtraPermissions(user.userId))
  }
  const refuse = (c: any, permission: string) => fail(c, 403, `You do not have permission to do that (${permission}).`)
  /** The record the comment named in the path is on, if it is this company's. */
  const recordOf = (c: any) => q.commentEntity(db, c.req.param('commentId'), c.get('user').companyId)

  app.get('/activity/feed', async (c) => {
    if (!(await may(c, 'audit:read'))) return refuse(c, 'audit:read')
    const user = c.get('user')
    const { limit = '50', page = '1', types } = c.req.query() as any
    const r = await q.activityFeed(db, user.companyId, {
      limit: parseInt(limit),
      page: parseInt(page),
      entityTypes: types ? types.split(',') : null,
    })
    return list(c, r.activities, { page: r.page, limit: r.limit, total: r.total })
  })

  app.get('/:entityType/:entityId', async (c) => {
    const user = c.get('user')
    const entityType = c.req.param('entityType')
    if (!ENTITY.test(entityType)) return fail(c, 400, 'Unknown record type')
    const permission = `${resourceOf(entityType)}:read`
    if (!(await may(c, permission))) return refuse(c, permission)
    const rows = await q.listComments(db, user.companyId, entityType, c.req.param('entityId'))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.post('/:commentId/react', async (c) => {
    const user = c.get('user')
    // The reaction has no company scope of its own: the comment must be this company's first.
    const rec = await recordOf(c)
    if (!rec) return fail(c, 404, 'Comment not found')
    const permission = `${resourceOf(rec.entityType)}:update`
    if (!(await may(c, permission))) return refuse(c, permission)
    const { reaction = 'like' } = await c.req.json()
    return one(c, await q.toggleReaction(db, c.req.param('commentId'), user.userId, reaction))
  })

  app.post('/:entityType/:entityId', async (c) => {
    const user = c.get('user')
    const entityType = c.req.param('entityType')
    if (!ENTITY.test(entityType)) return fail(c, 400, 'Unknown record type')
    const permission = `${resourceOf(entityType)}:update`
    if (!(await may(c, permission))) return refuse(c, permission)
    const { content, mentions, attachments, parentId } = await c.req.json()
    if (!content?.trim()) return fail(c, 400, 'Content is required')
    const comment = await q.insertComment(db, {
      companyId: user.companyId,
      userId: user.userId,
      entityType,
      entityId: c.req.param('entityId'),
      content: content.trim(),
      mentions: mentions || [],
      attachments: attachments || [],
      parentId: parentId ?? null,
    })
    return one(c, comment, 201)
  })

  app.put('/:commentId', async (c) => {
    const user = c.get('user')
    const commentId = c.req.param('commentId')
    const rec = await recordOf(c)
    if (!rec) return fail(c, 404, 'Comment not found')
    const permission = `${resourceOf(rec.entityType)}:update`
    if (!(await may(c, permission))) return refuse(c, permission)
    const { content } = await c.req.json()
    if (!content?.trim()) return fail(c, 400, 'Content is required')
    // Only the author edits a comment.
    if (!(await q.isOwnComment(db, commentId, user.companyId, user.userId))) return fail(c, 404, 'Comment not found or not authorized')
    return one(c, await q.setCommentContent(db, commentId, user.userId, content.trim()))
  })

  app.delete('/:commentId', async (c) => {
    const user = c.get('user')
    const commentId = c.req.param('commentId')
    const rec = await recordOf(c)
    if (!rec) return fail(c, 404, 'Comment not found')
    // Removing your own comment is part of writing on the record; removing anyone's is moderating the company's.
    const moderator = await may(c, 'company:update')
    const permission = `${resourceOf(rec.entityType)}:update`
    if (!moderator && !(await may(c, permission))) return refuse(c, permission)
    const allowed = moderator
      ? await q.isCompanyComment(db, commentId, user.companyId)
      : await q.isOwnComment(db, commentId, user.companyId, user.userId)
    if (!allowed) return fail(c, 404, 'Comment not found or not authorized')
    await q.deleteCommentAndReplies(db, commentId)
    return c.body(null, 204)
  })

  // Activity
  app.get('/activity/user/:userId', async (c) => {
    if (!(await may(c, 'audit:read'))) return refuse(c, 'audit:read')
    const user = c.get('user')
    const rows = await q.listUserActivity(db, c.req.param('userId'), user.companyId, parseInt(c.req.query('limit') || '50'))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.get('/activity/:entityType/:entityId', async (c) => {
    const user = c.get('user')
    const entityType = c.req.param('entityType')
    if (!ENTITY.test(entityType)) return fail(c, 400, 'Unknown record type')
    const permission = `${resourceOf(entityType)}:read`
    if (!(await may(c, permission))) return refuse(c, permission)
    const rows = await q.listEntityActivity(db, user.companyId, entityType, c.req.param('entityId'), parseInt(c.req.query('limit') || '50'))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  return app
}
