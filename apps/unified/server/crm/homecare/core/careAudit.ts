// Shared bits for the care routes: who is an office user, and the clinical audit row. Moved from
// templates/crm-homecare/backend/src/helpers/careAudit.ts.
//
// The clinical audit trail (audit_logs: who changed a client record, with old and new data) is home care's own, beside
// the app's audit log (d.audit, audit_log); both are kept, as the template kept both. Each row now carries the
// person's company. `rowsOf` (a raw result's rows) went to server/data/: only data functions run raw SQL.
import { auditLogs } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

/** Home care's office line: admin or owner (the same rule requireAdmin enforces). */
export const isOffice = (user: any) => user?.role === 'admin' || user?.role === 'owner'

/** The signed-in user's id (the session's `userId`). */
export const userIdOf = (user: any): string => user?.userId || user?.id

/** A whole number >= 0 from a typed value, or undefined when it is not one. */
export function wholeNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const s = String(v).trim()
  if (!/^\d+$/.test(s)) return undefined
  return parseInt(s, 10)
}

export function createCareAudit(d: CrmDeps) {
  /**
   * One clinical audit row (audit_logs — who changed a client record), in the signed-in person's company. A failed
   * audit write never loses the change it describes, so the error is logged and swallowed.
   */
  async function writeCareAudit(user: any, action: string, tableName: string, recordId: string | null, newData?: unknown, oldData?: unknown,
    extra: { ipAddress?: string | null; reasonCode?: string | null } = {}) {
    try {
      await d.db.insert(auditLogs).values({
        companyId: user?.companyId,
        userId: userIdOf(user) || 'system',
        action,
        tableName,
        recordId,
        newData: (newData ?? null) as any,
        oldData: (oldData ?? null) as any,
        // The address the request came from and why the change was made (the incident case file records both).
        ipAddress: extra.ipAddress ?? null,
        reasonCode: extra.reasonCode ?? null,
      } as any)
    } catch (err) {
      d.logger.error(`[care audit] ${action} ${tableName} failed`, { error: (err as Error)?.message })
    }
  }

  return { writeCareAudit }
}
