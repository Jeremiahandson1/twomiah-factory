// The admin: the website's screens and the shared company screens, under /crm. The public website ('/' and every
// page of it) is the server's; this app owns /crm/*, the sign-in pages, and nothing else.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ConfirmProvider, ErrorBoundary, PermissionsProvider, ProtectedRoute, PublicRoute, ToastProvider } from './shared'
import { api } from './api'
import {
  HOME, Shell, Home, Login, ForgotPassword, ResetPassword, Settings, FeaturesSettings, MyAccount, Billing, EmailAliases,
  LeadInbox, AuditLog, Paywall,
} from './screens'
import { PhotoPickerProvider } from './site/contexts/PhotoPickerContext'
import { PhotoPickerModal } from './site/components/PhotoPickerModal'
import { WebsiteOverviewPage } from './site/pages/WebsiteOverviewPage'
import { PagesListPage } from './site/pages/PagesListPage'
import { PageEditPage } from './site/pages/PageEditPage'
import { PhotosPage } from './site/pages/PhotosPage'
import { ArticlesListPage, BLOG, PORTFOLIO } from './site/pages/ArticlesListPage'
import { ArticleEditPage } from './site/pages/ArticleEditPage'
import { SiteSettingsPage } from './site/pages/SiteSettingsPage'
import { BookingsPage } from './booking/BookingsPage'
import { BookingDetailPage } from './booking/BookingDetailPage'
import { BookingCalendarPage } from './booking/BookingCalendarPage'
import { BookingSettingsPage } from './booking/BookingSettingsPage'
import { BookingInsightsPage, BookingWaitlistPage, BookingSeriesPage } from './booking/BookingExtrasPages'

function NotFound() {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center card card-padding">
      <h1 className="text-xl font-semibold text-ink mb-2">There's no page here</h1>
      <p className="text-sm text-muted">Everything you can use is in the menu.</p>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider api={api}>
          <PermissionsProvider>
            <ToastProvider>
              <ConfirmProvider>
                <PhotoPickerProvider>
                  <Routes>
                    <Route path="/login" element={<PublicRoute home={HOME}><Login /></PublicRoute>} />
                    <Route path="/forgot-password" element={<PublicRoute home={HOME}><ForgotPassword /></PublicRoute>} />
                    {/* Not behind PublicRoute: an invite or reset link opened while signed in must still show its form. */}
                    <Route path="/reset-password" element={<ResetPassword />} />

                    <Route path="/crm" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
                      <Route index element={<Home />} />
                      <Route path="website" element={<WebsiteOverviewPage />} />
                      <Route path="website/pages" element={<PagesListPage />} />
                      <Route path="website/pages/:slug" element={<PageEditPage />} />
                      <Route path="website/photos" element={<PhotosPage />} />
                      <Route path="website/blog" element={<ArticlesListPage kind={BLOG} />} />
                      <Route path="website/blog/:slug" element={<ArticleEditPage kind="posts" />} />
                      <Route path="website/portfolio" element={<ArticlesListPage kind={PORTFOLIO} />} />
                      <Route path="website/portfolio/:slug" element={<ArticleEditPage kind="portfolio" />} />
                      <Route path="website/settings" element={<SiteSettingsPage />} />
                      <Route path="bookings" element={<BookingsPage />} />
                      <Route path="bookings/calendar" element={<BookingCalendarPage />} />
                      <Route path="bookings/waitlist" element={<BookingWaitlistPage />} />
                      <Route path="bookings/insights" element={<BookingInsightsPage />} />
                      <Route path="bookings/settings" element={<BookingSettingsPage />} />
                      <Route path="bookings/series/:id" element={<BookingSeriesPage />} />
                      <Route path="bookings/:id" element={<BookingDetailPage />} />
                      <Route path="leads" element={<LeadInbox />} />
                      <Route path="audit" element={<AuditLog />} />
                      <Route path="account" element={<MyAccount />} />
                      <Route path="settings" element={<Settings />} />
                      <Route path="settings/features" element={<FeaturesSettings />} />
                      <Route path="settings/billing" element={<Billing />} />
                      <Route path="settings/email" element={<EmailAliases />} />
                      <Route path="paywall" element={<Paywall />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    <Route path="*" element={<Navigate to={HOME} replace />} />
                  </Routes>
                  <PhotoPickerModal />
                </PhotoPickerProvider>
              </ConfirmProvider>
            </ToastProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
