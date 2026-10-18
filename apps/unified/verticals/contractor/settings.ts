// General contractor (templates/crm, the base CRM). Its role names and permissions are the shared defaults.
import type { VerticalSettings } from '../../server/core/vertical.ts'

const contractor: VerticalSettings = {
  id: 'contractor',
  label: 'Contractor',
  mfaIssuer: 'Twomiah Contractor',
  featureSet: 'crm',
  // Exterior Visualizer: the screens open company.visionUrl when the feature is on.
  visionUrl: () => process.env.VISION_URL || null,
  site: {
    design: 'contractor',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: "What you're working on",
      contactMessageRequired: 'Tell us a bit about your project.',
    },
  },
}

export default contractor
