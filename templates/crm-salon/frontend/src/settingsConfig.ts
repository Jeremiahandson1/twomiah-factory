// What this vertical does differently in the shared Settings page (see ./shared).
import type { SettingsConfig } from './shared'

export const SETTINGS: SettingsConfig = {
  roles: [
    { value: 'field', label: 'Staff', description: 'the book, clients and service records; no invoices or settings' },
    { value: 'manager', label: 'Manager', description: 'everything staff can do plus invoices, reports and the team; not company settings' },
    { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
  ],
  licenseNumber: false,
}
