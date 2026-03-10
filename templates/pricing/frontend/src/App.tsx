import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import QuotesListPage from './pages/QuotesListPage'

// Phase 1 pages
import QuoteNewPage from './pages/QuoteNewPage'
import QuoteBuilderPage from './pages/QuoteBuilderPage'
import PresentModePage from './pages/PresentModePage'
import SignaturePage from './pages/SignaturePage'
import PaymentPage from './pages/PaymentPage'
import CommissionsPage from './pages/CommissionsPage'
import CustomerQuotePage from './pages/CustomerQuotePage'

// Admin pages
import PricebookPage from './pages/admin/PricebookPage'
import RepsPage from './pages/admin/RepsPage'
import AnalyticsPage from './pages/admin/AnalyticsPage'
import ContractsPage from './pages/admin/ContractsPage'
import PromotionsPage from './pages/admin/PromotionsPage'
import TerritoriesPage from './pages/admin/TerritoriesPage'
import FinancingPage from './pages/admin/FinancingPage'
import SettingsPage from './pages/admin/SettingsPage'
import ImportPage from './pages/admin/ImportPage'

// Phase 2 — Estimator
import EstimatorNewPage from './pages/estimator/EstimatorNewPage'
import EstimatorBuilderPage from './pages/estimator/EstimatorBuilderPage'
import EstimatorPresentPage from './pages/estimator/EstimatorPresentPage'
import EstimatorSignPage from './pages/estimator/EstimatorSignPage'
import EstimatorAdminPage from './pages/admin/EstimatorAdminPage'

// Offline
import { OfflineBanner } from './components/offline/OfflineBanner'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <OfflineBanner />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/quote/customer/:token" element={<CustomerQuotePage />} />

            {/* Protected routes */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="quote/new" element={<QuoteNewPage />} />
              <Route path="quote/:id" element={<QuoteBuilderPage />} />
              <Route path="quote/:id/present" element={<PresentModePage />} />
              <Route path="quote/:id/sign" element={<SignaturePage />} />
              <Route path="quote/:id/payment" element={<PaymentPage />} />
              <Route path="quotes" element={<QuotesListPage />} />
              <Route path="commissions" element={<CommissionsPage />} />

              {/* Estimator routes */}
              <Route path="estimator/new" element={<EstimatorNewPage />} />
              <Route path="estimator/:id" element={<EstimatorBuilderPage />} />
              <Route path="estimator/:id/present" element={<EstimatorPresentPage />} />
              <Route path="estimator/:id/sign" element={<EstimatorSignPage />} />

              {/* Admin routes */}
              <Route
                path="admin/pricebook"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <PricebookPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/reps"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <RepsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/analytics"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <AnalyticsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/contracts"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <ContractsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/promotions"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <PromotionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/territories"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <TerritoriesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/financing"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <FinancingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/estimator"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <EstimatorAdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/import"
                element={
                  <ProtectedRoute roles={['admin', 'manager']}>
                    <ImportPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/settings"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
