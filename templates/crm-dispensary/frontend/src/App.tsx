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
import PricingPage from './pages/billing/PricingPage';
import SignupPage from './pages/public/SignupPage';
import SignupSuccessPage from './pages/public/SignupSuccessPage';
import SelfHostedPurchasePage from './pages/public/SelfHostedPurchasePage';
import OnboardingWizard from './pages/OnboardingWizard';

// CRM Pages
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import ProductDetailPage from './pages/ProductDetailPage';
import OrdersPage from './pages/OrdersPage';
import POSPage from './pages/POSPage';
import OrderDetailPage from './pages/OrderDetailPage';
import CustomersPage from './pages/CustomersPage';
import ContactDetailPage from './components/detail/ContactDetailPage';
import LoyaltyPage from './pages/LoyaltyPage';
import DeliveryPage from './pages/DeliveryPage';
import MerchStorePage from './pages/MerchStorePage';
import AnalyticsPage from './pages/AnalyticsPage';
import CashPage from './pages/CashPage';
import AuditLogPage from './pages/AuditLogPage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';

// Layout
import AppLayout from './components/layout/AppLayout';

// Settings sub-pages
import BillingSettingsPage from './pages/settings/BillingSettingsPage';
import IntegrationsPage from './pages/settings/IntegrationsPage';


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

                  {/* CRM — dispensary management interface */}
                  <Route path="/crm" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="products" element={<ProductsPage />} />
                    <Route path="products/:id" element={<ProductDetailPage />} />
                    <Route path="orders" element={<OrdersPage />} />
                    <Route path="orders/new" element={<POSPage />} />
                    <Route path="orders/:id" element={<OrderDetailPage />} />
                    <Route path="customers" element={<CustomersPage />} />
                    <Route path="customers/:id" element={<ContactDetailPage />} />
                    <Route path="loyalty" element={<LoyaltyPage />} />
                    <Route path="delivery" element={<DeliveryPage />} />
                    <Route path="merch" element={<MerchStorePage />} />
                    <Route path="analytics" element={<AnalyticsPage />} />
                    <Route path="cash" element={<CashPage />} />
                    <Route path="audit" element={<AuditLogPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="settings/billing" element={<BillingSettingsPage />} />
                    <Route path="settings/integrations" element={<IntegrationsPage />} />
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
