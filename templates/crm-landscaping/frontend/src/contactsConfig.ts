// What this vertical does differently in the shared Contacts pages (see ./shared).
import type { ContactsConfig } from './shared'

export const CONTACTS: ContactsConfig = {
  sections: { projects: true, quotes: true, equipment: true, sites: true, sms: true, portal: true },
  portalGate: false,
}
