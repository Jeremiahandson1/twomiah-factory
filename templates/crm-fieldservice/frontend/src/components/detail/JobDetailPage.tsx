// JobDetailPage — shared implementation in packages/tenant-ui/src/jobs, vendored as ../../shared.
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { JobDetailPage as SharedJobDetailPage } from '../../shared';
import { usePermissions } from '../../contexts/PermissionsContext';
import { JOBS } from '../../jobsConfig';

export default function JobDetailPage() {
  const toast = useToast();
  const { hasFeature } = useAuth();
  // `can` threaded in so the Invoice button asks the same question the server does
  // (invoices:create) rather than being offered to whoever can open a job. (T41)
  const { can } = usePermissions();
  return <SharedJobDetailPage api={api as any} toast={toast} config={{ ...JOBS, hasFeature, can }} />;
}
