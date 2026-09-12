// What this vertical's customer portal shows (see ./shared — PortalConfig). Sections are intersected with what
// the backend mounts (backend/src/routes/portal.ts), so a section listed here but not mounted never appears.
import type { PortalConfig } from './shared';

export const PORTAL: PortalConfig = {
  providerNoun: 'dealership',
  clientNav: ['quotes', 'invoices', 'paymentMethods', 'myJobs', 'sharedDocuments', 'messages'],
  collaboratorNav: ['myJobs', 'sharedDocuments', 'messages'],
  reviewerNav: ['sharedDocuments', 'messages'],
  labels: { myJobs: 'Service' },
  docTypeLabels: { general: 'General', contract: 'Sales Contract', title: 'Title & Registration', finance: 'Financing', warranty: 'Warranty', insurance: 'Insurance', photo: 'Photo' },
};
