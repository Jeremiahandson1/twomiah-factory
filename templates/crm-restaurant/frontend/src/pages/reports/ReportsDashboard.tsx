// ReportsDashboard — shared implementation in packages/tenant-ui/src/reporting, vendored as ../../shared.
// This wrapper only hands the shared page this template's api client and vertical config.
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { ReportsPage } from '../../shared';
import { REPORTING } from '../../reportingConfig';

export default function ReportsDashboard() {
  // An events venue reports on its bookings pipeline instead of jobs.
  const { hasFeature } = useAuth();
  return <ReportsPage api={api as any} config={{ ...REPORTING, eventsPipeline: hasFeature('event_bookings') }} />;
}
