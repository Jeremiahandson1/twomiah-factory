// JobDetailPage — shared implementation in packages/tenant-ui/src/jobs, vendored as ../../shared.
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { JobDetailPage as SharedJobDetailPage } from '../../shared';
import { JOBS } from '../../jobsConfig';

export default function JobDetailPage() {
  const toast = useToast();
  const { hasFeature } = useAuth();
  return <SharedJobDetailPage api={api as any} toast={toast} config={{ ...JOBS, hasFeature }} />;
}
