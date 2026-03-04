import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Modal from './components/Modal';

// Pages
import HomePage from './pages/HomePage';
import GalleryPage from './pages/GalleryPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ServicePage from './pages/ServicePage';
import SubServicePage from './pages/SubServicePage';
import CustomPage from './pages/CustomPage';

// Admin
import { AdminProvider } from './admin/AdminContext';
import { ToastProvider } from './admin/Toast';
import AdminLogin from './admin/AdminLogin';
import AdminDashboard from './admin/AdminDashboard';
import AdminPages from './admin/AdminPages';
import PageEditor from './admin/PageEditor';
import AdminMedia from './admin/AdminMedia';
import AdminSettings from './admin/AdminSettings';
import AdminActivity from './admin/AdminActivity';
import AdminLeads from './admin/AdminLeads';
import AdminSiteSettings from './admin/AdminSiteSettings';
import AdminTrash from './admin/AdminTrash';
import AdminRedirects from './admin/AdminRedirects';
import AdminHomepage from './admin/AdminHomepage';
import AdminTestimonials from './admin/AdminTestimonials';
import AdminServicesManager from './admin/AdminServicesManager';
import AdminAnalytics from './admin/AdminAnalytics';
import AdminGallery from './admin/AdminGallery';
import AdminMenus from './admin/AdminMenus';
import AdminBlog from './admin/AdminBlog';
import ProtectedRoute from './admin/ProtectedRoute';
import './admin/admin.css';

// Scroll to top on route change
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  
  React.useEffect(() => {
    if (hash) {
      setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);
  
  return null;
}

// 404 Not Found component
function NotFound() {
  return (
    <div style={{ textAlign: 'center', padding: '100px 20px' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
      <p style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>Page not found</p>
      <a href="/" style={{ color: 'var(--color-primary, #1e3a5f)', fontWeight: '600' }}>← Back to Home</a>
    </div>
  );
}

// Public site layout
function PublicLayout({ children, onFormSuccess, modalOpen, setModalOpen }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
      <Modal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)}
        title="Thank You!"
        message="Your request has been submitted. {{OWNER_NAME}} will be in touch with you shortly to discuss your project."
      />
    </>
  );
}

function AppContent() {
  const [modalOpen, setModalOpen] = React.useState(false);
  const location = useLocation();

  const handleFormSuccess = () => {
    setModalOpen(true);
  };

  // Since basename="/admin", all routes are admin routes
  // The public site is served as static HTML separately
  const isAdminRoute = true;

  if (isAdminRoute) {
    return (
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/" element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          } />
          <Route path="/pages" element={
            <ProtectedRoute>
              <AdminPages />
            </ProtectedRoute>
          } />
          <Route path="/edit/:pageId" element={
            <ProtectedRoute>
              <PageEditor />
            </ProtectedRoute>
          } />
          <Route path="/media" element={
            <ProtectedRoute>
              <AdminMedia />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <AdminSettings />
            </ProtectedRoute>
          } />
          <Route path="/activity" element={
            <ProtectedRoute>
              <AdminActivity />
            </ProtectedRoute>
          } />
          <Route path="/leads" element={
            <ProtectedRoute>
              <AdminLeads />
            </ProtectedRoute>
          } />
          <Route path="/site-settings" element={
            <ProtectedRoute>
              <AdminSiteSettings />
            </ProtectedRoute>
          } />
          <Route path="/trash" element={
            <ProtectedRoute>
              <AdminTrash />
            </ProtectedRoute>
          } />
          <Route path="/redirects" element={
            <ProtectedRoute>
              <AdminRedirects />
            </ProtectedRoute>
          } />
          <Route path="/homepage" element={
            <ProtectedRoute>
              <AdminHomepage />
            </ProtectedRoute>
          } />
          <Route path="/testimonials" element={
            <ProtectedRoute>
              <AdminTestimonials />
            </ProtectedRoute>
          } />
          <Route path="/services" element={
            <ProtectedRoute>
              <AdminServicesManager />
            </ProtectedRoute>
          } />
          <Route path="/analytics" element={
            <ProtectedRoute>
              <AdminAnalytics />
            </ProtectedRoute>
          } />
          <Route path="/gallery" element={
            <ProtectedRoute>
              <AdminGallery />
            </ProtectedRoute>
          } />
          <Route path="/blog" element={
            <ProtectedRoute>
              <AdminBlog />
            </ProtectedRoute>
          } />
          <Route path="/menus" element={
            <ProtectedRoute>
              <AdminMenus />
            </ProtectedRoute>
          } />
          <Route path="/*" element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          } />
        </Routes>
      </ToastProvider>
    );
  }

  return (
    <>
      <ScrollToTop />
      <PublicLayout 
        onFormSuccess={handleFormSuccess}
        modalOpen={modalOpen}
        setModalOpen={setModalOpen}
      >
        <Routes>
          <Route path="/" element={<HomePage onFormSuccess={handleFormSuccess} />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/projects" element={<GalleryPage />} />
          <Route path="/gallery/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/services/:serviceId/:subId" element={<SubServicePage />} />
          <Route path="/services/:id" element={<ServicePage />} />
          <Route path="/page/:pageId" element={<CustomPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PublicLayout>
    </>
  );
}

function App() {
  return (
    <BrowserRouter basename="/admin" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminProvider>
        <AppContent />
      </AdminProvider>
    </BrowserRouter>
  );
}

export default App;
