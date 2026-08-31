import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SocketProvider } from './contexts/SocketContext';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { ProtectedRoute, PublicRoute } from './components/auth/ProtectedRoute';
import ErrorBoundary from './components/common/ErrorBoundary';

// Pages
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CustomerPortal from './pages/CustomerPortal';
import PricingPage from './pages/public/PricingPage';
import SignupPage from './pages/public/SignupPage';
import SignupSuccessPage from './pages/public/SignupSuccessPage';
import SelfHostedPurchasePage from './pages/public/SelfHostedPurchasePage';
import BillingSettingsPage from './pages/settings/BillingSettingsPage';
import IntegrationsPage from './pages/settings/IntegrationsPage';
import MigrationPage from './pages/settings/MigrationPage';
import ImportPage from './pages/settings/ImportPage';
import FeaturesSettingsPage from './pages/settings/FeaturesSettingsPage';
import DashboardPage from './pages/DashboardPage';
import VetDashboardPage from './pages/vet/DashboardPage';
import PatientsPage from './pages/vet/PatientsPage';
import PatientDetailPage from './pages/vet/PatientDetailPage';
import AppointmentsPage from './pages/vet/AppointmentsPage';
import RemindersPage from './pages/vet/RemindersPage';
import WellnessPlansPage from './pages/vet/WellnessPlansPage';
import ContactsPage from './pages/ContactsPage';
import ProjectsPage from './pages/ProjectsPage';
import JobsPage from './pages/JobsPage';
import QuotesPage from './pages/QuotesPage';
import InvoicesPage from './pages/InvoicesPage';
import SchedulePage from './pages/SchedulePage';
import TimePage from './pages/TimePage';
import ExpensesPage from './pages/ExpensesPage';
import TeamPage from './pages/TeamPage';
import RFIsPage from './pages/RFIsPage';
import ChangeOrdersPage from './pages/ChangeOrdersPage';
import PunchListsPage from './pages/PunchListsPage';
import DailyLogsPage from './pages/DailyLogsPage';
import InspectionsPage from './pages/InspectionsPage';
import BidsPage from './pages/BidsPage';
import SubmittalsPage from './pages/SubmittalsPage';
import LienWaiversPage from './pages/LienWaiversPage';
import DrawSchedulesPage from './pages/DrawSchedulesPage';
import AiaFormsPage from './pages/AiaFormsPage';
import GanttChartsPage from './pages/GanttChartsPage';
import SettingsPage from './pages/SettingsPage';
import PaywallPage from './pages/PaywallPage';
import DocumentsPage from './pages/DocumentsPage';

// Feature pages
import FleetPage from './pages/fleet/FleetPage';
import InventoryPage from './pages/inventory/InventoryPage';
import EquipmentPage from './pages/equipment/EquipmentPage';
import MarketingPage from './pages/marketing/MarketingPage';
import BookingsPage from './pages/booking/BookingsPage';
import PricebookPage from './pages/pricebook/PricebookPage';
import AgreementsPage from './pages/agreements/AgreementsPage';
import WarrantiesPage from './pages/warranties/WarrantiesPage';
import CallTrackingPage from './pages/calltracking/CallTrackingPage';
import { AIReceptionistPage } from './components/features/AIReceptionistPage';
import { RecurringList as RecurringListPage, RecurringForm } from './pages/recurring';
import TakeoffsPage from './pages/takeoffs/TakeoffsPage';
import TasksPage from './pages/tasks/TasksPage';
import MessagesPage from './pages/messages/MessagesPage';
import ReportsDashboard from './pages/reports/ReportsDashboard';
import SelectionsPage from './pages/selections/SelectionsPage';
import SupportPage from './pages/support/SupportPage';
import ReviewsPage from './pages/reviews/ReviewsPage';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';
import HelpPage from './pages/help/HelpPage';
import AdsPage from './pages/ads/AdsPage';
import PricebookTrialPage from './pages/PricebookTrialPage';
import RoofReportsPage from './pages/roofReports/RoofReportsPage';
import RoofReportDetail from './pages/roofReports/RoofReportDetail';
import OnboardingWizard from './pages/OnboardingWizard';
import ContactSupportPage from './pages/support/ContactSupportPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';
import ProjectDetailPage from './components/detail/ProjectDetailPage';
import JobDetailPage from './components/detail/JobDetailPage';
import QuoteDetailPage from './components/detail/QuoteDetailPage';
import InvoiceDetailPage from './components/detail/InvoiceDetailPage';

// Layout
import AppLayout from './components/layout/AppLayout';
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage, GbpReviewsPage } from './shared';

// Portal
import { PortalProvider } from './contexts/PortalContext';
import {
  PortalLayout,
  PortalDashboard,
  PortalProjects,
  PortalProjectDetail,
  PortalQuotes,
  PortalQuoteDetail,
  PortalInvoices,
  PortalPaymentMethods,
  PortalInvoiceDetail,
  PortalChangeOrders,
  PortalChangeOrderDetail,
  PortalSelections,
  PortalMessages,
  PortalMyJobs,
  PortalLienWaivers,
  PortalSubmittalReview,
  PortalSharedDocuments,
  PortalAssignedRfis,
  PortalProjectFiles,
} from './components/portal';


/** Redirects to onboarding wizard if the company hasn't completed it yet. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { company } = useAuth();
  if (company && company.settings?.onboardingComplete !== true) {
    return <Navigate to="/crm/onboarding" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <ToastProvider>
              <SocketProvider>
                <Routes>
                  {/* Public marketing pages */}
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/signup/success" element={<SignupSuccessPage />} />
                  <Route path="/self-hosted" element={<SelfHostedPurchasePage />} />

                  {/* Public auth routes */}
                  <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                  <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                  <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                  {/* Customer Portal — unified hub after login */}
                  <Route path="/" element={<ProtectedRoute><CustomerPortal /></ProtectedRoute>} />

                  {/* Onboarding wizard — shown before CRM if not completed */}
                  <Route path="/crm/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />

                  {/* CRM — full business management interface */}
                  <Route path="/crm" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
                    <Route index element={<VetDashboardPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="contact-support" element={<ContactSupportPage />} />
                    <Route path="paywall" element={<PaywallPage />} />
                    <Route path="settings/billing" element={<BillingSettingsPage />} />
                    <Route path="settings/email" element={<EmailAliasesPage />} />
                    <Route path="settings/email-domain" element={<EmailDomainPage />} />
                    <Route path="settings/email-inbox" element={<InboundMessagesPage />} />
                    <Route path="email" element={<InboundMessagesPage />} />
                    <Route path="google-reviews" element={<GbpReviewsPage />} />
                    <Route path="settings/integrations" element={<IntegrationsPage />} />
                    <Route path="settings/migration" element={<MigrationPage />} />
                    <Route path="settings/import" element={<ImportPage />} />
                    <Route path="settings/features" element={<FeaturesSettingsPage />} />
                    <Route path="marketing" element={<MarketingPage />} />
                    <Route path="bookings" element={<BookingsPage />} />
                    <Route path="agreements" element={<AgreementsPage />} />
                    <Route path="call-tracking" element={<CallTrackingPage />} />
                    <Route path="ai-receptionist" element={<AIReceptionistPage />} />
                    <Route path="recurring" element={<RecurringListPage />} />
                    <Route path="recurring/new" element={<RecurringForm />} />
                    <Route path="recurring/:id/edit" element={<RecurringForm />} />
                    <Route path="tasks" element={<TasksPage />} />
                    <Route path="messages" element={<MessagesPage />} />
                    <Route path="reports" element={<ReportsDashboard />} />
                    <Route path="reviews" element={<ReviewsPage />} />
                    <Route path="leads" element={<LeadInboxPage />} />
                    <Route path="lead-sources" element={<LeadSourcesPage />} />
                    <Route path="support" element={<SupportPage />} />
                    <Route path="ads" element={<AdsPage />} />
                    <Route path="patients" element={<PatientsPage />} />
                    <Route path="patients/:id" element={<PatientDetailPage />} />
                    <Route path="appointments" element={<AppointmentsPage />} />
                    <Route path="reminders" element={<RemindersPage />} />
                    <Route path="wellness-plans" element={<WellnessPlansPage />} />
                    <Route path="help" element={<HelpPage />} />
                  </Route>

                  {/* Client Portal (public, token-based auth) */}
                  <Route path="/portal/:token" element={<PortalProvider><PortalLayout /></PortalProvider>}>
                    <Route index element={<PortalDashboard />} />
                    <Route path="invoices" element={<PortalInvoices />} />
                    <Route path="payment-methods" element={<PortalPaymentMethods />} />
                    <Route path="invoices/:invoiceId" element={<PortalInvoiceDetail />} />
                    <Route path="messages" element={<PortalMessages />} />
                    {/* Collaborator routes (subs, architects, consultants) */}
                    <Route path="shared-documents" element={<PortalSharedDocuments />} />
                  </Route>

                  {/* Catch all */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </SocketProvider>
            </ToastProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
