import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { LoginPage } from './pages/LoginPage'
import { PagesListPage } from './pages/PagesListPage'
import { PageEditPage } from './pages/PageEditPage'
import { PhotosPage } from './pages/PhotosPage'
import { SettingsPage } from './pages/SettingsPage'
import { LeadsPage } from './pages/LeadsPage'
import { UsersPage } from './pages/UsersPage'
import { AccountPage } from './pages/AccountPage'
import { BillingPage } from './pages/BillingPage'
import { PostsListPage } from './pages/PostsListPage'
import { PostEditPage } from './pages/PostEditPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { AuditLogPage } from './pages/AuditLogPage'
import { BookingsPage } from './pages/BookingsPage'
import { BookingDetailPage } from './pages/BookingDetailPage'
import { BookingSettingsPage } from './pages/BookingSettingsPage'
import { BookingSeriesPage } from './pages/BookingSeriesPage'
import { BookingsCalendarPage } from './pages/BookingsCalendarPage'
import { BookingsAnalyticsPage } from './pages/BookingsAnalyticsPage'
import { BookingWaitlistPage } from './pages/BookingWaitlistPage'
import { PhotoPickerProvider } from './contexts/PhotoPickerContext'
import { PhotoPickerModal } from './components/PhotoPickerModal'

export default function App() {
  return (
    <PhotoPickerProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/pages" replace />} />
          <Route path="/pages" element={<PagesListPage />} />
          <Route path="/pages/:slug" element={<PageEditPage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/posts" element={<PostsListPage />} />
          <Route path="/posts/:slug" element={<PostEditPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route path="/booking-settings" element={<BookingSettingsPage />} />
          <Route path="/series/:id" element={<BookingSeriesPage />} />
          <Route path="/bookings-calendar" element={<BookingsCalendarPage />} />
          <Route path="/bookings-analytics" element={<BookingsAnalyticsPage />} />
          <Route path="/bookings-waitlist" element={<BookingWaitlistPage />} />
          <Route path="/activity" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/pages" replace />} />
      </Routes>
      <PhotoPickerModal />
    </PhotoPickerProvider>
  )
}
