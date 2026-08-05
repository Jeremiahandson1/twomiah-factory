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
import RegisterPage from './pages/RegisterPage';
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
import FeaturesSettingsPage from './pages/settings/FeaturesSettingsPage';
import ContactsPage from './pages/ContactsPage';
import JobsPage from './pages/JobsPage';
import QuotesPage from './pages/QuotesPage';
import InvoicesPage from './pages/InvoicesPage';
import SchedulePage from './pages/SchedulePage';
import TimePage from './pages/TimePage';
import ExpensesPage from './pages/ExpensesPage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';
import PaywallPage from './pages/PaywallPage';
import DocumentsPage from './pages/DocumentsPage';

// Feature pages
import FleetPage from './pages/fleet/FleetPage';
import InventoryPage from './pages/inventory/InventoryPage';
import EquipmentPage from './pages/equipment/EquipmentPage';
import MarketingPage from './pages/marketing/MarketingPage';
import AgreementsPage from './pages/agreements/AgreementsPage';
import WarrantiesPage from './pages/warranties/WarrantiesPage';
import CallTrackingPage from './pages/calltracking/CallTrackingPage';
import { AIReceptionistPage } from './components/features/AIReceptionistPage';
import { RecurringList as RecurringListPage, RecurringForm } from './pages/recurring';
import TasksPage from './pages/tasks/TasksPage';
import MessagesPage from './pages/messages/MessagesPage';
import ReportsDashboard from './pages/reports/ReportsDashboard';
import SupportPage from './pages/support/SupportPage';
import ReviewsPage from './pages/reviews/ReviewsPage';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';
import HelpPage from './pages/help/HelpPage';
import AdsPage from './pages/ads/AdsPage';
import OnboardingWizard from './pages/OnboardingWizard';

// RV / Powersports dealership pages
import RvDashboardPage from './pages/rv/DashboardPage';
import RvInventoryPage from './pages/rv/InventoryPage';
import SalesPipelinePage from './pages/rv/SalesPipelinePage';
import AIReportsPage from './pages/rv/AIReportsPage';
import AILeadResponderPage from './pages/rv/AILeadResponderPage';
import AITradeAppraisalPage from './pages/rv/AITradeAppraisalPage';
import OEMPartsPage from './pages/rv/OEMPartsPage';
import LaborGuidePage from './pages/rv/LaborGuidePage';
import FIPage from './pages/rv/FIPage';
import DeskingPage from './pages/rv/DeskingPage';
import TitleRegPage from './pages/rv/TitleRegPage';
import FloorplanPage from './pages/rv/FloorplanPage';
import RentalsPage from './pages/rv/RentalsPage';
import AccountingPage from './pages/rv/AccountingPage';
import ServicePage from './pages/rv/ServicePage';
import AlertsPage from './pages/rv/AlertsPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';
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
  PortalQuotes,
  PortalQuoteDetail,
  PortalInvoices,
  PortalInvoiceDetail,
  PortalMessages,
  PortalMyJobs,
  PortalSharedDocuments,
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
                  <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                  <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                  <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                  {/* Customer Portal — unified hub after login */}
                  <Route path="/" element={<ProtectedRoute><CustomerPortal /></ProtectedRoute>} />

                  {/* Onboarding wizard — shown before CRM if not completed */}
                  <Route path="/crm/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />

                  {/* CRM — full business management interface */}
                  <Route path="/crm" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
                    <Route index element={<RvDashboardPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="jobs/:id" element={<JobDetailPage />} />
                    <Route path="quotes" element={<QuotesPage />} />
                    <Route path="quotes/:id" element={<QuoteDetailPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="schedule" element={<SchedulePage />} />
                    <Route path="time" element={<TimePage />} />
                    <Route path="expenses" element={<ExpensesPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="paywall" element={<PaywallPage />} />
                    <Route path="settings/billing" element={<BillingSettingsPage />} />
                    <Route path="settings/email" element={<EmailAliasesPage />} />
                    <Route path="settings/email-domain" element={<EmailDomainPage />} />
                    <Route path="settings/email-inbox" element={<InboundMessagesPage />} />
                    <Route path="email" element={<InboundMessagesPage />} />
                    <Route path="google-reviews" element={<GbpReviewsPage />} />
                    <Route path="settings/integrations" element={<IntegrationsPage />} />
                    <Route path="settings/migration" element={<MigrationPage />} />
                    <Route path="settings/features" element={<FeaturesSettingsPage />} />
                    <Route path="fleet" element={<FleetPage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    {/* RV / Powersports dealership */}
                    <Route path="units" element={<RvInventoryPage />} />
                    <Route path="sales-pipeline" element={<SalesPipelinePage />} />
                    <Route path="ai-reports" element={<AIReportsPage />} />
                    <Route path="ai-leads" element={<AILeadResponderPage />} />
                    <Route path="ai-trade" element={<AITradeAppraisalPage />} />
                    <Route path="parts-catalog" element={<OEMPartsPage />} />
                    <Route path="labor-guide" element={<LaborGuidePage />} />
                    <Route path="fi" element={<FIPage />} />
                    <Route path="desking" element={<DeskingPage />} />
                    <Route path="title-reg" element={<TitleRegPage />} />
                    <Route path="floorplan" element={<FloorplanPage />} />
                    <Route path="rentals" element={<RentalsPage />} />
                    <Route path="accounting" element={<AccountingPage />} />
                    <Route path="service" element={<ServicePage />} />
                    <Route path="alerts" element={<AlertsPage />} />
                    <Route path="equipment" element={<EquipmentPage />} />
                    <Route path="marketing" element={<MarketingPage />} />
                    <Route path="agreements" element={<AgreementsPage />} />
                    <Route path="warranties" element={<WarrantiesPage />} />
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
                    <Route path="help" element={<HelpPage />} />
                  </Route>

                  {/* Client Portal (public, token-based auth) */}
                  <Route path="/portal/:token" element={<PortalProvider><PortalLayout /></PortalProvider>}>
                    <Route index element={<PortalDashboard />} />
                    <Route path="quotes" element={<PortalQuotes />} />
                    <Route path="quotes/:quoteId" element={<PortalQuoteDetail />} />
                    <Route path="invoices" element={<PortalInvoices />} />
                    <Route path="invoices/:invoiceId" element={<PortalInvoiceDetail />} />
                    <Route path="messages" element={<PortalMessages />} />
                    {/* Service / collaborator routes */}
                    <Route path="my-jobs" element={<PortalMyJobs />} />
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
