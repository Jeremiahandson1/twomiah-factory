// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  types: [
    { value: 'lead', label: 'Lead' },
    { value: 'client', label: 'Client' },
    { value: 'vendor', label: 'Supplier' },
  ],
  gateByFeature: true,
  sections: { projects: true, quotes: true, roofReports: true, portal: true },
  quickActions: [
    { label: 'Create Quote', to: '/crm/quotes?contactId=:id', icon: 'quote', feature: 'quotes' },
    { label: 'Schedule Job', to: '/crm/jobs?contactId=:id', icon: 'job', feature: 'jobs' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
  ],
}
