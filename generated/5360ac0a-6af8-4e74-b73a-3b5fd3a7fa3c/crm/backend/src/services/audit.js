/**
 * Audit Logging Service
 * Tracks who changed what when
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGE: 'password_change',
  STATUS_CHANGE: 'status_change',
  SEND: 'send',
  PAYMENT: 'payment',
  ROLE_CHANGE: 'role_change',
  EXPORT: 'export',
};

export const ENTITIES = {
  USER: 'user',
  CONTACT: 'contact',
  PROJECT: 'project',
  JOB: 'job',
  QUOTE: 'quote',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  TIME_ENTRY: 'time_entry',
  EXPENSE: 'expense',
  DOCUMENT: 'document',
  RFI: 'rfi',
  CHANGE_ORDER: 'change_order',
  TEAM_MEMBER: 'team_member',
  COMPANY: 'company',
};

/**
 * Create audit log entry
 */
export async function log({ action, entity, entityId, entityName, changes, metadata, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId,
        entityName,
        changes: changes || undefined,
        metadata: metadata || undefined,
        userId: req?.user?.userId,
        userName: req?.user?.email,
        userEmail: req?.user?.email,
        companyId: req?.user?.companyId,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'],
        userAgent: req?.headers?.['user-agent'],
      },
    });
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}

/**
 * Calculate diff between old and new objects
 */
export function diff(oldData, newData) {
  if (!oldData || !newData) return null;
  
  const changes = {};
  const skipFields = ['id', 'createdAt', 'updatedAt', 'companyId', 'passwordHash', 'refreshToken', 'resetToken'];
  
  for (const key of Object.keys(newData)) {
    if (skipFields.includes(key)) continue;
    
    const oldVal = JSON.stringify(oldData[key] ?? null);
    const newVal = JSON.stringify(newData[key] ?? null);
    
    if (oldVal !== newVal) {
      changes[key] = { old: oldData[key] ?? null, new: newData[key] ?? null };
    }
  }
  
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Query audit logs
 */
export async function query({ companyId, entity, entityId, action, userId, startDate, endDate, page = 1, limit = 50 }) {
  const where = { companyId };
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where }),
  ]);
  
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get history for specific entity
 */
export async function getHistory(companyId, entity, entityId) {
  return prisma.auditLog.findMany({
    where: { companyId, entity, entityId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export default { log, diff, query, getHistory, ACTIONS, ENTITIES };
