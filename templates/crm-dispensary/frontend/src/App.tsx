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

// New feature pages
import MetrcPage from './pages/MetrcPage';
import LabelsPage from './pages/LabelsPage';
import CompliancePage from './pages/CompliancePage';
import LocationsPage from './pages/LocationsPage';
import BatchesPage from './pages/BatchesPage';
import RFIDPage from './pages/RFIDPage';
import TrackingPage from './pages/TrackingPage';
import KioskPage from './pages/KioskPage';
import KioskOrderPage from './pages/KioskOrderPage';
import RecommendationsPage from './pages/RecommendationsPage';
import ReferralsPage from './pages/ReferralsPage';
import ReportsPage from './pages/ReportsPage';
import CultivationPage from './pages/CultivationPage';
import ManufacturingPage from './pages/ManufacturingPage';
import WholesalePage from './pages/WholesalePage';
import WebsiteAnalyticsPage from './pages/WebsiteAnalyticsPage';
import EnterprisePage from './pages/EnterprisePage';

// Phase 2 feature pages
import CheckinPage from './pages/CheckinPage';
import IDScannerPage from './pages/IDScannerPage';
import BioTrackPage from './pages/BioTrackPage';
import PayByBankPage from './pages/PayByBankPage';
import AIBudtenderPage from './pages/AIBudtenderPage';
import GamifiedLoyaltyPage from './pages/GamifiedLoyaltyPage';
import SEOPagesPage from './pages/SEOPagesPage';
import PredictiveInventoryPage from './pages/PredictiveInventoryPage';
import SignagePage from './pages/SignagePage';
import CurbsidePage from './pages/CurbsidePage';
import EquivalencyPage from './pages/EquivalencyPage';
import TaxFilingPage from './pages/TaxFilingPage';
import MarketplacePage from './pages/MarketplacePage';
import PlatformPage from './pages/PlatformPage';
import SecurityPage from './pages/SecurityPage';
import SOC2DashboardPage from './pages/SOC2DashboardPage';
import GrowInputsPage from './pages/GrowInputsPage';
import QRScannerPage from './pages/QRScannerPage';
import SchedulingPage from './pages/SchedulingPage';
import TrainingPage from './pages/TrainingPage';
import FraudDetectionPage from './pages/FraudDetectionPage';
import ApprovalsPage from './pages/ApprovalsPage';
import OfflinePage from './pages/OfflinePage';
import EODReportPage from './pages/EODReportPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import MenuSyncPage from './pages/MenuSyncPage';

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

                    {/* New feature routes */}
                    <Route path="metrc" element={<MetrcPage />} />
                    <Route path="labels" element={<LabelsPage />} />
                    <Route path="compliance" element={<CompliancePage />} />
                    <Route path="locations" element={<LocationsPage />} />
                    <Route path="batches" element={<BatchesPage />} />
                    <Route path="rfid" element={<RFIDPage />} />
                    <Route path="tracking" element={<TrackingPage />} />
                    <Route path="kiosk" element={<KioskPage />} />
                    <Route path="recommendations" element={<RecommendationsPage />} />
                    <Route path="referrals" element={<ReferralsPage />} />
                    <Route path="reports" element={<ReportsPage />} />
                    <Route path="cultivation" element={<CultivationPage />} />
                    <Route path="manufacturing" element={<ManufacturingPage />} />
                    <Route path="wholesale" element={<WholesalePage />} />
                    <Route path="website-analytics" element={<WebsiteAnalyticsPage />} />
                    <Route path="enterprise" element={<EnterprisePage />} />

                    {/* Phase 2 feature routes */}
                    <Route path="checkin" element={<CheckinPage />} />
                    <Route path="id-scanner" element={<IDScannerPage />} />
                    <Route path="biotrack" element={<BioTrackPage />} />
                    <Route path="pay-by-bank" element={<PayByBankPage />} />
                    <Route path="ai-budtender" element={<AIBudtenderPage />} />
                    <Route path="gamified-loyalty" element={<GamifiedLoyaltyPage />} />
                    <Route path="seo-pages" element={<SEOPagesPage />} />
                    <Route path="predictive-inventory" element={<PredictiveInventoryPage />} />
                    <Route path="signage" element={<SignagePage />} />
                    <Route path="curbside" element={<CurbsidePage />} />
                    <Route path="equivalency" element={<EquivalencyPage />} />
                    <Route path="tax-filing" element={<TaxFilingPage />} />
                    <Route path="marketplace" element={<MarketplacePage />} />
                    <Route path="platform" element={<PlatformPage />} />
                    <Route path="security" element={<SecurityPage />} />
                    <Route path="soc2" element={<SOC2DashboardPage />} />
                    <Route path="grow-inputs" element={<GrowInputsPage />} />
                    <Route path="qr-scanner" element={<QRScannerPage />} />
                    <Route path="scheduling" element={<SchedulingPage />} />
                    <Route path="training" element={<TrainingPage />} />
                    <Route path="fraud-detection" element={<FraudDetectionPage />} />
                    <Route path="approvals" element={<ApprovalsPage />} />
                    <Route path="offline" element={<OfflinePage />} />
                    <Route path="eod" element={<EODReportPage />} />
                    <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
                    <Route path="menu-sync" element={<MenuSyncPage />} />
                  </Route>

                  {/* Kiosk mode — standalone fullscreen interface (no auth) */}
                  <Route path="/kiosk" element={<KioskOrderPage />} />

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
