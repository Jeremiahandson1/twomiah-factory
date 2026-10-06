// Audit Log â€” shared implementation in packages/tenant-ui/src/audit, vendored as ../shared.
// Hands the shared page this template's api client, the COMPANY's timezone (so an entry lines up with
// the record it belongs to rather than rendering in the reader's zone) and whether this seat may read
// the roster â€” the user filter is behind users:read, which a manager does not hold.
//
// No date helper is passed: the shared page formats its own instants. Eight of the nine templates
// export only formatDate, so a formatDateTime prop was broken in all of them. (T51)
import api from '../services/api';
import { AuditLogPage } from '../shared';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function AuditLog() {
  const { can, company } = useAuth();
  const toast = useToast();
  return (
    <AuditLogPage
      api={api as any}
      toast={toast as any}
      timeZone={(company as any)?.timeZone}
      canReadUsers={!!can?.('users:read')}
    />
  );
}