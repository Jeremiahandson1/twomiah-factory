// ReportsDashboard — the bar's sales on top (pages/bar/SalesReport.tsx), then the shared Reports page
// (packages/tenant-ui/src/reporting, vendored as ../../shared) for the rest: parties, invoices, revenue.
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { ReportsPage } from '../../shared';
import { REPORTING } from '../../reportingConfig';
import SalesReport from '../bar/SalesReport';

export default function ReportsDashboard() {
  // Bar Run 1: this page was the contractor's ("Jobs completed", "Quote conversion"). A bar reports its nights;
  // its parties use the events pipeline, as crm-restaurant's do.
  const { hasFeature } = useAuth();
  return (
    <div>
      {hasFeature('bar_register') && <SalesReport />}
      <ReportsPage api={api as any} config={{ ...REPORTING, eventsPipeline: hasFeature('event_bookings') }} />
    </div>
  );
}
