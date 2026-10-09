// Audit Log — shared implementation in packages/tenant-ui/src/audit, vendored as ../shared. (T59)
// crm-roof was the one CRM with no audit trail at all; it has the same page every other template does.
// Hands the shared page this template's api client (services/api — the one whose get() passes query
// params, which the page's filters need; api/client's get() drops them), the COMPANY's timezone, and
// whether this seat may read the roster (the user filter is behind users:read).
import api from '../services/api'
import { AuditLogPage, usePermissions } from '../shared'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

export default function AuditLog() {
  const { company } = useAuth()
  const { can } = usePermissions()
  const toast = useToast()
  return (
    <AuditLogPage
      api={api as any}
      toast={toast as any}
      timeZone={(company as any)?.timeZone}
      canReadUsers={!!can?.('users:read')}
    />
  )
}
