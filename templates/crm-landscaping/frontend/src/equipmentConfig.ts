// Vocabulary/behaviour flags for the shared Equipment page (packages/tenant-ui/src/equipment, vendored as ./shared).
import type { EquipmentConfig } from './shared'

// `categories` is the STARTER LIST offered to a company that has none yet — the categories themselves
// are the company's own rows (equipment_category), created from this screen. A lawn-care crew was
// being offered HVAC / Plumbing / Electrical / Appliance and nothing else. (T41)
export const equipmentConfig: EquipmentConfig = {
  contacts: true, sites: true, linkedJobs: true,
  categories: [
    { name: 'Mowers', icon: 'mower' },
    { name: 'Trimmers & blowers', icon: 'tree' },
    { name: 'Tree & stump', icon: 'tree' },
    { name: 'Trucks & trailers', icon: 'truck' },
    { name: 'Snow & ice', icon: 'snow' },
    { name: 'Irrigation', icon: 'plumbing' },
    { name: 'Hand tools', icon: 'tool' },
  ],
}
