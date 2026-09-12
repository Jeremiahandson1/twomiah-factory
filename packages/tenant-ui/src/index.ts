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
// Reports + the jobs-family home dashboard — one page each for every CRM that uses them.
export { ReportsPage } from './reporting/ReportsPage'
export { JobsDashboardPage } from './reporting/JobsDashboardPage'
export type { ReportingConfig, ReportsPageProps, JobsDashboardConfig, JobsDashboardPageProps } from './reporting/types'
// Documents — one page for every CRM (upload, preview, authenticated download, versions, markup).
export { DocumentsPage } from './files/DocumentsPage'
export type { DocumentsConfig, DocumentsPageProps, FilesApi, FilesToast } from './files/types'
// Contacts — list + detail, one implementation for every CRM; the template passes its api/toast + a vertical config.
export { ContactsPage } from './contacts/ContactsPage'
export { ContactDetailPage } from './contacts/ContactDetailPage'
export type { ContactsConfig, ContactsPageProps, ContactsApi, ContactsToast, ContactType, QuickAction, ContactSections } from './contacts/types'
// Jobs / service calls — list + detail, one implementation for every CRM.
export { JobsPage } from './jobs/JobsPage'
export { JobDetailPage } from './jobs/JobDetailPage'
export type { JobsConfig, JobsPageProps, JobsApi, JobsToast, JobRow } from './jobs/types'
// Week schedule — jobs (drag to reschedule) + bookings (+ RV appointments), one page for every CRM.
export { SchedulePage } from './schedule/SchedulePage'
export type { ScheduleConfig, SchedulePageProps } from './schedule/types'
// App shell — sidebar/header layout, settings, feature toggles + the hooks/components they use.
export { AppShell } from './shell/AppShell'
export { SettingsPage } from './shell/SettingsPage'
export { FeaturesSettingsPage } from './shell/FeaturesSettingsPage'
export { GlobalSearch } from './shell/GlobalSearch'
export { TrialBanner } from './shell/TrialBanner'
export { ErrorBoundary } from './shell/ErrorBoundary'
export { SkipLink, FocusTrap, RouteAnnouncer } from './shell/Accessibility'
export { useTheme, useMediaQuery, useIsMobile, useIsTablet, useIsDesktop, usePrefersDarkMode, usePrefersReducedMotion } from './shell/hooks'
export type { NavItem, ShellConfig, ShellAuth, AppShellProps, SettingsConfig, SettingsPageProps, FeaturesSettingsPageProps, RoleOption } from './shell/types'
export { DEFAULT_ROLES, ROLE_LABELS } from './shell/types'
export { EMAIL_ALIAS_DEFAULTS, getAliasDefaultsForProduct } from './config/emailDefaults'
