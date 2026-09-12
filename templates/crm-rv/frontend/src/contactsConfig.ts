// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  types: [
    { value: 'lead', label: 'Lead' },
    { value: 'customer', label: 'Customer' },
    { value: 'client', label: 'Client' },
    { value: 'vendor', label: 'Vendor' },
  ],
  // no projects UI in the dealership CRM
  sections: { projects: false, quotes: true, roofReports: true, portal: true },
}
