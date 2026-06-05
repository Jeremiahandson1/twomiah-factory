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
import { PhotoPickerProvider } from './contexts/PhotoPickerContext'
import { PhotoPickerModal } from './components/PhotoPickerModal'

export default function App() {
  return (
    <PhotoPickerProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
        </Route>
        <Route path="*" element={<Navigate to="/pages" replace />} />
      </Routes>
      <PhotoPickerModal />
    </PhotoPickerProvider>
  )
}
