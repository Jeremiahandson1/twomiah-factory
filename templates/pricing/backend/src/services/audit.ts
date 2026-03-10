import { createId } from '@paralleldrive/cuid2';
import { auditLog } from '../../db/schema';
import { logger } from './logger';

export async function logAudit(
  db: any,
  tenantId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue: Record<string, any> | null = null,
  newValue: Record<string, any> | null = null,
  ipAddress: string | null = null
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: createId(),
      companyId: tenantId,
      userId,
      action,
      entityType,
      entityId,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      newValue: newValue ? JSON.stringify(newValue) : null,
      ipAddress,
      createdAt: new Date(),
    });
  } catch (err) {
    logger.error('Failed to write audit log', {
      error: (err as Error).message,
      action,
      entityType,
      entityId,
    });
  }
}
