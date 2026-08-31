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
import NotFoundPage from './pages/NotFoundPage';
import PricingPage from './pages/public/PricingPage';
import SignupPage from './pages/public/SignupPage';
import SignupSuccessPage from './pages/public/SignupSuccessPage';
import SelfHostedPurchasePage from './pages/public/SelfHostedPurchasePage';
import BillingSettingsPage from './pages/settings/BillingSettingsPage';
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
import InvoicesPage from './pages/InvoicesPage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';
import PaywallPage from './pages/PaywallPage';
import DocumentsPage from './pages/DocumentsPage';

// Feature pages
import MarketingPage from './pages/marketing/MarketingPage';
import BookingsPage from './pages/booking/BookingsPage';
import { AIReceptionistPage } from './components/features/AIReceptionistPage';
import MessagesPage from './pages/messages/MessagesPage';
import ReportsDashboard from './pages/reports/ReportsDashboard';
import SupportPage from './pages/support/SupportPage';
import ReviewsPage from './pages/reviews/ReviewsPage';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';
import HelpPage from './pages/help/HelpPage';
import AdsPage from './pages/ads/AdsPage';
import OnboardingWizard from './pages/OnboardingWizard';
import ContactSupportPage from './pages/support/ContactSupportPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';
import InvoiceDetailPage from './components/detail/InvoiceDetailPage';

// Layout
import AppLayout from './components/layout/AppLayout';
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage, GbpReviewsPage } from './shared';

// Portal
import { PortalProvider } from './contexts/PortalContext';
import {
  PortalLayout,
  PortalDashboard,
  PortalInvoices,
  PortalPaymentMethods,
  PortalInvoiceDetail,
  PortalMessages,
} from './components/portal';


/** Redirects to onboarding wizard if the company hasn't completed it yet. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { company } = useAuth();
  if (company && company.settings?.onboardingComplete !== true) {
    return <Navigate to="/crm/onboarding" replace />;
  }
  return <>{children}</>;
}

// Gate optional modules by feature flag: a direct URL to a disabled module bounces
// to the dashboard instead of rendering it.
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

                  {/* CRM — full restaurant / events management interface */}
                  <Route path="/crm" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
                    <Route index element={<EventsDashboardPage />} />
                    <Route path="events" element={<EventsPage />} />
                    <Route path="events/:id" element={<EventDetailPage />} />
                    <Route path="spaces" element={<SpacesPage />} />
                    <Route path="menus" element={<MenusPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="marketing" element={<MarketingPage />} />
                    <Route path="bookings" element={<BookingsPage />} />
                    <Route path="ai-receptionist" element={<AIReceptionistPage />} />
                    <Route path="messages" element={<MessagesPage />} />
                    <Route path="reports" element={<FeatureGate feature="reports"><ReportsDashboard /></FeatureGate>} />
                    <Route path="reviews" element={<ReviewsPage />} />
                    <Route path="leads" element={<LeadInboxPage />} />
                    <Route path="lead-sources" element={<LeadSourcesPage />} />
                    <Route path="ads" element={<AdsPage />} />
                    <Route path="support" element={<SupportPage />} />
                    <Route path="help" element={<HelpPage />} />
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
                  </Route>

                  {/* Client Portal (public, token-based auth) */}
                  <Route path="/portal/:token" element={<PortalProvider><PortalLayout /></PortalProvider>}>
                    <Route index element={<PortalDashboard />} />
                    <Route path="invoices" element={<PortalInvoices />} />
                    <Route path="invoices/:invoiceId" element={<PortalInvoiceDetail />} />
                    <Route path="payment-methods" element={<PortalPaymentMethods />} />
                    <Route path="messages" element={<PortalMessages />} />
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
