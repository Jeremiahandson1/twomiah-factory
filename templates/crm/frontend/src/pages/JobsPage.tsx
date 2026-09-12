// JobsPage — shared implementation in packages/tenant-ui/src/jobs, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, feature flags and config.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { JobsPage as SharedJobsPage } from '../shared';
import { JOBS } from '../jobsConfig';

export default function JobsPage() {
  const toast = useToast();
  const { hasFeature } = useAuth();
  return <SharedJobsPage api={api as any} toast={toast} config={{ ...JOBS, hasFeature }} />;
}
