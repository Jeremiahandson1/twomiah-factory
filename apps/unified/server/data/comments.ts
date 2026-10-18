// Comments, reactions and the activity log on any record (moved from templates/crm/backend/src/services/comments.ts,
// which ran them as raw SQL and answered in snake_case). Each returns camelCase; a comment's author is `user`
// ({ id, firstName, lastName, email }) and its replies are `replies`.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { rowsOf, camelRow, camelRows } from '@twomiah/tenant-backend'

/** A new comment with its author and replies; the activity row "comment_added" is written beside it. */
export async function insertComment(db: any, c: {
  companyId: string; userId: string; entityType: string; entityId: string; content: string
  mentions: unknown[]; attachments: unknown[]; parentId: string | null
}) {
  const comment = camelRow(rowsOf(await db.execute(sql`
    INSERT INTO comment (id, company_id, user_id, entity_type, entity_id, content, mentions, attachments, parent_id, created_at, updated_at)
    VALUES (${createId()}, ${c.companyId}, ${c.userId}, ${c.entityType}, ${c.entityId}, ${c.content}, ${JSON.stringify(c.mentions)}::json, ${JSON.stringify(c.attachments)}::json, ${c.parentId}, NOW(), NOW())
    RETURNING *
  `))[0])
  comment.user = camelRow(rowsOf(await db.execute(sql`SELECT id, first_name, last_name, email FROM "user" WHERE id = ${c.userId}`))[0]) || null
  comment.replies = camelRows(await db.execute(sql`
    SELECT c.*, u.id as user_id, u.first_name, u.last_name
    FROM comment c
    LEFT JOIN "user" u ON c.user_id = u.id
    WHERE c.parent_id = ${comment.id}
    ORDER BY c.created_at ASC
  `))
  await insertActivity(db, { companyId: c.companyId, userId: c.userId, entityType: c.entityType, entityId: c.entityId, action: 'comment_added', metadata: { commentId: comment.id } })
  return comment
}

/** A record's top-level comments, newest first, each with its author and its replies. */
export async function listComments(db: any, companyId: string, entityType: string, entityId: string) {
  const comments = camelRows(await db.execute(sql`
    SELECT c.*, u.id as user_id_ref, u.first_name, u.last_name, u.email
    FROM comment c
    LEFT JOIN "user" u ON c.user_id = u.id
    WHERE c.company_id = ${companyId} AND c.entity_type = ${entityType} AND c.entity_id = ${entityId} AND c.parent_id IS NULL
    ORDER BY c.created_at DESC
  `))
  for (const comment of comments) {
    comment.replies = camelRows(await db.execute(sql`
      SELECT c.*, u.id as user_id_ref, u.first_name, u.last_name
      FROM comment c
      LEFT JOIN "user" u ON c.user_id = u.id
      WHERE c.parent_id = ${comment.id}
      ORDER BY c.created_at ASC
    `))
    comment.user = { id: comment.userIdRef, firstName: comment.firstName, lastName: comment.lastName, email: comment.email }
  }
  return comments
}

/** Is this comment this company's and written by this person? */
export async function isOwnComment(db: any, commentId: string, companyId: string, userId: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} AND user_id = ${userId} LIMIT 1`)).length > 0
}

/** Is this comment this company's? */
export async function isCompanyComment(db: any, commentId: string, companyId: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} LIMIT 1`)).length > 0
}

/** New text for a comment (updated_at marks the edit); the comment with the editor as `user`. */
export async function setCommentContent(db: any, commentId: string, userId: string, content: string) {
  const comment = camelRow(rowsOf(await db.execute(sql`
    UPDATE comment SET content = ${content}, updated_at = NOW()
    WHERE id = ${commentId}
    RETURNING *
  `))[0])
  comment.user = camelRow(rowsOf(await db.execute(sql`SELECT id, first_name, last_name FROM "user" WHERE id = ${userId}`))[0]) || null
  return comment
}

/** Remove a comment and its replies. */
export async function deleteCommentAndReplies(db: any, commentId: string) {
  await db.execute(sql`DELETE FROM comment WHERE parent_id = ${commentId}`)
  await db.execute(sql`DELETE FROM comment WHERE id = ${commentId}`)
}

/** Add this person's reaction, or take it back if it is there. */
export async function toggleReaction(db: any, commentId: string, userId: string, reaction = 'like') {
  const existing = rowsOf(await db.execute(sql`
    SELECT id FROM comment_reaction WHERE comment_id = ${commentId} AND user_id = ${userId} AND reaction = ${reaction} LIMIT 1
  `))
  if (existing.length > 0) {
    await db.execute(sql`DELETE FROM comment_reaction WHERE id = ${existing[0].id}`)
    return { added: false }
  }
  await db.execute(sql`
    INSERT INTO comment_reaction (id, comment_id, user_id, reaction)
    VALUES (${createId()}, ${commentId}, ${userId}, ${reaction})
  `)
  return { added: true }
}

/** Which record a comment is on, if it is this company's. */
export async function commentEntity(db: any, commentId: string, companyId: string): Promise<{ entityType: string; entityId: string } | null> {
  const row = rowsOf(await db.execute(sql`SELECT entity_type, entity_id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} LIMIT 1`))[0]
  return row ? { entityType: row.entity_type, entityId: row.entity_id } : null
}

/** One entry in the activity log. */
export async function insertActivity(db: any, a: {
  companyId: string; userId: string; entityType: string; entityId: string; action: string; metadata?: Record<string, unknown>; description?: string | null
}) {
  return camelRow(rowsOf(await db.execute(sql`
    INSERT INTO activity (id, company_id, user_id, entity_type, entity_id, action, metadata, description, created_at)
    VALUES (${createId()}, ${a.companyId}, ${a.userId}, ${a.entityType}, ${a.entityId}, ${a.action}, ${JSON.stringify(a.metadata || {})}::json, ${a.description ?? null}, NOW())
    RETURNING *
  `))[0])
}

/** A record's activity, newest first, with the person's name. */
export async function listEntityActivity(db: any, companyId: string, entityType: string, entityId: string, limit = 50) {
  return camelRows(await db.execute(sql`
    SELECT a.*, u.id as user_id_ref, u.first_name, u.last_name
    FROM activity a
    LEFT JOIN "user" u ON a.user_id = u.id
    WHERE a.company_id = ${companyId} AND a.entity_type = ${entityType} AND a.entity_id = ${entityId}
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `))
}

/** A page of the company's activity, newest first, optionally only some record types. */
export async function activityFeed(db: any, companyId: string, { limit = 50, page = 1, entityTypes = null }: { limit?: number; page?: number; entityTypes?: string[] | null } = {}) {
  const conds = [sql`a.company_id = ${companyId}`]
  if (entityTypes?.length) conds.push(sql`a.entity_type IN (${sql.join(entityTypes.map((t) => sql`${t}`), sql`, `)})`)
  const where = sql.join(conds, sql` AND `)
  const pageN = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1
  const limitN = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(200, Math.floor(Number(limit))) : 50
  const offset = (pageN - 1) * limitN
  const activities = camelRows(await db.execute(sql`
    SELECT a.*, u.id as user_id_ref, u.first_name, u.last_name
    FROM activity a
    LEFT JOIN "user" u ON a.user_id = u.id
    WHERE ${where}
    ORDER BY a.created_at DESC
    LIMIT ${limitN} OFFSET ${offset}
  `))
  const total = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int as total FROM activity a WHERE ${where}`))[0]?.total || 0)
  return { activities, page: pageN, limit: limitN, total }
}

/** One person's activity in this company, newest first. */
export async function listUserActivity(db: any, userId: string, companyId: string, limit = 50) {
  return camelRows(await db.execute(sql`
    SELECT * FROM activity
    WHERE user_id = ${userId} AND company_id = ${companyId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `))
}
