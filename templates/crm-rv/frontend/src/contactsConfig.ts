// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // a dealership sells to customers (legacy 'client' rows are folded into 'customer' at boot — db/prune-legacy.ts)
  types: [
    { value: 'lead', label: 'Lead' },
    { value: 'customer', label: 'Customer' },
    { value: 'vendor', label: 'Vendor' },
  ],
  convertLabel: 'Customer',
  // no projects UI in the dealership CRM
  sections: { projects: false, quotes: true, portal: true },
}
