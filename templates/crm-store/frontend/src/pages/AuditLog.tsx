// Audit Log — the fleet's shared page (packages/tenant-ui/src/audit), vendored as ../shared, over this store's
// /api/audit. The owner's (audit:read); the roster filter asks users:read, which is the owner's too.
// No timeZone: the store keeps none, so times read in the viewer's own zone — the rows are instants, so they are
// right wherever they are read.
import api from '../services/api'
import { AuditLogPage, usePermissions } from '../shared'
import { useToast } from '../contexts/ToastContext'

export default function AuditLog() {
  const { toast } = useToast()
  const { known, can } = usePermissions()
  return (
    <AuditLogPage
      api={api}
      toast={{ error: (m: string) => toast(m, 'error') }}
      canReadUsers={known && can('users:read')}
    />
  )
}
