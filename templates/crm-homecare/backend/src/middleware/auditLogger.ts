import type { Context, Next } from 'hono'
import type { Pool } from 'pg'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const SENSITIVE_TABLES = [
  'clients', 'care_plans', 'visits', 'medical_records', 'medications',
  'diagnoses', 'emergency_contacts', 'insurance', 'billing', 'invoices',
  'payments', 'documents'
]

const SENSITIVE_ACTIONS = [
  'export', 'download', 'bulk', 'delete', 'password', 'login', 'role'
]

const isSensitiveOperation = (table_name: string | null, action: string | null, req_body: any): boolean => {
  if (SENSITIVE_TABLES.some(t => table_name?.toLowerCase().includes(t))) return true
  if (SENSITIVE_ACTIONS.some(a => action?.toLowerCase().includes(a))) return true
  if (req_body) {
    const sensitiveFields = ['ssn', 'social_security', 'diagnosis', 'medication', 'medical', 'insurance', 'dob', 'date_of_birth']
    const bodyStr = JSON.stringify(req_body).toLowerCase()
    if (sensitiveFields.some(f => bodyStr.includes(f))) return true
  }
  return false
}

const extractTableName = (path: string): string => {
  const parts = path.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part !== 'api' && part !== 'admin' && !/^[0-9a-f-]+$/i.test(part)) {
      return part
    }
  }
  return 'unknown'
}

export const auditLogger = (pool: Pool) => {
  const checkSuspiciousActivity = async (user_id: string, action: string, table_name: string, ip_address: string | null) => {
    try {
      if (user_id === SYSTEM_USER_ID) return null

      const alerts: string[] = []
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

      const bulkCheck = await pool.query(
        `SELECT COUNT(*) as count FROM audit_logs WHERE user_id = $1 AND created_at > $2 AND action LIKE '%GET%'`,
        [user_id, fiveMinutesAgo]
      )
      if (parseInt(bulkCheck.rows[0]?.count) > 20) {
        alerts.push('BULK_ACCESS: High volume data retrieval detected')
      }

      const hour = now.getHours()
      if (hour < 6 || hour > 22) {
        alerts.push('AFTER_HOURS: Access outside normal business hours')
      }

      const failCheck = await pool.query(
        `SELECT COUNT(*) as count FROM audit_logs WHERE user_id = $1 AND created_at > $2 AND action LIKE '%fail%'`,
        [user_id, fiveMinutesAgo]
      )
      if (parseInt(failCheck.rows[0]?.count) > 5) {
        alerts.push('MULTIPLE_FAILURES: Repeated failed operations')
      }

      const clientCheck = await pool.query(
        `SELECT COUNT(DISTINCT record_id) as count FROM audit_logs WHERE user_id = $1 AND created_at > $2 AND table_name = 'clients'`,
        [user_id, oneHourAgo]
      )
      if (parseInt(clientCheck.rows[0]?.count) > 10) {
        alerts.push('UNUSUAL_ACCESS: Accessing unusually high number of client records')
      }

      const ipCheck = await pool.query(
        `SELECT DISTINCT ip_address FROM audit_logs WHERE user_id = $1 AND created_at > $2 AND ip_address IS NOT NULL`,
        [user_id, oneHourAgo]
      )
      if (ipCheck.rows.length > 2) {
        alerts.push('IP_CHANGE: Multiple IP addresses detected for same user')
      }

      if (action?.toLowerCase().includes('export') || action?.toLowerCase().includes('download')) {
        if (SENSITIVE_TABLES.some(t => table_name?.toLowerCase().includes(t))) {
          alerts.push('PHI_EXPORT: Sensitive data export detected')
        }
      }

      if (alerts.length > 0) {
        console.warn(`SECURITY ALERT - User ${user_id}:`, alerts)
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data, ip_address, is_sensitive) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [SYSTEM_USER_ID, 'SECURITY_ALERT', 'audit_logs', null, JSON.stringify({ user_id, alerts, original_action: action }), ip_address, true]
        )
      }

      return alerts.length > 0 ? alerts : null
    } catch (err: any) {
      console.error('Suspicious activity check failed:', err.message)
      return null
    }
  }

  const log = async ({
    user_id = SYSTEM_USER_ID,
    action,
    table_name,
    record_id = null as string | null,
    old_data = null as any,
    new_data = null as any,
    ip_address = null as string | null,
  }) => {
    try {
      const is_sensitive = isSensitiveOperation(table_name, action, new_data)

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, ip_address, is_sensitive) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [user_id || SYSTEM_USER_ID, action, table_name, record_id, old_data ? JSON.stringify(old_data) : null, new_data ? JSON.stringify(new_data) : null, ip_address, is_sensitive]
      )

      if (is_sensitive && user_id !== SYSTEM_USER_ID) {
        await checkSuspiciousActivity(user_id, action, table_name, ip_address)
      }
    } catch (err: any) {
      console.error('Audit insert failed:', err.message)
    }
  }

  const middleware = async (c: Context, next: Next) => {
    if (c.req.method === 'GET') {
      const user = c.get('user') as any
      const user_id = user?.id || user?.userId
      if (user_id) {
        const table_name = extractTableName(c.req.path)
        if (isSensitiveOperation(table_name, 'GET', null)) {
          checkSuspiciousActivity(user_id, `GET ${c.req.path}`, table_name, c.req.header('x-forwarded-for')?.split(',')[0] || null)
        }
      }
      return next()
    }

    await next()

    if (c.res.status < 400) {
      const user = c.get('user') as any
      const user_id = user?.id || user?.userId || SYSTEM_USER_ID
      const table_name = extractTableName(c.req.path)
      const ip_address = c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown'

      let body: any = null
      try { body = await c.req.json() } catch {}

      log({
        user_id,
        action: `${c.req.method} ${c.req.path}`,
        table_name,
        record_id: c.req.param('id') || null,
        new_data: body,
        ip_address,
      }).catch(() => {})
    }
  }

  return { middleware, log, SYSTEM_USER_ID, isSensitiveOperation, checkSuspiciousActivity }
}

export default auditLogger
