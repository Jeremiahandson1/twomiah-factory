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
    field: ['care-schedule:read', 'care-clients:read', 'evv:read', 'evv:create', 'evv:update', 'care-portal:read', 'my-pay:read', 'my-pay:create'],
  },
  // The home-care add-on on; the CRM's shared modules as the base CRM has them.
  crm: {
    ...BASE_CRM, homecare: true,
    // A caller is matched to a client, a first call makes one, and calls are counted on the agency's clock
    // (call tracking and the AI receptionist).
    callers: 'clients',
    // The agency's own dashboard and reports in place of the CRM's (server/crm/homecare/planning).
    dashboard: 'homecare',
    reports: { module: 'homecare' },
  },
  screens: {
    searchPlaceholder: 'Search clients, caregivers, visits...',
    // The agency's own screens (web/src/crm/verticals/homecare.tsx): its dashboard at /crm/dashboard (the office's, or a
    // caregiver's day), its menu, and its public pages (the portals, paying an invoice, onboarding, careers).
    home: 'homecare',
    // The first-run wizard (templates/crm-homecare pages/OnboardingWizard.tsx): no lead marketplaces; the agency's
    // suggested addresses (support@, admin@, care@); and its HIPAA checklist, its steps pointing at pages the app has
    // (the template's said "Settings > Compliance", which never existed). Its CareSmartz360 and HHAeXchange import entries
    // are not offered: they sent the owner to "Settings > Import", and home care has no client or caregiver import.
    onboarding: {
      integrations: ['dns', 'quickbooks', 'stripe', 'twilio', 'hipaa'],
      emailProduct: 'crm-homecare',
      extra: [{
        id: 'hipaa',
        label: 'HIPAA Compliance',
        description: 'Make sure your team is trained on HIPAA and sign-in and record changes are being watched.',
        category: 'compliance',
        guideSteps: [
          'Changes to clients’ care records are logged automatically: review them under Compliance › Audit Logs',
          'Review who signed in, and failed sign-ins, under Compliance › Login Activity',
          'Have every office login turn on two-step sign-in (My Account)',
          'Make sure everyone with access to the CRM has completed HIPAA training',
        ],
      }],
    },
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
