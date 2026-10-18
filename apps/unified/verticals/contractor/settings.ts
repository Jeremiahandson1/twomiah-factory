// General contractor (templates/crm, the base CRM). Its role names and permissions are the shared defaults.
import type { VerticalSettings } from '../../server/core/vertical.ts'

const contractor: VerticalSettings = {
  id: 'contractor',
  label: 'Contractor',
  mfaIssuer: 'Twomiah Contractor',
  // Exterior Visualizer: the screens open company.visionUrl when the feature is on.
  visionUrl: () => process.env.VISION_URL || null,
}

export default contractor
