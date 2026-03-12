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
                <Route path="settings/estimator" element={<EstimatorSettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/crm" />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
