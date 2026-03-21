import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { UserProvider } from './contexts/UserContext'
import LoginPage from './pages/LoginPage'
import CareSignupPage from './pages/CareSignupPage'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import FactoryPage from './pages/FactoryPage'
import SupportPage from './pages/SupportPage'
import AnalyticsPage from './pages/AnalyticsPage'
import SettingsPage from './pages/SettingsPage'
import PricingAdminPage from './pages/PricingAdminPage'
import RoofReviewPage from './pages/RoofReviewPage'
import AppLayout from './components/AppLayout'
import RequireRole from './components/RequireRole'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    }).catch(() => setLoading(false))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-screen bg-gray-950 text-white">Loading...</div>

  return (
    <UserProvider session={session}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/" />} />
          <Route path="/care/signup" element={<CareSignupPage />} />
          <Route path="/signup/:product" element={<FactoryPage />} />
          <Route path="/" element={session ? <AppLayout /> : <Navigate to="/login" />}>
            <Route index element={<DashboardPage />} />
            <Route path="tenants" element={<TenantsPage />} />
            <Route path="tenants/:id" element={<CustomerDetailPage />} />
            <Route path="factory" element={<RequireRole allowed={['owner', 'admin', 'editor']}><FactoryPage /></RequireRole>} />
            <Route path="support" element={<SupportPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="pricing" element={<RequireRole allowed={['owner', 'admin']}><PricingAdminPage /></RequireRole>} />
            <Route path="roof-review" element={<RequireRole allowed={['owner', 'admin']}><RoofReviewPage /></RequireRole>} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </UserProvider>
  )
}
