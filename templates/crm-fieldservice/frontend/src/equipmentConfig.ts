// Vocabulary/behaviour flags for the shared Equipment page (packages/tenant-ui/src/equipment, vendored as ./shared).
import type { EquipmentConfig } from './shared'

// `categories` is the STARTER LIST offered to a company that has none yet — the categories themselves
// are the company's own rows (equipment_category), created from this screen. These four used to be
// hard-coded into the shared page for every vertical; here they are actually the trade. (T41)
export const equipmentConfig: EquipmentConfig = {
  contacts: true, sites: true, linkedJobs: true,
  categories: [
    { name: 'HVAC', icon: 'hvac' },
    { name: 'Plumbing', icon: 'plumbing' },
    { name: 'Electrical', icon: 'electrical' },
    { name: 'Appliance', icon: 'appliance' },
    { name: 'Water heaters', icon: 'plumbing' },
  ],
}
