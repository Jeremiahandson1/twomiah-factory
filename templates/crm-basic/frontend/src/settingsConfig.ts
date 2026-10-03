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
}
