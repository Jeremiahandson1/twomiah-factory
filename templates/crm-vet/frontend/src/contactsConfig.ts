// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // owners: their patients, no projects / quotes in the clinic CRM
  sections: { patients: true, projects: false, quotes: false, portal: true },
  quickActions: [
    { label: 'Patients', to: '/crm/patients', icon: 'patients' },
    { label: 'Book Appointment', to: '/crm/appointments', icon: 'appointment' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
  ],
}
