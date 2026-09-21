import NotFoundPage from './pages/NotFoundPage'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import AppLayout from './components/layout/AppLayout'
import OnboardingWizard from './pages/OnboardingWizard'
import type { ReactNode } from 'react'
import PaywallPage from './pages/PaywallPage'
import { isTrialExpired, isTrialBypassPath } from './components/auth/trialStatus'
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
import FeaturesSettingsPage from './pages/settings/FeaturesSettingsPage'
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage, GbpReviewsPage, BillingPage } from './shared'
import InsuranceClaimPage from './pages/roofing/InsuranceClaimPage'
import AdjusterDirectoryPage from './pages/roofing/AdjusterDirectoryPage'
import CanvassingView from './pages/roofing/CanvassingView'
import CanvassingDashboard from './pages/roofing/CanvassingDashboard'
import StormLeadsPage from './pages/roofing/StormLeadsPage'
import ReviewsPage from './pages/roofing/ReviewsPage'
import FinancingPage from './pages/roofing/FinancingPage'
import StormRadarPage from './pages/roofing/StormRadarPage'
import LeadInboxPage from './pages/leads/LeadInboxPage'
import LeadSourcesPage from './pages/leads/LeadSourcesPage'
import AIReceptionistPage from './pages/roofing/AIReceptionistPage'
import DocumentsPage from './pages/DocumentsPage'
import ImportPage from './pages/roofing/ImportPage'
import AdsPage from './pages/ads/AdsPage'
import RoofReportsPage from './pages/roofReports/RoofReportsPage'
import RoofReportDetail from './pages/roofReports/RoofReportDetail'
import VisualizerTrialPage from './pages/VisualizerTrialPage'
import PricebookTrialPage from './pages/PricebookTrialPage'
import EstimatorTrialPage from './pages/EstimatorTrialPage'
import EstimatorPage from './pages/EstimatorPage'
import CustomerPortal from './pages/CustomerPortal'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
// Portal
import PortalLogin from './pages/portal/PortalLogin'
import PortalLayout from './pages/portal/PortalLayout'
import PortalDashboard from './pages/portal/PortalDashboard'
import PortalJobDetail from './pages/portal/PortalJobDetail'
import PortalQuotes from './pages/portal/PortalQuotes'
import PortalInvoices from './pages/portal/PortalInvoices'
import PortalServiceRequest from './pages/portal/PortalServiceRequest'
import ContactSupportPage from './pages/support/ContactSupportPage'

/** Sends fresh tenants to the onboarding wizard until it's completed.
 *  Gate reads company.onboardingCompletedAt (set by POST /api/onboarding/complete);
 *  /api/auth/me returns the full company row, so a page load refreshes it. */
function OnboardingGate({ children }: { children: ReactNode }) {
  const { company } = useAuth()
  if (company && !(company as any).onboardingCompletedAt) {
    return <Navigate to="/crm/onboarding" replace />
  }
  return <>{children}</>
}

/**
 * A route for a module the tenant has not switched on sends them to the dashboard.
 *
 * The nav already hides these, and the API already refuses them — but the ROUTE rendered anyway, so
 * a direct URL or a stale link opened a module the tenant does not have and then filled it with 403s.
 * That was the third side of the same gate: API, nav, and the route itself. (roof T18 M7)
 *
 * Not the paywall page — that is the hard lock for an expired trial, a different thing from a module
 * that simply is not part of this plan. Same shape crm-restaurant already uses.
 */
function FeatureRoute({ feature, children }: { feature: string; children: ReactNode }) {
  const { company, hasFeature } = useAuth()
  // Wait for the answer before acting on it. `company` arrives from /api/auth/me a moment after mount,
  // and until it does hasFeature() says false for EVERYTHING — so on a hard page load (a refresh, a
  // bookmark, a link out of an email) this redirected the tenant away from a module they own, before
  // the answer had arrived, and `replace` meant Back could not undo it. Insurance and Adjusters were
  // unreachable that way on a tenant with insurance_workflow switched on. OnboardingGate above already
  // waits on `company` for exactly this reason. Rendering nothing for that moment is the safe side:
  // rendering the children instead would flash a module the tenant may not have and 403 its API calls.
  if (!company) return null
  if (!hasFeature(feature)) return <Navigate to="/crm" replace />
  return <>{children}</>
}

function ProtectedRoute() {
  const { token, company } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to="/login" />
  // Hard-lock on trial expiry — bypass allowed for paywall + upgrade path + logout
  if (isTrialExpired(company as any) && !isTrialBypassPath(location.pathname)) {
    return <Navigate to="/crm/paywall" replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Portal */}
            <Route path="/portal/login" element={<PortalLogin />} />
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              {/* the nav and dashboard tiles have always linked here */}
              <Route path="dashboard" element={<PortalDashboard />} />
              <Route path="jobs" element={<PortalDashboard />} />
              <Route path="jobs/:id" element={<PortalJobDetail />} />
              <Route path="quotes" element={<PortalQuotes />} />
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
            {/* Onboarding wizard — shown before the CRM until completed */}
            <Route element={<ProtectedRoute />}>
              <Route path="/crm/onboarding" element={<OnboardingWizard />} />
            </Route>
            {/* CRM */}
            <Route element={<ProtectedRoute />}>
              <Route path="/crm" element={<OnboardingGate><AppLayout /></OnboardingGate>}>
                <Route index element={<PipelineBoard />} />
                <Route path="pipeline" element={<PipelineBoard />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="jobs/:id" element={<JobDetailPage />} />
                <Route path="jobs/:id/insurance" element={<FeatureRoute feature="insurance_workflow"><InsuranceClaimPage /></FeatureRoute>} />
                <Route path="adjusters" element={<FeatureRoute feature="insurance_workflow"><AdjusterDirectoryPage /></FeatureRoute>} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="crews" element={<CrewsPage />} />
                <Route path="measurements" element={<MeasurementsPage />} />
                <Route path="materials" element={<FeatureRoute feature="materials"><MaterialsPage /></FeatureRoute>} />
                <Route path="quotes" element={<QuotesPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="contact-support" element={<ContactSupportPage />} />
                <Route path="canvassing" element={<FeatureRoute feature="canvassing_tool"><CanvassingDashboard /></FeatureRoute>} />
                <Route path="storm-leads" element={<FeatureRoute feature="storm_lead_gen"><StormLeadsPage /></FeatureRoute>} />
                <Route path="leads" element={<FeatureRoute feature="lead_inbox"><LeadInboxPage /></FeatureRoute>} />
                <Route path="lead-sources" element={<FeatureRoute feature="lead_inbox"><LeadSourcesPage /></FeatureRoute>} />
                <Route path="settings/estimator" element={<EstimatorSettingsPage />} />
                <Route path="settings/features" element={<FeaturesSettingsPage />} />
                <Route path="settings/email" element={<EmailAliasesPage />} />
                <Route path="settings/email-domain" element={<EmailDomainPage />} />
                <Route path="settings/billing" element={<BillingPage smsBilling />} />
                <Route path="settings/email-inbox" element={<InboundMessagesPage />} />
                <Route path="email" element={<InboundMessagesPage />} />
                {/* Google Business Profile, not the review-request module. This page calls /api/gbp only, and the
                    nav row beside it has always gated on google_business — M7 gated the ROUTE on google_reviews,
                    so a tenant with GBP on and review requests off saw the sidebar link and got bounced by it.
                    /crm/reviews below is the other one, and it really is google_reviews. (roof T18) */}
                <Route path="google-reviews" element={<FeatureRoute feature="google_business"><GbpReviewsPage /></FeatureRoute>} />
                <Route path="estimator" element={<EstimatorPage />} />
                <Route path="ai-receptionist" element={<FeatureRoute feature="ai_receptionist"><AIReceptionistPage /></FeatureRoute>} />
                <Route path="ads" element={<AdsPage />} />
                <Route path="documents" element={<FeatureRoute feature="documents"><DocumentsPage /></FeatureRoute>} />
                <Route path="import" element={<ImportPage />} />
                <Route path="roof-reports" element={<FeatureRoute feature="measurement_reports"><RoofReportsPage /></FeatureRoute>} />
                <Route path="roof-reports/:id" element={<FeatureRoute feature="measurement_reports"><RoofReportDetail /></FeatureRoute>} />
                <Route path="visualizer-trial" element={<VisualizerTrialPage />} />
                <Route path="pricebook-trial" element={<PricebookTrialPage />} />
                <Route path="estimator-trial" element={<EstimatorTrialPage />} />
                <Route path="reviews" element={<FeatureRoute feature="google_reviews"><ReviewsPage /></FeatureRoute>} />
                <Route path="financing" element={<FeatureRoute feature="consumer_financing"><FinancingPage /></FeatureRoute>} />
                <Route path="storm-radar" element={<FeatureRoute feature="storm_radar_overlay"><StormRadarPage /></FeatureRoute>} />
                <Route path="paywall" element={<PaywallPage />} />
              </Route>
            </Route>
            {/* L4: this used to Navigate to "/", which for a signed-out visitor lands on the login
                screen — a typo or stale bookmark read as an unexpected sign-out. */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
