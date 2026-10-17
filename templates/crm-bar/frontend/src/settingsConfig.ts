// What this vertical does differently in the shared Settings page (see ./shared).
import type { SettingsConfig } from './shared'

export const SETTINGS: SettingsConfig = {
  // The shared Settings page shows "License #" unless a template opts out, and the field's own doc
  // says to hide it "for verticals that are not licensed trades". This template is shared by
  // showcase, foodtruck and basic (industryRouting.ts) — a gym, a venue or a general small business
  // holds no trade licence, and T41 read the field on a gym's settings as field-service residue.
  //
  // Named so the call is visible rather than silent: a food truck does hold a vendor or health
  // PERMIT, so one of the three verticals loses an optional, always-blank company field. It is the
  // right trade because the label says "License #", which a permit is not, and because the one
  // vertical on test here is the gym. If foodtruck ever needs it, the honest fix is a separate
  // config key for a permit number, not re-showing a trade licence to all three.
  licenseNumber: false,
  // The shared list says Staff can "view jobs, log time, expenses" — a bar has no jobs (Bar Run 1). The same
  // four rungs and the same words, described as what each one does behind a bar (seen on Run 1's seats).
  // This REPLACES DEFAULT_ROLES, so Viewer is repeated or the bar could not hand out read-only access.
  roles: [
    { value: 'viewer', label: 'Viewer', description: 'read-only: can open any page but change nothing' },
    { value: 'field', label: 'Staff', description: 'the register, the grill, Tonight, the Regulars, and their own shifts and clock; no stock, gift cards, reports or pay' },
    { value: 'manager', label: 'Manager', description: 'everything staff can do plus voids and the close-out, stock, gift cards, the schedule and reports; not company settings or billing' },
    { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
  ],
}
