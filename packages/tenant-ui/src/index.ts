// @twomiah/tenant-ui — shared React components vendored into each tenant at generation.
// The factory copies `packages/tenant-ui/src/**` into each tenant's `frontend/src/shared/`;
// tenant code imports from '../shared/...', never from '@twomiah/tenant-ui'.
// Public surface is declared here so missing files break the vendoring step loudly.

export { OnboardingWizard } from './onboarding/OnboardingWizard'
export { EmailAliasesStep } from './onboarding/steps/EmailAliasesStep'
export { EmailAliasesPage } from './settings/EmailAliasesPage'
export { EmailDomainPage } from './settings/EmailDomainPage'
export { AccountOffboardPage } from './settings/AccountOffboardPage'
export { InboundMessagesPage } from './settings/InboundMessagesPage'
export { GbpReviewsPage } from './settings/GbpReviewsPage'
export { BillingPage } from './settings/BillingPage'
// Invoices + quotes — one set of pages for every CRM; the template passes its api/toast/settings + a vertical config.
export { InvoicesPage } from './invoicing/InvoicesPage'
export { InvoiceDetailPage } from './invoicing/InvoiceDetailPage'
export { QuotesPage } from './invoicing/QuotesPage'
export { QuoteDetailPage } from './invoicing/QuoteDetailPage'
export type { InvoicingConfig, InvoicingPageProps, InvoicingApi, InvoicingToast } from './invoicing/types'
// Online booking — one page for every CRM; the template passes its api/toast + a vertical config.
export { BookingsPage } from './booking/BookingsPage'
export { BookingSettingsTab } from './booking/BookingSettingsTab'
export type { BookingConfig, BookingPageProps, BookingApi, BookingToast } from './booking/types'
export { EMAIL_ALIAS_DEFAULTS, getAliasDefaultsForProduct } from './config/emailDefaults'
