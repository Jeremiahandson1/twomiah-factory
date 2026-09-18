// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // A clinic has owners, not "contacts", and it has no subcontractors at all. The page was headed
  // "Contacts" with Leads / Clients / Subcontractors / Vendors tiles — contractor vocabulary in a
  // veterinary practice. (Vet T12 M11)
  title: 'Owners',
  types: [
    { value: 'client', label: 'Owner' },
    { value: 'lead', label: 'Enquiry' },
    { value: 'vendor', label: 'Supplier' },
  ],
  convertLabel: 'Owner',
  // owners: their patients, no projects / quotes in the clinic CRM
  sections: { patients: true, projects: false, quotes: false, portal: true },
  quickActions: [
    { label: 'Patients', to: '/crm/patients', icon: 'patients' },
    { label: 'Book Appointment', to: '/crm/appointments', icon: 'appointment' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
  ],
}
