// Job Costing — shared implementation in packages/tenant-ui/src/reporting, vendored as ../../shared.
// This wrapper only hands the shared page this template's api client and vertical config, exactly as
// ReportsDashboard does. The config is REQUIRED: without it the page inherits the contractor default
// and a field-service tenant reads "Jobs" where it runs Service Calls (check-vertical-vocabulary.ts).
import api from '../../services/api';
import { JobCostingPage } from '../../shared';
import { JOB_COSTING } from '../../reportingConfig';

export default function JobCosting() {
  return <JobCostingPage api={api as any} config={JOB_COSTING} />;
}
