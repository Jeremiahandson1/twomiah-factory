// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // A bar's contacts: guests (regulars, party hosts), leads (a party enquiry not yet booked), and the
  // suppliers it buys from (distributors, the brewery reps). A supplier is stored as `vendor`, so nothing
  // saved under crm-basic's set changes; a type outside this list still gets its own card while any contact
  // holds it (ContactsPage's stray rule), so no record is hidden.
  types: [
    { value: 'client', label: 'Guest' },
    { value: 'lead', label: 'Lead' },
    { value: 'vendor', label: 'Supplier' },
  ],
  // The parties list on a guest (crm-restaurant's events), texting, and nothing of crm-basic's field-service
  // set (sites, equipment) — a bar's guest has neither. Lists follow the features that are on.
  gateByFeature: true,
  sections: { events: true, sms: true },
  portalGate: false,
  quickActions: [
    { label: 'Book a party', to: '/crm/events?contactId=:id', icon: 'event', feature: 'event_bookings' },
    { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
  ],
}
