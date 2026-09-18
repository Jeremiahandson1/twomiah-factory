// What this vertical's customer portal shows (see ./shared — PortalConfig). Sections are intersected with what
// the backend mounts (backend/src/routes/portal.ts), so a section listed here but not mounted never appears.
import type { PortalConfig } from './shared';

export const PORTAL: PortalConfig = {
  providerNoun: 'clinic',
  // Pets FIRST. The backend has mounted the section since #227, but this list never named it, so an owner
  // opened the portal to Invoices, Payment Method, Documents and Messages — a billing portal for a
  // veterinary practice. It is what they come here for. (T24 H6)
  clientNav: ['pets', 'invoices', 'paymentMethods', 'sharedDocuments', 'messages'],
  collaboratorNav: ['sharedDocuments', 'messages'],
  reviewerNav: ['sharedDocuments', 'messages'],
};
