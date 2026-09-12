// What this vertical's customer portal shows (see ./shared — PortalConfig). Sections are intersected with what
// the backend mounts (backend/src/routes/portal.ts), so a section listed here but not mounted never appears.
import type { PortalConfig } from './shared';

export const PORTAL: PortalConfig = {
  providerNoun: 'service team',
  clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
  collaboratorNav: ['messages'],
  reviewerNav: ['messages'],
  labels: { myJobs: 'Service Calls', agreements: 'Maintenance Plans' },
};
