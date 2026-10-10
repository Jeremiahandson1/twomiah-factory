// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  // Gyms, studios, hotels, wedding businesses, photographers, food trucks — not a builder's trade list. It inherited
  // Lead / Client / Subcontractor / Vendor, and a gym's Contacts page offered "Subcontractors". (T64) The salon's set:
  // a supplier is stored as `vendor`, so nothing already saved changes; a type outside this list still gets its own
  // card while any contact holds it (ContactsPage's stray rule), so no record is hidden.
  types: [
    { value: 'lead', label: 'Lead' },
    { value: 'client', label: 'Client' },
    { value: 'vendor', label: 'Supplier' },
  ],
  sections: { projects: true, quotes: true, equipment: true, sites: true, sms: true, portal: true },
  portalGate: false,
}
