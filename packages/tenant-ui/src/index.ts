// @twomiah/tenant-ui — shared React components vendored into each tenant at generation.
// The factory copies `packages/tenant-ui/src/**` into each tenant's `frontend/src/shared/`;
// tenant code imports from '../shared/...', never from '@twomiah/tenant-ui'.
// Public surface is declared here so missing files break the vendoring step loudly.

export { OnboardingWizard } from './onboarding/OnboardingWizard'
export { EmailAliasesPage } from './settings/EmailAliasesPage'
export { EmailDomainPage } from './settings/EmailDomainPage'
export { AccountOffboardPage } from './settings/AccountOffboardPage'
export { EMAIL_ALIAS_DEFAULTS, getAliasDefaultsForProduct } from './config/emailDefaults'
