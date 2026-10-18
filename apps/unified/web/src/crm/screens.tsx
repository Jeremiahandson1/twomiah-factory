// The CRM's shared screens (packages/tenant-ui), each handed this app's client, toasts, session and the vertical's
// settings. Every CRM template kept a wrapper file per screen (templates/crm/frontend/src/pages/*, components/detail/*)
// and a config file per area; here one file, and the settings come from the vertical (./vertical.ts).
import { Navigate, Outlet } from 'react-router-dom'
import {
  ContactsPage, ContactDetailPage, JobsPage, JobDetailPage, QuotesPage, QuoteDetailPage, InvoicesPage, InvoiceDetailPage,
  JobsDashboardPage, ReportsPage, JobCostingPage, SchedulePage, TimePage, ExpensesPage, TeamPage, DocumentsPage, LocationsPage,
  CommissionsPage, TechView, FleetPage, InventoryPage, EquipmentPage, AgreementsPage, WarrantiesPage, RecurringForm,
  RecurringList, TasksPage, ReviewsPage, MarketingPage, MessagesPage, AdsPage, PricebookPage, LeadSourcesPage,
  leadSourceGuides, EmailDomainPage, InboundMessagesPage, GbpReviewsPage, IntegrationsPage, ImportPage, MigrationPage,
  useAuth, useToast,
} from '../shared'
import { api } from '../api'
import { verticalScreens } from './vertical'
import OnboardingWizard from './pages/OnboardingWizard'

const v = verticalScreens
const client = api as any
const settingsOf = (company: unknown) => (company as { settings?: any } | null)?.settings

export function Dashboard() {
  const { user, company } = useAuth()
  return <JobsDashboardPage api={client} user={user as any} company={company as any} config={v().dashboard} />
}
export function Contacts() {
  const { hasFeature, can } = useAuth()
  return <ContactsPage api={client} toast={useToast()} config={{ ...v().contacts, hasFeature, can } as any} />
}
export function ContactDetail() {
  const { hasFeature, can } = useAuth()
  return <ContactDetailPage api={client} toast={useToast()} config={{ ...v().contacts, hasFeature, can } as any} />
}
export function Jobs() {
  const { hasFeature, can } = useAuth()
  return <JobsPage api={client} toast={useToast()} config={{ ...v().jobs, hasFeature, can } as any} />
}
export function JobDetail() {
  const { hasFeature } = useAuth()
  return <JobDetailPage api={client} toast={useToast()} config={{ ...v().jobs, hasFeature } as any} />
}
export function Quotes() {
  const { company } = useAuth()
  return <QuotesPage api={client} toast={useToast()} settings={settingsOf(company)} config={v().invoicing} />
}
export function QuoteDetail() {
  const { company } = useAuth()
  return <QuoteDetailPage api={client} toast={useToast()} settings={settingsOf(company)} config={v().invoicing} />
}
export function Invoices() {
  const { company } = useAuth()
  return <InvoicesPage api={client} toast={useToast()} settings={settingsOf(company)} config={v().invoicing} />
}
export function InvoiceDetail() {
  const { company } = useAuth()
  return <InvoiceDetailPage api={client} toast={useToast()} settings={settingsOf(company)} config={v().invoicing} />
}
export function Schedule() {
  const { hasFeature } = useAuth()
  // The week's bookings are the app's own (one booking engine for site and CRM), when the business takes bookings.
  const loadBookings = async (from: string, to: string) => {
    if (!hasFeature('online_booking')) return []
    const r: any = await client.get('/api/booking/bookings', { from, to, limit: 500 })
    return (r?.data || []).filter((b: any) => b.status !== 'cancelled').map((b: any) => ({
      id: b.id, startAt: b.startAt, status: b.status, customerName: b.customerName, serviceName: b.serviceName ?? null,
      customerAddress: b.customerAddress ?? null, calendarId: null, source: b.source === 'public' ? 'website' as const : 'crm' as const,
    }))
  }
  return <SchedulePage api={client} toast={useToast()} config={{ dragDrop: hasFeature('drag_drop_calendar'), loadBookings }} />
}
export const Time = () => <TimePage api={client} toast={useToast()} config={v().time as any} />
export const Expenses = () => <ExpensesPage api={client} toast={useToast()} config={v().expenses as any} />
export function Team() {
  const { hasFeature } = useAuth()
  return <TeamPage api={client} toast={useToast()} config={{ ...v().team, hasFeature } as any} />
}
export function Documents() {
  const { hasFeature } = useAuth()
  return <DocumentsPage api={client} toast={useToast()} config={{ ...v().documents, hasFeature } as any} />
}
export const Locations = () => <LocationsPage api={client} toast={useToast()} />
export const Commissions = () => <CommissionsPage api={client} toast={useToast()} config={v().commissions} />
export function Tech() {
  const { hasFeature } = useAuth()
  return <TechView api={client} toast={useToast()} config={{ ...v().tech, hasFeature }} />
}
export const Fleet = () => <FleetPage api={client} config={v().fleet} />
export function Inventory() {
  const { hasFeature } = useAuth()
  return <InventoryPage api={client} hasFeature={hasFeature} />
}
export const Equipment = () => <EquipmentPage api={client} config={v().equipment} />
export const Agreements = () => <AgreementsPage api={client} config={v().agreements} />
export const Warranties = () => <WarrantiesPage api={client} />
export const Recurring = () => <RecurringList api={client} />
export const RecurringEdit = () => <RecurringForm api={client} />
export const Tasks = () => <TasksPage api={client} />
export const Reviews = () => <ReviewsPage api={client} toast={useToast()} config={v().reviews as any} />
export const Marketing = () => <MarketingPage api={client} toast={useToast()} config={v().marketing as any} />
export const Messages = () => <MessagesPage api={client} toast={useToast()} config={v().messages as any} />
export const Ads = () => <AdsPage api={client} toast={useToast()} />
export const Pricebook = () => <PricebookPage api={client} toast={useToast()} config={v().pricebook} />
export const Reports = () => <ReportsPage api={client} config={v().reporting} />
export const JobCosting = () => <JobCostingPage api={client} config={v().jobCosting} />
export const LeadSources = () => <LeadSourcesPage api={client} toast={useToast()} config={v().leads as any} />
export const EmailDomain = () => <EmailDomainPage />
export const EmailInbox = () => <InboundMessagesPage />
export const GoogleReviews = () => <GbpReviewsPage />
export const Integrations = () => <IntegrationsPage api={client} config={{ leadSources: leadSourceGuides((v().leads as any).platforms) }} />
export const Import = () => <ImportPage api={client} config={v().import as any} />
export const Migration = () => <MigrationPage api={client} config={v().migration as any} />


/**
 * The CRM's first-run wizard, before its screens. The template wrapped its whole /crm in OnboardingGate
 * (templates/crm/frontend/src/App.tsx): a company whose settings.onboardingComplete is not true was sent to
 * /crm/onboarding. Here /crm is also the website's and the account's, so the gate wraps only the CRM's routes, and
 * it sends only the people the wizard is for:
 *  - a business with the CRM (the core 'dashboard' feature, as Home decides): a website-only business never sees it;
 *  - an owner or admin, the people whose save the server accepts (PUT /api/company is owner/admin). The template
 *    sent everyone, so a technician who signed in before the owner had finished was held on a wizard whose last
 *    step the server refused, with no way into the CRM.
 * The website, bookings, the lead inbox, settings, the account, Help and Contact Twomiah stay open either way.
 */
function needsOnboarding(company: unknown, hasFeature: (id: string) => boolean, isAdmin: boolean): boolean {
  const settings = (company as { settings?: { onboardingComplete?: unknown } } | null)?.settings
  return !!company && hasFeature('dashboard') && isAdmin && settings?.onboardingComplete !== true
}

export function OnboardingGate() {
  const { company, hasFeature, isAdmin } = useAuth()
  if (needsOnboarding(company, hasFeature, isAdmin)) return <Navigate to="/crm/onboarding" replace />
  return <Outlet />
}

/** The wizard itself, outside the shell as in the template; only for those the gate would send. */
export function Onboarding() {
  const { company, hasFeature, isAdmin } = useAuth()
  if (company && (!hasFeature('dashboard') || !isAdmin)) return <Navigate to="/crm" replace />
  return <OnboardingWizard />
}
