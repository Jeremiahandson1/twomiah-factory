// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // owners: no projects / quotes in the clinic CRM
  sections: { projects: false, quotes: false, roofReports: true, portal: true },
  quickActions: [
    { label: 'Patients', to: '/crm/patients', icon: 'patients' },
    { label: 'Book Appointment', to: '/crm/appointments', icon: 'appointment' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
  ],
}
