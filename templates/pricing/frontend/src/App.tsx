import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import QuotesListPage from './pages/QuotesListPage'

// Lazy-load placeholder pages for routes not yet built
import { lazy, Suspense } from 'react'

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
    </div>
  )
}

// Placeholder component for pages not yet implemented
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
      <p className="text-gray-500">This page is under construction.</p>
    </div>
  )
}

// Route placeholders
const QuoteNewPage = () => <PlaceholderPage title="New Quote" />
const QuoteBuilderPage = () => <PlaceholderPage title="Quote Builder" />
const PresentModePage = () => <PlaceholderPage title="Present Mode" />
const SignaturePage = () => <PlaceholderPage title="Signature Capture" />
const PaymentPage = () => <PlaceholderPage title="Payment" />
const CommissionsPage = () => <PlaceholderPage title="Commissions" />
const PricebookPage = () => <PlaceholderPage title="Pricebook" />
const RepsPage = () => <PlaceholderPage title="Reps Management" />
const AnalyticsPage = () => <PlaceholderPage title="Analytics" />
const ContractsPage = () => <PlaceholderPage title="Contracts" />
const PromotionsPage = () => <PlaceholderPage title="Promotions" />
const TerritoriesPage = () => <PlaceholderPage title="Territories" />
const FinancingPage = () => <PlaceholderPage title="Financing" />
const SettingsPage = () => <PlaceholderPage title="Settings" />
const CustomerQuotePage = () => <PlaceholderPage title="Customer Quote View" />

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
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
