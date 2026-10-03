// Vocabulary/behaviour flags for the shared Equipment page (packages/tenant-ui/src/equipment, vendored as ./shared).
import type { EquipmentConfig } from './shared'

// `categories` is the STARTER LIST offered to a company that has none yet — the categories themselves
// are the company's own rows (equipment_category), created from this screen. A general contractor
// tracks their OWN plant, not a customer's furnace, so the list is the yard's. (T41)
export const equipmentConfig: EquipmentConfig = {
  contacts: true,
  categories: [
    { name: 'Power tools', icon: 'tool' },
    { name: 'Heavy equipment', icon: 'mower' },
    { name: 'Trucks & trailers', icon: 'truck' },
    { name: 'HVAC', icon: 'hvac' },
    { name: 'Plumbing', icon: 'plumbing' },
    { name: 'Electrical', icon: 'electrical' },
  ],
}
