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
// Settings → Integrations / Import / Migrate + the Reviews page — one implementation for every CRM; the template passes its api (+toast) and a vertical config.
export { IntegrationsPage, DEFAULT_LEAD_SOURCES } from './settings/IntegrationsPage'
export { ImportPage, DEFAULT_IMPORT_TYPES, DEFAULT_IMPORT_CONTACT_TYPES } from './settings/ImportPage'
export { MigrationPage } from './settings/MigrationPage'
export { ReviewsPage } from './reviews/ReviewsPage'
export type { SettingsApi, SettingsToast, IntegrationsConfig, LeadSourceGuide, ImportConfig, ImportTypeDef, MigrationConfig, ReviewsConfig } from './settings/integrationsTypes'
// Email marketing (campaigns / templates / sequences with enrolment) and the two-way texting inbox — one page each for every CRM.
export { MarketingPage } from './marketing/MarketingPage'
export { MessagesPage, fmtPhone } from './marketing/MessagesPage'
export type { MarketingApi, MarketingToast, MarketingConfig, MessagesConfig } from './marketing/types'
// Team roster, time tracking (clock in/out + hours) and expenses — one page each for every CRM that offers them.
export { TeamPage } from './people/TeamPage'
export { TimePage } from './people/TimePage'
export { ExpensesPage } from './people/ExpensesPage'
export { DEFAULT_EXPENSE_CATEGORIES } from './people/types'
export type { PeopleApi, PeopleToast, TeamConfig, TimeConfig, ExpensesConfig } from './people/types'
// Lead Inbox + Lead Sources — one implementation for every CRM; the template passes its api (+toast, +socket subscribe) and its platform vocabulary.
export { LeadInboxPage } from './leads/LeadInboxPage'
export { LeadSourcesPage } from './leads/LeadSourcesPage'
export { TRADES_LEAD_PLATFORMS, leadSourceGuides, LEAD_STATUSES } from './leads/types'
export type { LeadsApi, LeadsToast, LeadsSubscribe, LeadsConfig, LeadPlatform, LeadRow, LeadSourceRow } from './leads/types'
// Invoices + quotes — one set of pages for every CRM; the template passes its api/toast/settings + a vertical config.
export { InvoicesPage } from './invoicing/InvoicesPage'
export { InvoiceDetailPage } from './invoicing/InvoiceDetailPage'
export { QuotesPage } from './invoicing/QuotesPage'
export { QuoteDetailPage } from './invoicing/QuoteDetailPage'
export type { InvoicingConfig, InvoicingPageProps, InvoicingApi, InvoicingToast } from './invoicing/types'
export { PAYMENT_METHODS } from './invoicing/ui'
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
export { useTheme, useIsDark, useMediaQuery, useIsMobile, useIsTablet, useIsDesktop, usePrefersDarkMode, usePrefersReducedMotion } from './shell/hooks'
export type { NavItem, ShellConfig, ShellAuth, AppShellProps, SettingsConfig, SettingsPageProps, FeaturesSettingsPageProps, RoleOption } from './shell/types'
export { DEFAULT_ROLES, ROLE_LABELS } from './shell/types'
export { EMAIL_ALIAS_DEFAULTS, getAliasDefaultsForProduct } from './config/emailDefaults'
// Auth — session provider + sign-in / forgot / reset pages + route guards, one implementation for every CRM.
export { AuthProvider, useAuth } from './auth/AuthContext'
export { LoginPage } from './auth/LoginPage'
export { ForgotPasswordPage } from './auth/ForgotPasswordPage'
export { ResetPasswordPage } from './auth/ResetPasswordPage'
export { ProtectedRoute, PublicRoute } from './auth/ProtectedRoute'
export { isTrialExpired, isTrialBypassPath } from './auth/trialStatus'
export { PASSWORD_RULE_TEXT, passwordMeetsRule } from './auth/types'
export type { AuthApi, AuthContextValue, AuthUser, AuthCompany, AuthData } from './auth/types'
// Customer portal — token-link portal for customers, collaborators and reviewers, one implementation for every CRM.
export * from './portal'

// Browser API client — timeout, single-flight tri-state refresh, undefined-free queries; the template's services/api.ts re-exports `api`.
export { ApiClient, createApiClient, api } from './api/client'
export type { ApiError, ListParams, RequestOptions, ApiClientOptions, RefreshOutcome } from './api/client'
// Ads — connection, performance, campaigns (spend-confirmed resume/launch), AI recommendations, A/B website tests, settings.
export { AdsPage } from './ads/AdsPage'
export type { AdsApi, AdsToast, AdsConfig, AdsOverview, AdsPlatformState, AdsProfile } from './ads/types'
// Pricebook — catalog page with configurable tier wording (crm "Sign Today…" vs trades Basic/Standard/Premium).
export { PricebookPage } from './pricebook/PricebookPage'
export type { PricebookApi, PricebookToast, PricebookConfig, TierPreset } from './pricebook/types'

// Tasks — to-do list with checklist, due dates, stats page + upcoming-tasks widget (crm, crm-vet).
export { default as TasksPage, TaskWidget } from './tasks/TasksPage'
export type { TasksApi, TasksPageProps } from './tasks/types'

// Equipment — asset tracking page (crm, crm-fieldservice, crm-landscaping); fs/lnd add contact/site/linked-jobs via config.
export { default as EquipmentPage } from './equipment/EquipmentPage'
export type { EquipmentApi, EquipmentConfig, EquipmentPageProps } from './equipment/types'

// Service Agreements — plans, agreements, visits, autopay; fs/landscaping add recurrence auto-scheduling via config.
export { default as AgreementsPage } from './agreements/AgreementsPage'
export type { AgreementsApi, AgreementsConfig, AgreementsPageProps } from './agreements/types'

// Recurring invoices — list + create/edit form (crm, crm-fieldservice, crm-landscaping).
export { default as RecurringForm } from './recurring/RecurringForm'
export { default as RecurringList } from './recurring/RecurringList'
export type { RecurringApi, RecurringPageProps } from './recurring/types'

// Fleet — vehicles/maintenance/fuel + live GPS map (leaflet) & trips gated on config.gps (crm, crm-fieldservice, crm-landscaping).
export { default as FleetPage } from './fleet/FleetPage'
export type { FleetApi, FleetConfig, FleetPageProps } from './fleet/types'

// Warranties — post-construction warranty tracking + service claims (crm, crm-fieldservice, crm-landscaping, crm-rv).
export { default as WarrantiesPage } from './warranties/WarrantiesPage'
export type { WarrantiesApi, WarrantiesPageProps } from './warranties/types'

// Inventory — parts/materials across locations, stock ops, transfers, purchase orders (crm, crm-fieldservice, crm-landscaping, crm-rv).
export { default as InventoryPage } from './inventory/InventoryPage'
export type { InventoryApi, InventoryPageProps } from './inventory/types'
