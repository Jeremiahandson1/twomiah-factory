// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  gateByFeature: true,
  sections: { projects: true, quotes: true, events: true, portal: true },
  quickActions: [
    { label: 'Create Event', to: '/crm/events?contactId=:id', icon: 'event', feature: 'event_bookings' },
    { label: 'Create Quote', to: '/crm/quotes?contactId=:id', icon: 'quote', feature: 'quotes' },
    { label: 'Schedule Job', to: '/crm/jobs?contactId=:id', icon: 'job', feature: 'jobs' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
  ],
}
