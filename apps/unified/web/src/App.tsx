// The admin: the website's screens and the shared company screens, under /crm. The public website ('/' and every
// page of it) is the server's; this app owns /crm/*, the sign-in pages, and nothing else.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ConfirmProvider, ErrorBoundary, PermissionsProvider, ProtectedRoute, PublicRoute, ToastProvider } from './shared'
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
import * as Crm from './crm/screens'
import ProjectsPage from './crm/pages/ProjectsPage'
import ProjectDetailPage from './crm/pages/ProjectDetailPage'
import RFIsPage from './crm/pages/RFIsPage'
import SubmittalsPage from './crm/pages/SubmittalsPage'
import DailyLogsPage from './crm/pages/DailyLogsPage'
import PunchListsPage from './crm/pages/PunchListsPage'
import InspectionsPage from './crm/pages/InspectionsPage'
import ChangeOrdersPage from './crm/pages/ChangeOrdersPage'
import GanttChartsPage from './crm/pages/GanttChartsPage'
import BidsPage from './crm/pages/BidsPage'
import PurchaseOrdersPage from './crm/pages/PurchaseOrdersPage'
import BillsPage from './crm/pages/BillsPage'
import LienWaiversPage from './crm/pages/LienWaiversPage'
import DrawSchedulesPage from './crm/pages/DrawSchedulesPage'
import AiaFormsPage from './crm/pages/AiaFormsPage'
import {
  PortalLayout, PortalDashboard, PortalProjects, PortalProjectDetail, PortalProjectFiles, PortalQuotes, PortalQuoteDetail, PortalInvoices,
  PortalInvoiceDetail, PortalPaymentMethods, PortalChangeOrders, PortalChangeOrderDetail, PortalSelections, PortalMessages, PortalMyJobs,
  PortalLienWaivers, PortalSubmittalReview, PortalAssignedRfis, PortalSharedDocuments, PortalEquipment, PortalEquipmentDetail,
  PortalAgreements, PortalServiceRequest,
} from './shared'

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
                <PhotoPickerProvider>
                  <Routes>
                    <Route path="/login" element={<PublicRoute home={HOME}><Login /></PublicRoute>} />
                    <Route path="/forgot-password" element={<PublicRoute home={HOME}><ForgotPassword /></PublicRoute>} />
                    {/* Not behind PublicRoute: an invite or reset link opened while signed in must still show its form. */}
                    <Route path="/reset-password" element={<ResetPassword />} />

                    <Route path="/crm" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
                      <Route index element={<Home />} />
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
                      <Route path="website" element={<WebsiteOverviewPage />} />
                      <Route path="website/pages" element={<PagesListPage />} />
                      <Route path="website/pages/:slug" element={<PageEditPage />} />
                      <Route path="website/photos" element={<PhotosPage />} />
                      <Route path="website/blog" element={<ArticlesListPage kind={BLOG} />} />
                      <Route path="website/blog/:slug" element={<ArticleEditPage kind="posts" />} />
                      <Route path="website/portfolio" element={<ArticlesListPage kind={PORTFOLIO} />} />
                      <Route path="website/portfolio/:slug" element={<ArticleEditPage kind="portfolio" />} />
                      <Route path="website/settings" element={<SiteSettingsPage />} />
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

                    {/* The customer's portal, by their private link (no sign-in). */}
                    <Route path="/portal/:token" element={<Crm.Portal><PortalLayout /></Crm.Portal>}>
                      <Route index element={<PortalDashboard />} />
                      <Route path="projects" element={<PortalProjects />} />
                      <Route path="projects/:projectId" element={<PortalProjectDetail />} />
                      <Route path="projects/:projectId/files" element={<PortalProjectFiles />} />
                      <Route path="quotes" element={<PortalQuotes />} />
                      <Route path="quotes/:quoteId" element={<PortalQuoteDetail />} />
                      <Route path="invoices" element={<PortalInvoices />} />
                      <Route path="invoices/:invoiceId" element={<PortalInvoiceDetail />} />
                      <Route path="payment-methods" element={<PortalPaymentMethods />} />
                      <Route path="change-orders" element={<PortalChangeOrders />} />
                      <Route path="change-orders/:changeOrderId" element={<PortalChangeOrderDetail />} />
                      <Route path="selections" element={<PortalSelections />} />
                      <Route path="messages" element={<PortalMessages />} />
                      <Route path="my-jobs" element={<PortalMyJobs />} />
                      <Route path="lien-waivers" element={<PortalLienWaivers />} />
                      <Route path="submittal-review" element={<PortalSubmittalReview />} />
                      <Route path="rfis-assigned" element={<PortalAssignedRfis />} />
                      <Route path="shared-documents" element={<PortalSharedDocuments />} />
                      <Route path="equipment" element={<PortalEquipment />} />
                      <Route path="equipment/:equipmentId" element={<PortalEquipmentDetail />} />
                      <Route path="agreements" element={<PortalAgreements />} />
                      <Route path="service-request" element={<PortalServiceRequest />} />
                    </Route>

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
