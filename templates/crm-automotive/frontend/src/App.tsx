import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SocketProvider } from './contexts/SocketContext';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { ProtectedRoute, PublicRoute } from './components/auth/ProtectedRoute';
import ErrorBoundary from './components/common/ErrorBoundary';

// Auth Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

// Core Pages
import DashboardPage from './pages/DashboardPage';
import ContactsPage from './pages/ContactsPage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';

// Automotive Pages
import InventoryPage from './pages/automotive/InventoryPage';
import LeadsKanbanPage from './pages/automotive/LeadsKanbanPage';
import ServicePage from './pages/automotive/ServicePage';
import AlertsPage from './pages/automotive/AlertsPage';

// Support
import SupportPage from './pages/support/SupportPage';
import HelpPage from './pages/help/HelpPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';

// Layout
import AppLayout from './components/layout/AppLayout';

// Onboarding
import OnboardingWizard from './pages/OnboardingWizard';

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { company } = useAuth();
  if (company && company.settings?.onboardingComplete !== true) {
    return <Navigate to="/crm/onboarding" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <ToastProvider>
              <SocketProvider>
                <Routes>
                  {/* Auth */}
                  <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                  <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                  <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                  <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                  {/* Root redirect */}
                  <Route path="/" element={<ProtectedRoute><Navigate to="/crm" replace /></ProtectedRoute>} />

                  {/* Onboarding */}
                  <Route path="/crm/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />

                  {/* CRM */}
                  <Route path="/crm" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="leads" element={<LeadsKanbanPage />} />
                    <Route path="service" element={<ServicePage />} />
                    <Route path="alerts" element={<AlertsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="support" element={<SupportPage />} />
                    <Route path="help" element={<HelpPage />} />
                  </Route>

                  {/* Catch all */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </SocketProvider>
            </ToastProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
