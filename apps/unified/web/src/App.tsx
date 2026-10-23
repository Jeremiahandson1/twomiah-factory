// The admin: the website's screens and the shared company screens, under /crm. The public website ('/' and every
// page of it) is the server's; this app owns /crm/*, the sign-in pages, and nothing else.
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ConfirmProvider, ErrorBoundary, InlineValidity, PermissionsProvider, ProtectedRoute, PublicRoute, ToastProvider } from './shared'
import { api } from './api'
import {
  HOME, Shell, Home, Login, ForgotPassword, ResetPassword, Settings, FeaturesSettings, MyAccount, Billing, EmailAliases,
  LeadInbox, AuditLog, Paywall,
} from './screens'
import { PhotoPickerProvider } from './site/contexts/PhotoPickerContext'
import { PhotoPickerModal } from './site/components/PhotoPickerModal'
import { WebsiteOverviewPage } from './site/pages/WebsiteOverviewPage'
import { PagesListPage } from './site/pages/PagesListPage'
import { PageEditPage } from './site/pages/PageEditPage'
import { PhotosPage } from './site/pages/PhotosPage'
import { ArticlesListPage, BLOG, PORTFOLIO } from './site/pages/ArticlesListPage'
import { ArticleEditPage } from './site/pages/ArticleEditPage'
import { SiteSettingsPage } from './site/pages/SiteSettingsPage'
import { BookingsPage } from './booking/BookingsPage'
import { BookingDetailPage } from './booking/BookingDetailPage'
import { BookingCalendarPage } from './booking/BookingCalendarPage'
import { BookingSettingsPage } from './booking/BookingSettingsPage'
import { BookingInsightsPage, BookingWaitlistPage, BookingSeriesPage } from './booking/BookingExtrasPages'
import { Crm, page, named } from './crm/lazy'
import * as basicScreens from './crm/verticals/basic'
import * as landscapingScreens from './crm/verticals/landscaping'
import * as barScreens from './crm/verticals/bar'
import * as restaurantScreens from './crm/verticals/restaurant'
import * as rvScreens from './crm/verticals/rv'
import * as salonScreens from './crm/verticals/salon'
import * as vetScreens from './crm/verticals/vet'
import * as homecareScreens from './crm/verticals/homecare'
import * as roofScreens from './crm/verticals/roof'
import * as storeScreens from './crm/verticals/store'
// The customer portal is its own bundle (crm/portal.tsx: Stripe stays out of the admin).
const PortalApp = lazy(() => import('./crm/portal'))
// A quote's or an invoice's own page, from the link in its email (crm/documentLink.tsx).
const DocumentLinkApp = lazy(() => import('./crm/documentLink'))
const DomainPage = page(() => import('./crm/pages/DomainPage'))
const ProjectsPage = page(() => import('./crm/pages/ProjectsPage'))
const ProjectDetailPage = page(() => import('./crm/pages/ProjectDetailPage'))
const RFIsPage = page(() => import('./crm/pages/RFIsPage'))
const SubmittalsPage = page(() => import('./crm/pages/SubmittalsPage'))
const DailyLogsPage = page(() => import('./crm/pages/DailyLogsPage'))
const PunchListsPage = page(() => import('./crm/pages/PunchListsPage'))
const InspectionsPage = page(() => import('./crm/pages/InspectionsPage'))
const ChangeOrdersPage = page(() => import('./crm/pages/ChangeOrdersPage'))
const GanttChartsPage = page(() => import('./crm/pages/GanttChartsPage'))
const BidsPage = page(() => import('./crm/pages/BidsPage'))
const PurchaseOrdersPage = page(() => import('./crm/pages/PurchaseOrdersPage'))
const BillsPage = page(() => import('./crm/pages/BillsPage'))
const LienWaiversPage = page(() => import('./crm/pages/LienWaiversPage'))
const DrawSchedulesPage = page(() => import('./crm/pages/DrawSchedulesPage'))
const AiaFormsPage = page(() => import('./crm/pages/AiaFormsPage'))
const TakeoffsPage = page(() => import('./crm/pages/TakeoffsPage'))
const SelectionsPage = page(() => import('./crm/pages/SelectionsPage'))
const CallTrackingPage = page(() => import('./crm/pages/CallTrackingPage'))
const AIReceptionistPage = named(() => import('./crm/pages/AIReceptionistPage'), 'AIReceptionistPage')
const SupportPage = page(() => import('./crm/pages/SupportPage'))
const ContactSupportPage = page(() => import('./crm/pages/ContactSupportPage'))
const HelpPage = page(() => import('./crm/pages/HelpPage'))
const VendorPortalPage = page(() => import('./crm/pages/VendorPortalPage'))
const PricebookTrialPage = page(() => import('./crm/pages/PricebookTrialPage'))
const VisualizerPage = page(() => import('./crm/pages/VisualizerPage'))
// Field service's own screens (templates/crm-fieldservice/frontend/src/pages/fieldservice).
const DispatchBoard = page(() => import('./crm/pages/fieldservice/DispatchBoard'))
const FlatRatePricebook = page(() => import('./crm/pages/fieldservice/FlatRatePricebook'))
const MaintenanceContracts = page(() => import('./crm/pages/fieldservice/MaintenanceContracts'))
const PartsInventory = page(() => import('./crm/pages/fieldservice/PartsInventory'))
const GeofencesPage = page(() => import('./crm/pages/fieldservice/GeofencesPage'))

function NotFound() {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center card card-padding">
      <h1 className="text-xl font-semibold text-ink mb-2">There's no page here</h1>
      <p className="text-sm text-muted">Everything you can use is in the menu.</p>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider api={api}>
          <PermissionsProvider>
            <ToastProvider>
              <ConfirmProvider>
                {/* Every form's "required" message in the app's words, under its field, never the browser's bubble (live test 2026-10-22). */}
                <InlineValidity />
                <PhotoPickerProvider>
                  <Routes>
                    <Route path="/login" element={<PublicRoute home={HOME}><Login /></PublicRoute>} />
                    <Route path="/forgot-password" element={<PublicRoute home={HOME}><ForgotPassword /></PublicRoute>} />
                    {/* Not behind PublicRoute: an invite or reset link opened while signed in must still show its form. */}
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* The CRM's first-run wizard: full screen, outside the shell, as in the template. */}
                    <Route path="/crm/onboarding" element={<ProtectedRoute><Crm.Onboarding /></ProtectedRoute>} />
                    {/* Roofing's canvasser view: full screen, outside the shell, for a roofer only (crm/verticals/roof.tsx). */}
                    {roofScreens.isRoofing && <Route path="/crm/canvass" element={<ProtectedRoute><roofScreens.CanvassView /></ProtectedRoute>} />}

                    <Route path="/crm" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
                      <Route index element={<Home />} />
                      {/* The CRM's screens, behind its first-run wizard (crm/screens.tsx OnboardingGate). */}
                      <Route element={<Crm.OnboardingGate />}>
                        {/* Home care's first: where it and the CRM name the same path (/crm/documents, /crm/reports…) the
                            server's API is home care's for that vertical, so the page is too (crm/verticals/homecare.tsx). */}
                        {homecareScreens.routes}
                        {/* Roofing's the same way: its jobs pages are the page for its /api/jobs (crm/verticals/roof.tsx). */}
                        {roofScreens.routes}
                        {/* The store's (crm/verticals/store.tsx). */}
                        {storeScreens.routes}
                        <Route path="dashboard" element={<Crm.Dashboard />} />
                        <Route path="contacts" element={<Crm.Contacts />} />
                        <Route path="contacts/:id" element={<Crm.ContactDetail />} />
                        <Route path="jobs" element={<Crm.Jobs />} />
                        <Route path="jobs/:id" element={<Crm.JobDetail />} />
                        <Route path="quotes" element={<Crm.Quotes />} />
                        <Route path="quotes/:id" element={<Crm.QuoteDetail />} />
                        <Route path="invoices" element={<Crm.Invoices />} />
                        <Route path="invoices/:id" element={<Crm.InvoiceDetail />} />
                        <Route path="schedule" element={<Crm.Schedule />} />
                        <Route path="time" element={<Crm.Time />} />
                        <Route path="expenses" element={<Crm.Expenses />} />
                        <Route path="documents" element={<Crm.Documents />} />
                        <Route path="team" element={<Crm.Team />} />
                        <Route path="locations" element={<Crm.Locations />} />
                        <Route path="commissions" element={<Crm.Commissions />} />
                        <Route path="tech" element={<Crm.Tech />} />
                        <Route path="fleet" element={<Crm.Fleet />} />
                        <Route path="inventory" element={<Crm.Inventory />} />
                        <Route path="equipment" element={<Crm.Equipment />} />
                        <Route path="reviews" element={<Crm.Reviews />} />
                        <Route path="marketing" element={<Crm.Marketing />} />
                        <Route path="ads" element={<Crm.Ads />} />
                        <Route path="pricebook" element={<Crm.Pricebook />} />
                        <Route path="agreements" element={<Crm.Agreements />} />
                        <Route path="warranties" element={<Crm.Warranties />} />
                        <Route path="recurring" element={<Crm.Recurring />} />
                        <Route path="recurring/new" element={<Crm.RecurringEdit />} />
                        <Route path="recurring/:id/edit" element={<Crm.RecurringEdit />} />
                        <Route path="tasks" element={<Crm.Tasks />} />
                        <Route path="messages" element={<Crm.Messages />} />
                        <Route path="reports" element={<Crm.Reports />} />
                        <Route path="job-costing" element={<Crm.JobCosting />} />
                        <Route path="lead-sources" element={<Crm.LeadSources />} />
                        <Route path="email" element={<Crm.EmailInbox />} />
                        <Route path="google-reviews" element={<Crm.GoogleReviews />} />
                        <Route path="settings/email-domain" element={<Crm.EmailDomain />} />
                        <Route path="settings/email-inbox" element={<Crm.EmailInbox />} />
                        <Route path="settings/integrations" element={<Crm.Integrations />} />
                        <Route path="settings/texting" element={<Crm.Texting />} />
                        <Route path="settings/migration" element={<Crm.Migration />} />
                        <Route path="settings/import" element={<Crm.Import />} />
                        <Route path="projects" element={<ProjectsPage />} />
                        <Route path="projects/:id" element={<ProjectDetailPage />} />
                        <Route path="rfis" element={<RFIsPage />} />
                        <Route path="submittals" element={<SubmittalsPage />} />
                        <Route path="daily-logs" element={<DailyLogsPage />} />
                        <Route path="punch-lists" element={<PunchListsPage />} />
                        <Route path="inspections" element={<InspectionsPage />} />
                        <Route path="change-orders" element={<ChangeOrdersPage />} />
                        <Route path="change-orders/:changeOrderId" element={<ChangeOrdersPage />} />
                        <Route path="gantt" element={<GanttChartsPage />} />
                        <Route path="bids" element={<BidsPage />} />
                        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
                        <Route path="bills" element={<BillsPage />} />
                        <Route path="lien-waivers" element={<LienWaiversPage />} />
                        <Route path="draw-schedules" element={<DrawSchedulesPage />} />
                        <Route path="aia-forms" element={<AiaFormsPage />} />
                        <Route path="takeoffs" element={<TakeoffsPage />} />
                        <Route path="selections" element={<SelectionsPage />} />
                        <Route path="call-tracking" element={<CallTrackingPage />} />
                        <Route path="ai-receptionist" element={<AIReceptionistPage />} />
                        <Route path="support" element={<SupportPage />} />
                        <Route path="pricebook-trial" element={<PricebookTrialPage />} />
                        <Route path="visualizer" element={<VisualizerPage />} />
                        <Route path="dispatch" element={<DispatchBoard />} />
                        <Route path="pricebook-rates" element={<FlatRatePricebook />} />
                        <Route path="maintenance" element={<MaintenanceContracts />} />
                        <Route path="parts" element={<PartsInventory />} />
                        <Route path="geofences" element={<GeofencesPage />} />
                        {/* Each near-copy vertical's own screens (crm/verticals/<v>.tsx). */}
                        {basicScreens.routes}
                        {landscapingScreens.routes}
                        {barScreens.routes}
                        {restaurantScreens.routes}
                        {rvScreens.routes}
                        {/* The vet's before the salon's: both have appointments and reminders, and the vet registers its
                            pair only where the vertical's screens say book: 'practice' (VerticalScreens.book), so there
                            the first match is the vet's and everywhere else the salon's are the only ones. */}
                        {vetScreens.routes}
                        {salonScreens.routes}
                      </Route>
                      <Route path="help" element={<HelpPage />} />
                      <Route path="contact-support" element={<ContactSupportPage />} />
                      <Route path="website" element={<WebsiteOverviewPage />} />
                      <Route path="website/pages" element={<PagesListPage />} />
                      <Route path="website/pages/:slug" element={<PageEditPage />} />
                      <Route path="website/photos" element={<PhotosPage />} />
                      <Route path="website/blog" element={<ArticlesListPage kind={BLOG} />} />
                      <Route path="website/blog/:slug" element={<ArticleEditPage kind="posts" />} />
                      <Route path="website/portfolio" element={<ArticlesListPage kind={PORTFOLIO} />} />
                      <Route path="website/portfolio/:slug" element={<ArticleEditPage kind="portfolio" />} />
                      <Route path="website/settings" element={<SiteSettingsPage />} />
                      {/* The business's own web address — every business's, website-only too (the server's /api/admin/domain
                          and its Stripe return to /crm/domain always were; only a store had the screen). */}
                      <Route path="domain" element={<DomainPage />} />
                      <Route path="bookings" element={<BookingsPage />} />
                      <Route path="bookings/calendar" element={<BookingCalendarPage />} />
                      <Route path="bookings/waitlist" element={<BookingWaitlistPage />} />
                      <Route path="bookings/insights" element={<BookingInsightsPage />} />
                      <Route path="bookings/settings" element={<BookingSettingsPage />} />
                      <Route path="bookings/series/:id" element={<BookingSeriesPage />} />
                      <Route path="bookings/:id" element={<BookingDetailPage />} />
                      <Route path="leads" element={<LeadInbox />} />
                      <Route path="audit" element={<AuditLog />} />
                      <Route path="account" element={<MyAccount />} />
                      <Route path="settings" element={<Settings />} />
                      <Route path="settings/features" element={<FeaturesSettings />} />
                      <Route path="settings/billing" element={<Billing />} />
                      <Route path="settings/email" element={<EmailAliases />} />
                      <Route path="paywall" element={<Paywall />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    {/* The customer's portal, by their private link (no sign-in). A home-care agency's /portal is its
                        client portal instead, with its family portal, invoice payment, onboarding and careers pages. */}
                    {homecareScreens.isHomecare
                      ? homecareScreens.publicRoutes
                      : <Route path="/portal/:token/*" element={<Suspense fallback={null}><PortalApp /></Suspense>} />}

                    {/* A quote's or an invoice's own page, by the link in its email (no sign-in, no portal needed) — every
                        vertical, home care's included. */}
                    <Route path="/d/:token" element={<Suspense fallback={null}><DocumentLinkApp /></Suspense>} />

                    {/* A vendor's portal, by their private link (no sign-in, no shell). */}
                    <Route path="/vendor/:token" element={<VendorPortalPage />} />

                    <Route path="*" element={<Navigate to={HOME} replace />} />
                  </Routes>
                  <PhotoPickerModal />
                </PhotoPickerProvider>
              </ConfirmProvider>
            </ToastProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
