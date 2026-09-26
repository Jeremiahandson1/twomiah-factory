// ReportsDashboard — shared implementation in packages/tenant-ui/src/reporting, vendored as ../../shared.
// This wrapper only hands the shared page this template's api client and vertical config.
import api from '../../services/api';
import { ReportsPage } from '../../shared';
import { REPORTING } from '../../reportingConfig';

export default function ReportsDashboard() {
  return <ReportsPage api={api as any} config={REPORTING} />;
}
