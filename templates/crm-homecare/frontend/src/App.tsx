// src/App.tsx — Main application component (AuthContext + Router pattern)
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import CaregiverDashboard from './components/CaregiverDashboard';
import CustomerPortal from './pages/CustomerPortal';
import OnboardingWizard from './pages/OnboardingWizard';
import PaymentPage, { PaymentSuccess } from './components/PaymentPage';
import PortalLogin from './components/portal/PortalLogin';
import PortalSetup from './components/portal/PortalSetup';
import ClientPortal from './components/portal/ClientPortal';
import { ToastContainer, toast } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';

// ── Protected Route wrapper ──────────────────────────────────────────────────
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!user) return <Login onLogin={() => {}} />;

  return <>{children}</>;
};

const App = () => {
  return (
    <BrowserRouter>
      <ToastContainer />
      <ConfirmModal />

      <Routes>
        {/* Public payment routes */}
        <Route path="/pay/:invoiceId"    element={<PaymentPage />} />
        <Route path="/payment-success"   element={<PaymentSuccess />} />

        {/* Client portal setup (invite link) */}
        <Route path="/portal/setup"      element={<PortalSetup />} />

        {/* Client portal */}
        <Route path="/portal/*"          element={<PortalApp />} />

        {/* Lead Inbox */}
        <Route path="leads" element={<LeadInboxPage />} />
        <Route path="lead-sources" element={<LeadSourcesPage />} />

        {/* Customer Portal — unified hub after login */}
        <Route path="/" element={<AuthProvider><ProtectedRoute><CustomerPortal /></ProtectedRoute></AuthProvider>} />

        {/* Staff app — wrapped in AuthProvider */}
        <Route path="/*"                 element={<AuthProvider><MainApp /></AuthProvider>} />
      </Routes>
    </BrowserRouter>
  );
};

// ── Client Portal App ─────────────────────────────────────────────────────────
const PortalApp = () => {
  const [client, setClient]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken]     = useState(localStorage.getItem('portal_token'));

  const handleLogout = useCallback(() => {
    localStorage.removeItem('portal_token');
    setToken(null);
    setClient(null);
  }, []);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          handleLogout();
          return;
        }
        if (payload.role !== 'client') {
          handleLogout();
          return;
        }
        setClient(payload);
      } catch {
        handleLogout();
      }
    }
    setLoading(false);
  }, [token, handleLogout]);

  const handleLogin = (token, clientData) => {
    localStorage.setItem('portal_token', token);
    setToken(token);
    const payload = JSON.parse(atob(token.split('.')[1]));
    setClient({ ...payload, firstName: clientData.firstName, lastName: clientData.lastName });
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (!client) return <PortalLogin onLogin={handleLogin} />;

  return (
    <ErrorBoundary>
      <ClientPortal user={client} token={token} onLogout={handleLogout} />
    </ErrorBoundary>
  );
};

// ── Staff App (uses AuthContext) ─────────────────────────────────────────────
const MainApp = () => {
  const { user, company, loading, isAdmin, isCaregiver, token, login, logout } = useAuth();

  // Impersonation state — keeps original admin session intact
  const [impersonationToken, setImpersonationToken] = useState(null);
  const [impersonationUser, setImpersonationUser]   = useState(null);

  const handleLogout = useCallback(() => {
    setImpersonationToken(null);
    setImpersonationUser(null);
    logout();
  }, [logout]);

  const handleLogin = async (loginToken, userData) => {
    // Login component calls onLogin(token, user) — but we use AuthContext now
    // The login was already done via AuthContext.login() in the Login component
    // This callback is kept for backward compat with the Login component
  };

  const handleImpersonate = (impToken, impUser) => {
    setImpersonationToken(impToken);
    setImpersonationUser(impUser);
  };

  const exitImpersonation = () => {
    setImpersonationToken(null);
    setImpersonationUser(null);
    toast('Returned to your admin account', 'success');
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (!user) return <Login onLogin={handleLogin} />;

  // Active impersonation — show target user's view with a banner
  if (impersonationToken && impersonationUser) {
    return (
      <ErrorBoundary>
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
          background: '#f97316', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          <span>
            Viewing as <strong>{impersonationUser.name}</strong>
            <span style={{ fontWeight: 400, opacity: 0.85, marginLeft: '0.5rem' }}>
              ({impersonationUser.role}) — read-only debug view
            </span>
          </span>
          <button
            onClick={exitImpersonation}
            style={{
              background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
              color: '#fff', padding: '0.25rem 0.9rem', borderRadius: '6px',
              cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem'
            }}
          >
            Exit
          </button>
        </div>
        <div style={{ paddingTop: '2.5rem' }}>
          {impersonationUser.role === 'admin'
            ? <AdminDashboard onLogout={exitImpersonation} />
            : <CaregiverDashboard onLogout={exitImpersonation} />
          }
        </div>
      </ErrorBoundary>
    );
  }

  // Onboarding gate — show wizard if admin hasn't completed onboarding
  if (isAdmin && company && company.settings?.onboardingComplete !== true) {
    return (
      <ErrorBoundary>
        <OnboardingWizard />
      </ErrorBoundary>
    );
  }

  if (isAdmin) {
    return (
      <ErrorBoundary>
        <AdminDashboard
          onLogout={handleLogout}
          onImpersonate={handleImpersonate}
        />
      </ErrorBoundary>
    );
  } else {
    return <ErrorBoundary><CaregiverDashboard onLogout={handleLogout} /></ErrorBoundary>;
  }
};

export default App;
