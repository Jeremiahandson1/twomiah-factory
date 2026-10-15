// Shared bits for the care routes: who is an office user, and the clinical audit row.
import { db } from '../../db/index.ts'
import { auditLogs } from '../../db/schema.ts'

/** homecare's office line: admin or owner (the same rule requireAdmin enforces). */
export const isOffice = (user: any) => user?.role === 'admin' || user?.role === 'owner'

/** The signed-in user's id as homecare's token carries it. */
export const userIdOf = (user: any): string => user?.userId || user?.id

/**
 * One clinical audit row (audit_logs — who changed a client record). A failed audit write never
 * loses the change it describes, so the error is logged and swallowed.
 */
export async function writeCareAudit(user: any, action: string, tableName: string, recordId: string | null, newData?: unknown, oldData?: unknown) {
  try {
    await db.insert(auditLogs).values({
      userId: userIdOf(user) || 'system',
      action,
      tableName,
      recordId,
      newData: (newData ?? null) as any,
      oldData: (oldData ?? null) as any,
    } as any)
  } catch (err) {
    console.error(`[care audit] ${action} ${tableName} failed:`, err)
  }
}

export const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

/** A whole number >= 0 from a typed value, or undefined when it is not one. */
export function wholeNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const s = String(v).trim()
  if (!/^\d+$/.test(s)) return undefined
  return parseInt(s, 10)
}
