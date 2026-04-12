import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import AppLayout from './components/layout/AppLayout'
// Import all pages
import PipelineBoard from './pages/roofing/PipelineBoard'
import JobDetailPage from './pages/roofing/JobDetailPage'
import JobsPage from './pages/roofing/JobsPage'
import ContactsPage from './pages/roofing/ContactsPage'
import CrewsPage from './pages/roofing/CrewsPage'
import MeasurementsPage from './pages/roofing/MeasurementsPage'
import MaterialsPage from './pages/roofing/MaterialsPage'
import QuotesPage from './pages/roofing/QuotesPage'
import InvoicesPage from './pages/roofing/InvoicesPage'
import ReportsPage from './pages/roofing/ReportsPage'
import SettingsPage from './pages/settings/SettingsPage'
import EstimatorSettingsPage from './pages/settings/EstimatorSettingsPage'
import InsuranceClaimPage from './pages/roofing/InsuranceClaimPage'
import AdjusterDirectoryPage from './pages/roofing/AdjusterDirectoryPage'
import CanvassingView from './pages/roofing/CanvassingView'
import CanvassingDashboard from './pages/roofing/CanvassingDashboard'
import StormLeadsPage from './pages/roofing/StormLeadsPage'
import LeadInboxPage from './pages/leads/LeadInboxPage'
import LeadSourcesPage from './pages/leads/LeadSourcesPage'
import AIReceptionistPage from './pages/roofing/AIReceptionistPage'
import ImportPage from './pages/roofing/ImportPage'
import AdsPage from './pages/ads/AdsPage'
import RoofReportsPage from './pages/roofReports/RoofReportsPage'
import RoofReportDetail from './pages/roofReports/RoofReportDetail'
import VisualizerTrialPage from './pages/VisualizerTrialPage'
import PricebookTrialPage from './pages/PricebookTrialPage'
import EstimatorTrialPage from './pages/EstimatorTrialPage'
import BillingPricingPage from './pages/billing/PricingPage'
import EstimatorPage from './pages/EstimatorPage'
import CustomerPortal from './pages/CustomerPortal'
import LoginPage from './pages/LoginPage'
// Portal
import PortalLogin from './pages/portal/PortalLogin'
import PortalLayout from './pages/portal/PortalLayout'
import PortalDashboard from './pages/portal/PortalDashboard'
import PortalJobDetail from './pages/portal/PortalJobDetail'
import PortalInvoices from './pages/portal/PortalInvoices'
import PortalServiceRequest from './pages/portal/PortalServiceRequest'

function ProtectedRoute() {
  const { token } = useAuth()
  return token ? <Outlet /> : <Navigate to="/login" />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Portal */}
            <Route path="/portal/login" element={<PortalLogin />} />
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              <Route path="jobs/:id" element={<PortalJobDetail />} />
              <Route path="invoices" element={<PortalInvoices />} />
              <Route path="service-request" element={<PortalServiceRequest />} />
            </Route>
            {/* Customer Portal — service hub after login */}
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<CustomerPortal />} />
            </Route>
            {/* Canvassing — mobile-first, no sidebar */}
            <Route element={<ProtectedRoute />}>
              <Route path="/canvass" element={<CanvassingView />} />
            </Route>
            {/* CRM */}
            <Route element={<ProtectedRoute />}>
              <Route path="/crm" element={<AppLayout />}>
                <Route index element={<PipelineBoard />} />
                <Route path="pipeline" element={<PipelineBoard />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="jobs/:id" element={<JobDetailPage />} />
                <Route path="jobs/:id/insurance" element={<InsuranceClaimPage />} />
                <Route path="adjusters" element={<AdjusterDirectoryPage />} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="crews" element={<CrewsPage />} />
                <Route path="measurements" element={<MeasurementsPage />} />
                <Route path="materials" element={<MaterialsPage />} />
                <Route path="quotes" element={<QuotesPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="canvassing" element={<CanvassingDashboard />} />
                <Route path="storm-leads" element={<StormLeadsPage />} />
                <Route path="leads" element={<LeadInboxPage />} />
                <Route path="lead-sources" element={<LeadSourcesPage />} />
                <Route path="settings/estimator" element={<EstimatorSettingsPage />} />
                <Route path="estimator" element={<EstimatorPage />} />
                <Route path="ai-receptionist" element={<AIReceptionistPage />} />
                <Route path="ads" element={<AdsPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="roof-reports" element={<RoofReportsPage />} />
                <Route path="roof-reports/:id" element={<RoofReportDetail />} />
                <Route path="visualizer-trial" element={<VisualizerTrialPage />} />
                <Route path="pricebook-trial" element={<PricebookTrialPage />} />
                <Route path="estimator-trial" element={<EstimatorTrialPage />} />
                <Route path="billing/pricing" element={<BillingPricingPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
