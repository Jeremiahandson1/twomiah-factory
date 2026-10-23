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
import type { ComponentType } from 'react'
import { dashboard as salonDashboard } from './verticals/salon'
import { dashboard as eventsDashboard } from './verticals/restaurant'
// 'practice': the veterinary practice's.
import { dashboard as practiceDashboard } from './verticals/vet'
// 'rv': the dealership's (inventory, the pipeline, service).
import { dashboard as dealershipDashboard } from './verticals/rv'
// 'bar': Tonight at a glance above the party book; and the register's sales above the Reports page.
import { dashboard as barDashboard, reportsAbove as barReportsAbove } from './verticals/bar'
import { dashboard as homecareDashboard } from './verticals/homecare'
import { dashboard as roofDashboard } from './verticals/roof'
import { dashboard as storeDashboard } from './verticals/store'
import TextingPage from './pages/TextingPage'

const v = verticalScreens
const client = api as any
const settingsOf = (company: unknown) => (company as { settings?: any } | null)?.settings

/** The verticals whose own dashboard replaces the jobs one (VerticalScreens.home), each from its crm/verticals/<v>.tsx. */
// 'events': the private-events dashboard (restaurant, and the bar's events side).
const HOMES: Record<string, ComponentType> = { salon: salonDashboard, events: eventsDashboard, practice: practiceDashboard, rv: dealershipDashboard, bar: barDashboard, homecare: homecareDashboard, ...(roofDashboard ? { roofing: roofDashboard } : {}), ...(storeDashboard ? { store: storeDashboard } : {}) }

/** A vertical's own figures above the shared Reports page (VerticalScreens.reportsAbove), from its crm/verticals/<v>.tsx. */
const REPORTS_ABOVE: Record<string, ComponentType> = { bar: barReportsAbove }

function JobsDashboard() {
  const { user, company } = useAuth()
  return <JobsDashboardPage api={client} user={user as any} company={company as any} config={v().dashboard} />
}
export function Dashboard() {
  const home = v().home
  const Own = typeof home === 'string' ? HOMES[home] : undefined
  return Own ? <Own /> : <JobsDashboard />
}
export function Contacts() {
  const { hasFeature, can } = useAuth()
  return <ContactsPage api={client} toast={useToast()} config={{ ...v().contacts, hasFeature, can } as any} />
}
export function ContactDetail() {
  const { hasFeature, can } = useAuth()
  return <ContactDetailPage api={client} toast={useToast()} config={{ ...v().contacts, hasFeature, can } as any} />
}
/** The job screens pick a unit from the equipment list only where equipment_tracking is on (/api/equipment is its, on the server). */
const jobsFor = (hasFeature: (f: string) => boolean) => ({ ...v().jobs, hasFeature, equipment: !!(v().jobs as any).equipment && hasFeature('equipment_tracking') })
export function Jobs() {
  const { hasFeature, can } = useAuth()
  return <JobsPage api={client} toast={useToast()} config={{ ...jobsFor(hasFeature), can } as any} />
}
export function JobDetail() {
  const { hasFeature, company } = useAuth()
  // Photos are photo_capture's on the server, kept where the phone app keeps them: on the job (/api/jobs/:id/photos) where
  // the vertical has job photos, else in the photo library by job (/api/photos?jobId) — contractor's. Notes are the job's
  // comments (/api/comments, every vertical). Live test 2026-10-22: the page had neither an add nor a notes log.
  return <JobDetailPage api={client} toast={useToast()} config={{
    ...jobsFor(hasFeature), photos: hasFeature('photo_capture'), photoStore: v().jobs.photos ? 'job' : 'library',
    notes: true, timeZone: (company as { timeZone?: string } | null)?.timeZone,
  } as any} />
}
/**
 * The quote and invoice screens offer a list only where the vertical has it AND the business has its feature switched on —
 * the price book (pricebook, or field service’s flat-rate book), projects, jobs. Asking a business without one was refused
 * on every visit (the price book on field service, basic and landscaping; projects on contractor — found building tenants
 * on Render, 2026-10-19), and a link or button to a switched-off page leads nowhere.
 */
const invoicingFor = (hasFeature: (f: string) => boolean) => {
  const i = v().invoicing as any
  return { ...i, hasFeature,
    pricebook: !!i.pricebook && (hasFeature('pricebook') || hasFeature('flat_rate_pricebook')),
    projects: !!i.projects && hasFeature('projects'),
    jobs: !!i.jobs && hasFeature('jobs'),
    quoteJobs: !!i.quoteJobs && hasFeature('jobs'),
    quoteEquipment: !!i.quoteEquipment && hasFeature('equipment_tracking') }
}
export function Quotes() {
  const { company, hasFeature } = useAuth()
  return <QuotesPage api={client} toast={useToast()} settings={settingsOf(company)} config={invoicingFor(hasFeature) as any} />
}
export function QuoteDetail() {
  const { company, hasFeature } = useAuth()
  return <QuoteDetailPage api={client} toast={useToast()} settings={settingsOf(company)} config={invoicingFor(hasFeature) as any} />
}
export function Invoices() {
  const { company, hasFeature } = useAuth()
  return <InvoicesPage api={client} toast={useToast()} settings={settingsOf(company)} config={invoicingFor(hasFeature) as any} />
}
export function InvoiceDetail() {
  // hasFeature and can: the QuickBooks sync follows the quickbooks feature (the field-service, basic and bar copies'
  // InvoiceDetailPage.tsx passed them; the base CRM's didn't, and it offers no QuickBooks button here).
  const { company, hasFeature, can } = useAuth()
  return <InvoiceDetailPage api={client} toast={useToast()} settings={settingsOf(company)} config={{ ...invoicingFor(hasFeature), can } as any} />
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
  // Appointments (test drives, drop-offs, deliveries) where the vertical has them (VerticalScreens.schedule; the RV copy's
  // SchedulePage passed events: true).
  return <SchedulePage api={client} toast={useToast()} config={{ dragDrop: hasFeature('drag_drop_calendar'), loadBookings, events: !!v().schedule?.events }} />
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
export const Warranties = () => <WarrantiesPage api={client} config={v().warranties} />
export const Recurring = () => <RecurringList api={client} />
export const RecurringEdit = () => <RecurringForm api={client} />
export const Tasks = () => <TasksPage api={client} />
export const Reviews = () => <ReviewsPage api={client} toast={useToast()} config={v().reviews as any} />
// Campaigns and templates need Email Marketing; a dealership opens the page for its Follow-Up drips alone, and the API
// refuses the campaigns then (templates/crm-rv MarketingPage.tsx, RV T19 M6). With Email Marketing on, as everywhere
// the page opens otherwise, nothing changes.
export function Marketing() {
  const { hasFeature } = useAuth()
  return <MarketingPage api={client} toast={useToast()} config={v().marketing as any} showCampaigns={hasFeature('email_marketing')} />
}
export const Messages = () => <MessagesPage api={client} toast={useToast()} config={v().messages as any} />
export const Ads = () => <AdsPage api={client} toast={useToast()} />
// The presentation page is the unified app's (server crm/office/pricebookPresent.ts), so its button is offered here.
export const Pricebook = () => <PricebookPage api={client} toast={useToast()} config={{ ...v().pricebook, present: true }} />
export function Reports() {
  // The events pipeline is a vertical's setting AND the business's Events module (templates/crm-restaurant's
  // ReportsDashboard.tsx set it from hasFeature('event_bookings')).
  const { hasFeature } = useAuth()
  const above = v().reportsAbove
  const Above = typeof above === 'string' ? REPORTS_ABOVE[above] : undefined
  const page = <ReportsPage api={client} config={{ ...v().reporting, eventsPipeline: !!v().reporting.eventsPipeline && hasFeature('event_bookings') }} />
  return Above ? <div><Above />{page}</div> : page
}
export const JobCosting = () => <JobCostingPage api={client} config={v().jobCosting} />
export const LeadSources = () => <LeadSourcesPage api={client} toast={useToast()} config={v().leads as any} />
export const EmailDomain = () => <EmailDomainPage />
export const EmailInbox = () => <InboundMessagesPage />
export const GoogleReviews = () => <GbpReviewsPage />
// The vertical's words and panels for the page (VerticalScreens.integrations; the RV copy's integrationsConfig.ts), and its
// lead sources.
// Settings › Texting: the business's own registered number (pages/TextingPage.tsx).
export const Texting = () => <TextingPage />
// The web address is connected on this app's Domain page, and texting is the business's own registered number (Settings ›
// Texting) — so those two cards send the owner there, in plain words, rather than to a CNAME guide and a Twilio form.
export const Integrations = () => <IntegrationsPage api={client} config={{ ...v().integrations, leadSources: leadSourceGuides((v().leads as any).platforms), domainPage: '/crm/domain', textingPage: '/crm/settings/texting' }} />
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
