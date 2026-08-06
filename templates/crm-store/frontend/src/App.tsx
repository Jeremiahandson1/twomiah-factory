import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import ProductEditPage from './pages/ProductEditPage'
import OrdersPage from './pages/OrdersPage'
import OrderDetailPage from './pages/OrderDetailPage'
import CustomersPage from './pages/CustomersPage'
import PaymentsPage from './pages/PaymentsPage'
import SuppliersPage from './pages/SuppliersPage'
import ReviewsPage from './pages/ReviewsPage'
import ShippingPage from './pages/ShippingPage'
import DiscountsPage from './pages/DiscountsPage'
import SettingsPage from './pages/SettingsPage'
import OnboardingWizard from './pages/OnboardingWizard'
import { useEffect, useState } from 'react'
import api from './services/api'
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage } from './shared'

function Protected({ children }: { children: JSX.Element }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <FullScreenSpinner />
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

/** Sends fresh stores to the onboarding wizard until it's completed.
 *  Reads store_settings.onboarding_completed_at via /api/admin/settings;
 *  the wizard's completion reloads the page so this re-fetches. */
function OnboardingGate({ children }: { children: JSX.Element }) {
  const [state, setState] = useState<'loading' | 'go' | 'onboard'>('loading')
  useEffect(() => {
    api.getSettings()
      .then(s => setState((s as any)?.onboardingCompletedAt ? 'go' : 'onboard'))
      .catch(() => setState('go')) // settings unreadable — never lock the owner out
  }, [])
  if (state === 'loading') return <FullScreenSpinner />
  if (state === 'onboard') return <Navigate to="/onboarding" replace />
  return children
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <FullScreenSpinner />
  return isAuthenticated ? <Navigate to="/" replace /> : children
}

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/onboarding" element={<Protected><OnboardingWizard /></Protected>} />
            <Route path="/" element={<Protected><OnboardingGate><AppLayout /></OnboardingGate></Protected>}>
              <Route index element={<DashboardPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="products/new" element={<ProductEditPage />} />
              <Route path="products/:id" element={<ProductEditPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="reviews" element={<ReviewsPage />} />
              <Route path="shipping" element={<ShippingPage />} />
              <Route path="discounts" element={<DiscountsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/email" element={<EmailAliasesPage />} />
              <Route path="settings/email-domain" element={<EmailDomainPage />} />
              <Route path="settings/email-inbox" element={<InboundMessagesPage />} />
              <Route path="email" element={<InboundMessagesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
