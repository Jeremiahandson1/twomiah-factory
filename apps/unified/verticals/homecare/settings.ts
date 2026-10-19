// Home care: agencies that send caregivers into clients' homes (templates/crm-homecare). Its own records — clients and
// care plans, the schedule, visits and EVV, Medicaid and private-pay billing, payroll, hiring, the family portal — are
// the home-care add-on (server/crm/homecare, docs/UNIFIED_HOMECARE_PLAN.md), behind the registry's home-care features.
import { BASE_CRM, type VerticalSettings } from '../../server/core/vertical.ts'

const homecare: VerticalSettings = {
  id: 'homecare',
  label: 'Home Care',
  mfaIssuer: 'Twomiah Home Care',
  featureSet: 'crm-homecare',
  // The template's seats were owner, admin and caregiver; a caregiver is the field rung.
  roleLabels: { field: 'Caregiver', manager: 'Office Manager' },
  roleMapping: { caregiver: 'field' },
  // What a caregiver's own day needs: their schedule, their clients' care plans, their visits (clock in and out,
  // notes, tasks) and the portal messages about them. The routes narrow each to the caregiver's own clients and
  // shifts (core/caregiverAccess.ts, core/selfService.ts), as the template's role checks did.
  extraRolePermissions: {
    field: ['care-schedule:read', 'care-clients:read', 'evv:read', 'evv:create', 'evv:update', 'care-portal:read'],
  },
  // The home-care add-on on; the CRM's shared modules as the base CRM has them.
  crm: { ...BASE_CRM, homecare: true },
  screens: {
    searchPlaceholder: 'Search clients, caregivers, visits...',
  },
  // The agency's website (templates/website-premium-homecare): its words, and a text-size control for readers who
  // want larger type.
  site: {
    design: 'homecare',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: 'How can we help?',
      contactMessageRequired: 'Please write a short message.',
    },
    textSizeToggle: true,
  },
}

export default homecare
