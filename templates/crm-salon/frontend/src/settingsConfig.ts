// What this vertical does differently in the shared Settings page (see ./shared).
import type { SettingsConfig } from './shared'

export const SETTINGS: SettingsConfig = {
  roles: [
    // This list REPLACES the shared DEFAULT_ROLES, so Viewer has to be repeated here or the salon
    // is the one vertical that still cannot hand out read-only access.
    { value: 'viewer', label: 'Viewer', description: 'read-only: can open the book and records but change nothing' },
    // "Stylist", the same word the API now answers in roleLabel — a salon has no "staff in the field".
    { value: 'field', label: 'Stylist', description: 'the book, clients and service records; no invoices or settings' },
    { value: 'manager', label: 'Manager', description: 'everything staff can do plus invoices, reports and the team; not company settings' },
    { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
  ],
  licenseNumber: false,
}
