import { db } from '../../db'
import { auditLog } from '../../db/schema'

export async function logAudit(params: {
  companyId: string
  userId: string
  action: string
  entityType?: string
  entityId?: string
  details?: any
  ipAddress?: string
}) {
  await db.insert(auditLog).values({
    companyId: params.companyId,
    userId: params.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    details: params.details ? JSON.stringify(params.details) : null,
    ipAddress: params.ipAddress,
  })
}
