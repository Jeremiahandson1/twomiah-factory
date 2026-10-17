// DashboardPage — shared implementation in packages/tenant-ui/src/reporting, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, signed-in user, company and config.
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { JobsDashboardPage } from '../shared';
import { DASHBOARD } from '../reportingConfig';

export default function DashboardPage() {
  const { user, company } = useAuth();
  return <JobsDashboardPage api={api as any} user={user as any} company={company as any} config={DASHBOARD} />;
}
