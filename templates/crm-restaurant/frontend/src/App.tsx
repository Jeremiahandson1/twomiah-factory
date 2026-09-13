import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SocketProvider } from './contexts/SocketContext';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { ErrorBoundary, ProtectedRoute, PublicRoute } from './shared';

// Pages
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CustomerPortal from './pages/CustomerPortal';
import NotFoundPage from './pages/NotFoundPage';
import IntegrationsPage from './pages/settings/IntegrationsPage';
import MigrationPage from './pages/settings/MigrationPage';
import ImportPage from './pages/settings/ImportPage';
import FeaturesSettingsPage from './pages/settings/FeaturesSettingsPage';
import EventsDashboardPage from './pages/events/DashboardPage';
import EventsPage from './pages/events/EventsPage';
import EventDetailPage from './pages/events/EventDetailPage';
import SpacesPage from './pages/events/SpacesPage';
import MenusPage from './pages/events/MenusPage';
import ContactsPage from './pages/ContactsPage';
import JobsPage from './pages/JobsPage';
import QuotesPage from './pages/QuotesPage';
import InvoicesPage from './pages/InvoicesPage';
import SchedulePage from './pages/SchedulePage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';
import PaywallPage from './pages/PaywallPage';
import DocumentsPage from './pages/DocumentsPage';

// Feature pages
import MarketingPage from './pages/marketing/MarketingPage';
import MessagesPage from './pages/messages/MessagesPage';
import ReportsDashboard from './pages/reports/ReportsDashboard';
import SupportPage from './pages/support/SupportPage';
import ReviewsPage from './pages/reviews/ReviewsPage';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';
import HelpPage from './pages/help/HelpPage';
import OnboardingWizard from './pages/OnboardingWizard';
import ContactSupportPage from './pages/support/ContactSupportPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';
import JobDetailPage from './components/detail/JobDetailPage';
import QuoteDetailPage from './components/detail/QuoteDetailPage';
import InvoiceDetailPage from './components/detail/InvoiceDetailPage';

// Layout
import AppLayout from './components/layout/AppLayout';
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage, GbpReviewsPage, BillingPage } from './shared';

// Portal
import { PortalProvider } from './contexts/PortalContext';
import {
  PortalLayout,
  PortalDashboard,
  PortalProjects,
  PortalProjectDetail,
  PortalProjectFiles,
  PortalQuotes,
  PortalQuoteDetail,
  PortalInvoices,
  PortalInvoiceDetail,
  PortalPaymentMethods,
  PortalChangeOrders,
  PortalChangeOrderDetail,
  PortalSelections,
  PortalMessages,
  PortalMyJobs,
  PortalLienWaivers,
  PortalSubmittalReview,
  PortalAssignedRfis,
  PortalSharedDocuments,
  PortalEquipment,
  PortalEquipmentDetail,
  PortalAgreements,
  PortalServiceRequest,
} from './components/portal';


/** Redirects to onboarding wizard if the company hasn't completed it yet. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { company } = useAuth();
  if (company && company.settings?.onboardingComplete !== true) {
    return <Navigate to="/crm/onboarding" replace />;
  }
  return <>{children}</>;
}

// Scope contractor/construction modules out of a tenant that doesn't have them: if
// the feature isn't enabled, a direct URL to the route bounces to the dashboard
// instead of rendering a module from a different product (H-02). The nav already
// hides these; this closes the direct-URL / stale-link path.
function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { hasFeature } = useAuth();
  if (!hasFeature(feature)) return <Navigate to="/crm" replace />;
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
                    <Route index element={<EventsDashboardPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="jobs" element={<FeatureGate feature="jobs"><JobsPage /></FeatureGate>} />
                    <Route path="jobs/:id" element={<FeatureGate feature="jobs"><JobDetailPage /></FeatureGate>} />
                    <Route path="quotes" element={<FeatureGate feature="quotes"><QuotesPage /></FeatureGate>} />
                    <Route path="quotes/:id" element={<FeatureGate feature="quotes"><QuoteDetailPage /></FeatureGate>} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="schedule" element={<SchedulePage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="contact-support" element={<ContactSupportPage />} />
                    <Route path="paywall" element={<PaywallPage />} />
                    <Route path="settings/billing" element={<BillingPage />} />
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
                    <Route path="messages" element={<MessagesPage />} />
                    <Route path="reports" element={<FeatureGate feature="reports"><ReportsDashboard /></FeatureGate>} />
                    <Route path="reviews" element={<ReviewsPage />} />
                    <Route path="leads" element={<LeadInboxPage />} />
                    <Route path="lead-sources" element={<LeadSourcesPage />} />
                    <Route path="support" element={<SupportPage />} />
                    <Route path="events" element={<EventsPage />} />
                    <Route path="events/:id" element={<EventDetailPage />} />
                    <Route path="spaces" element={<SpacesPage />} />
                    <Route path="menus" element={<MenusPage />} />
                    <Route path="help" element={<HelpPage />} />
                  </Route>

                  {/* Client Portal (public, token-based auth) */}
                  <Route path="/portal/:token" element={<PortalProvider><PortalLayout /></PortalProvider>}>
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

                  {/* Catch all */}
                  <Route path="*" element={<NotFoundPage />} />
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
