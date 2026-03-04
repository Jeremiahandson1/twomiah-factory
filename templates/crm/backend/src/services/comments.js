/**
 * Comments & Activity Service
 * 
 * Add comments and track activity on any entity:
 * - Projects
 * - Jobs
 * - Contacts
 * - Invoices
 * - Quotes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}) {
  const comment = await prisma.comment.create({
    data: {
      companyId,
      userId,
      entityType,
      entityId,
      content,
      mentions,
      attachments,
      parentId,
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      replies: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

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
export async function getComments(companyId, entityType, entityId, { includeReplies = true } = {}) {
  const comments = await prisma.comment.findMany({
    where: {
      companyId,
      entityType,
      entityId,
      parentId: null, // Only top-level comments
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      ...(includeReplies && {
        replies: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return comments;
}

/**
 * Update a comment
 */
export async function updateComment(commentId, companyId, userId, content) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, companyId, userId },
  });

  if (!comment) {
    throw new Error('Comment not found or not authorized');
  }

  return prisma.comment.update({
    where: { id: commentId },
    data: { 
      content, 
      editedAt: new Date(),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId, companyId, userId, isAdmin = false) {
  const where = { id: commentId, companyId };
  if (!isAdmin) {
    where.userId = userId;
  }

  const comment = await prisma.comment.findFirst({ where });

  if (!comment) {
    throw new Error('Comment not found or not authorized');
  }

  // Delete replies first
  await prisma.comment.deleteMany({
    where: { parentId: commentId },
  });

  await prisma.comment.delete({ where: { id: commentId } });
  return true;
}

/**
 * React to a comment (like, etc.)
 */
export async function toggleReaction(commentId, userId, reaction = 'like') {
  const existing = await prisma.commentReaction.findFirst({
    where: { commentId, userId, reaction },
  });

  if (existing) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
    return { added: false };
  } else {
    await prisma.commentReaction.create({
      data: { commentId, userId, reaction },
    });
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
}) {
  return prisma.activity.create({
    data: {
      companyId,
      userId,
      entityType,
      entityId,
      action,
      metadata,
      description,
    },
  });
}

/**
 * Get activity for an entity
 */
export async function getEntityActivity(companyId, entityType, entityId, { limit = 50 } = {}) {
  return prisma.activity.findMany({
    where: {
      companyId,
      entityType,
      entityId,
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get recent activity for company (feed)
 */
export async function getActivityFeed(companyId, { limit = 50, page = 1, entityTypes = null } = {}) {
  const where = { companyId };
  
  if (entityTypes?.length) {
    where.entityType = { in: entityTypes };
  }

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    activities,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get activity for a user
 */
export async function getUserActivity(userId, companyId, { limit = 50 } = {}) {
  return prisma.activity.findMany({
    where: { userId, companyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Log common activities
 */
export const ActivityActions = {
  // Generic
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  VIEWED: 'viewed',
  
  // Comments
  COMMENT_ADDED: 'comment_added',
  COMMENT_REPLIED: 'comment_replied',
  
  // Status changes
  STATUS_CHANGED: 'status_changed',
  
  // Assignments
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',
  
  // Documents
  FILE_UPLOADED: 'file_uploaded',
  FILE_DELETED: 'file_deleted',
  
  // Invoices/Quotes
  SENT: 'sent',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAID: 'paid',
  SIGNED: 'signed',
  
  // Jobs
  SCHEDULED: 'scheduled',
  STARTED: 'started',
  COMPLETED: 'completed',
  
  // Photos
  PHOTO_ADDED: 'photo_added',
};

/**
 * Helper to log activity with context
 */
export async function logActivity(req, action, entityType, entityId, metadata = {}) {
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
export function formatActivityMessage(activity) {
  const { action, entityType, metadata, user } = activity;
  const userName = user ? `${user.firstName} ${user.lastName}` : 'Someone';

  const messages = {
    created: `${userName} created this ${entityType}`,
    updated: `${userName} updated this ${entityType}`,
    deleted: `${userName} deleted this ${entityType}`,
    comment_added: `${userName} added a comment`,
    comment_replied: `${userName} replied to a comment`,
    status_changed: `${userName} changed status to ${metadata?.newStatus || 'unknown'}`,
    assigned: `${userName} assigned to ${metadata?.assigneeName || 'someone'}`,
    sent: `${userName} sent this ${entityType}`,
    approved: `${userName} approved this ${entityType}`,
    paid: `Payment received`,
    signed: `${userName} signed this ${entityType}`,
    scheduled: `${userName} scheduled this ${entityType}`,
    completed: `${userName} marked as completed`,
    photo_added: `${userName} added ${metadata?.count || 1} photo(s)`,
    file_uploaded: `${userName} uploaded ${metadata?.filename || 'a file'}`,
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
