import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { LoginPage } from './pages/LoginPage'
import { PagesListPage } from './pages/PagesListPage'
import { PageEditPage } from './pages/PageEditPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/pages" replace />} />
        <Route path="/pages" element={<PagesListPage />} />
        <Route path="/pages/:slug" element={<PageEditPage />} />
        <Route path="/photos" element={<PlaceholderPage title="Photos" summary="Upload, tag, and reuse photos across sections." />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" summary="Company info, brand colors, nav, SEO defaults." />} />
        <Route path="/leads" element={<PlaceholderPage title="Leads" summary="Contact-form submissions land here." />} />
      </Route>
      <Route path="*" element={<Navigate to="/pages" replace />} />
    </Routes>
  )
}
