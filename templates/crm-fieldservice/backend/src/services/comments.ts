/**
 * Comments & Activity Service (Drizzle)
 *
 * Add comments and track activity on any entity:
 * - Projects, Jobs, Contacts, Invoices, Quotes
 *
 * NOTE: comment, commentReaction, and activity tables are not in the current
 * Drizzle schema. This uses raw SQL for those. Add them to db/schema.ts
 * for full query-builder support.
 */

import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';

// ============================================
// COMMENTS
// ============================================

/**
 * Add a comment to any entity
 */
export async function addComment({
  companyId,
  userId,
  entityType,
  entityId,
  content,
  mentions = [],
  attachments = [],
  parentId = null,
}: {
  companyId: string;
  userId: string;
  entityType: string;
  entityId: string;
  content: string;
  mentions?: string[];
  attachments?: string[];
  parentId?: string | null;
}) {
  const result = await db.execute(sql`
    INSERT INTO comment (id, company_id, user_id, entity_type, entity_id, content, mentions, attachments, parent_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${companyId}, ${userId}, ${entityType}, ${entityId}, ${content}, ${JSON.stringify(mentions)}::jsonb, ${JSON.stringify(attachments)}::jsonb, ${parentId}, NOW(), NOW())
    RETURNING *
  `);
  const comment = ((result as any).rows || result)[0];

  // Fetch user info
  const userResult = await db.execute(sql`
    SELECT id, first_name, last_name, email FROM "user" WHERE id = ${userId}
  `);
  comment.user = ((userResult as any).rows || userResult)[0] || null;

  // Fetch replies
  const repliesResult = await db.execute(sql`
    SELECT c.*, u.id as user_id, u.first_name, u.last_name
    FROM comment c
    LEFT JOIN "user" u ON c.user_id = u.id
    WHERE c.parent_id = ${comment.id}
    ORDER BY c.created_at ASC
  `);
  comment.replies = (repliesResult as any).rows || repliesResult;

  // Create activity log
  await createActivity({
    companyId,
    userId,
    entityType,
    entityId,
    action: 'comment_added',
    metadata: { commentId: comment.id },
  });

  return comment;
}

/**
 * Get comments for an entity
 */
export async function getComments(
  companyId: string,
  entityType: string,
  entityId: string,
  { includeReplies = true }: { includeReplies?: boolean } = {},
) {
  const result = await db.execute(sql`
    SELECT c.*, u.id as user_id_ref, u.first_name, u.last_name, u.email
    FROM comment c
    LEFT JOIN "user" u ON c.user_id = u.id
    WHERE c.company_id = ${companyId} AND c.entity_type = ${entityType} AND c.entity_id = ${entityId} AND c.parent_id IS NULL
    ORDER BY c.created_at DESC
  `);
  const comments = (result as any).rows || result;

  if (includeReplies) {
    for (const comment of comments as any[]) {
      const repliesResult = await db.execute(sql`
        SELECT c.*, u.id as user_id_ref, u.first_name, u.last_name
        FROM comment c
        LEFT JOIN "user" u ON c.user_id = u.id
        WHERE c.parent_id = ${comment.id}
        ORDER BY c.created_at ASC
      `);
      comment.replies = (repliesResult as any).rows || repliesResult;
      comment.user = { id: comment.user_id_ref, firstName: comment.first_name, lastName: comment.last_name, email: comment.email };
    }
  }

  return comments;
}

/**
 * Update a comment
 */
export async function updateComment(commentId: string, companyId: string, userId: string, content: string) {
  // Verify ownership
  const existing = await db.execute(sql`
    SELECT id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} AND user_id = ${userId} LIMIT 1
  `);
  const rows = (existing as any).rows || existing;
  if (rows.length === 0) {
    throw new Error('Comment not found or not authorized');
  }

  const result = await db.execute(sql`
    UPDATE comment SET content = ${content}, edited_at = NOW(), updated_at = NOW()
    WHERE id = ${commentId}
    RETURNING *
  `);

  const comment = ((result as any).rows || result)[0];

  const userResult = await db.execute(sql`
    SELECT id, first_name, last_name FROM "user" WHERE id = ${userId}
  `);
  comment.user = ((userResult as any).rows || userResult)[0] || null;

  return comment;
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string, companyId: string, userId: string, isAdmin = false) {
  let checkSql;
  if (isAdmin) {
    checkSql = sql`SELECT id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} LIMIT 1`;
  } else {
    checkSql = sql`SELECT id FROM comment WHERE id = ${commentId} AND company_id = ${companyId} AND user_id = ${userId} LIMIT 1`;
  }

  const existing = await db.execute(checkSql);
  const rows = (existing as any).rows || existing;
  if (rows.length === 0) {
    throw new Error('Comment not found or not authorized');
  }

  // Delete replies first
  await db.execute(sql`DELETE FROM comment WHERE parent_id = ${commentId}`);
  await db.execute(sql`DELETE FROM comment WHERE id = ${commentId}`);
  return true;
}

/**
 * React to a comment (like, etc.)
 */
export async function toggleReaction(commentId: string, userId: string, reaction = 'like') {
  const existing = await db.execute(sql`
    SELECT id FROM comment_reaction WHERE comment_id = ${commentId} AND user_id = ${userId} AND reaction = ${reaction} LIMIT 1
  `);
  const rows = (existing as any).rows || existing;

  if (rows.length > 0) {
    await db.execute(sql`DELETE FROM comment_reaction WHERE id = ${rows[0].id}`);
    return { added: false };
  } else {
    await db.execute(sql`
      INSERT INTO comment_reaction (id, comment_id, user_id, reaction, created_at)
      VALUES (gen_random_uuid(), ${commentId}, ${userId}, ${reaction}, NOW())
    `);
    return { added: true };
  }
}

// ============================================
// ACTIVITY LOG
// ============================================

/**
 * Create an activity entry
 */
export async function createActivity({
  companyId,
  userId,
  entityType,
  entityId,
  action,
  metadata = {},
  description = null,
}: {
  companyId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
  description?: string | null;
}) {
  const result = await db.execute(sql`
    INSERT INTO activity (id, company_id, user_id, entity_type, entity_id, action, metadata, description, created_at)
    VALUES (gen_random_uuid(), ${companyId}, ${userId}, ${entityType}, ${entityId}, ${action}, ${JSON.stringify(metadata)}::jsonb, ${description}, NOW())
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

/**
 * Get activity for an entity
 */
export async function getEntityActivity(companyId: string, entityType: string, entityId: string, { limit = 50 }: { limit?: number } = {}) {
  const result = await db.execute(sql`
    SELECT a.*, u.id as user_id_ref, u.first_name, u.last_name
    FROM activity a
    LEFT JOIN "user" u ON a.user_id = u.id
    WHERE a.company_id = ${companyId} AND a.entity_type = ${entityType} AND a.entity_id = ${entityId}
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `);
  return (result as any).rows || result;
}

/**
 * Get recent activity for company (feed)
 */
export async function getActivityFeed(companyId: string, { limit = 50, page = 1, entityTypes = null }: { limit?: number; page?: number; entityTypes?: string[] | null } = {}) {
  let whereClause = `a.company_id = '${companyId}'`;
  if (entityTypes?.length) {
    whereClause += ` AND a.entity_type IN (${entityTypes.map(t => `'${t}'`).join(',')})`;
  }

  const offset = (page - 1) * limit;

  const result = await db.execute(sql.raw(`
    SELECT a.*, u.id as user_id_ref, u.first_name, u.last_name
    FROM activity a
    LEFT JOIN "user" u ON a.user_id = u.id
    WHERE ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  const countResult = await db.execute(sql.raw(`
    SELECT COUNT(*)::int as total FROM activity a WHERE ${whereClause}
  `));

  const activities = (result as any).rows || result;
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0);

  return {
    activities,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get activity for a user
 */
export async function getUserActivity(userId: string, companyId: string, { limit = 50 }: { limit?: number } = {}) {
  const result = await db.execute(sql`
    SELECT * FROM activity
    WHERE user_id = ${userId} AND company_id = ${companyId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return (result as any).rows || result;
}

/**
 * Log common activities
 */
export const ActivityActions = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  VIEWED: 'viewed',
  COMMENT_ADDED: 'comment_added',
  COMMENT_REPLIED: 'comment_replied',
  STATUS_CHANGED: 'status_changed',
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',
  FILE_UPLOADED: 'file_uploaded',
  FILE_DELETED: 'file_deleted',
  SENT: 'sent',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAID: 'paid',
  SIGNED: 'signed',
  SCHEDULED: 'scheduled',
  STARTED: 'started',
  COMPLETED: 'completed',
  PHOTO_ADDED: 'photo_added',
} as const;

/**
 * Helper to log activity with context
 */
export async function logActivity(
  req: { user?: { companyId: string; userId: string } },
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  if (!req.user) return null;

  return createActivity({
    companyId: req.user.companyId,
    userId: req.user.userId,
    entityType,
    entityId,
    action,
    metadata,
  });
}

/**
 * Format activity for display
 */
export function formatActivityMessage(activity: {
  action: string;
  entityType: string;
  metadata?: Record<string, unknown>;
  user?: { firstName?: string; lastName?: string };
}): string {
  const { action, entityType, metadata, user } = activity;
  const userName = user ? `${user.firstName} ${user.lastName}` : 'Someone';

  const messages: Record<string, string> = {
    created: `${userName} created this ${entityType}`,
    updated: `${userName} updated this ${entityType}`,
    deleted: `${userName} deleted this ${entityType}`,
    comment_added: `${userName} added a comment`,
    comment_replied: `${userName} replied to a comment`,
    status_changed: `${userName} changed status to ${(metadata?.newStatus as string) || 'unknown'}`,
    assigned: `${userName} assigned to ${(metadata?.assigneeName as string) || 'someone'}`,
    sent: `${userName} sent this ${entityType}`,
    approved: `${userName} approved this ${entityType}`,
    paid: `Payment received`,
    signed: `${userName} signed this ${entityType}`,
    scheduled: `${userName} scheduled this ${entityType}`,
    completed: `${userName} marked as completed`,
    photo_added: `${userName} added ${(metadata?.count as number) || 1} photo(s)`,
    file_uploaded: `${userName} uploaded ${(metadata?.filename as string) || 'a file'}`,
  };

  return messages[action] || `${userName} performed ${action}`;
}

export default {
  addComment,
  getComments,
  updateComment,
  deleteComment,
  toggleReaction,
  createActivity,
  getEntityActivity,
  getActivityFeed,
  getUserActivity,
  logActivity,
  formatActivityMessage,
  ActivityActions,
};
