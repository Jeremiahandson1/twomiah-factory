// src/App.tsx — Main application component (AuthContext + Router pattern)
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthContext, { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import CaregiverDashboard from './components/CaregiverDashboard';
import CustomerPortal from './pages/CustomerPortal';
import OnboardingWizard from './pages/OnboardingWizard';
import PaymentPage, { PaymentSuccess } from './components/PaymentPage';
import CareersPage from './pages/CareersPage';
import OnboardingPacketPage from './components/OnboardingPacketPage';
import PortalLogin from './components/portal/PortalLogin';
import PortalSetup from './components/portal/PortalSetup';
import ClientPortal from './components/portal/ClientPortal';
import FamilyPortalLogin from './components/portal/FamilyPortalLogin';
import FamilyPortal from './components/portal/FamilyPortal';
import PortalPaused, { usePortalPaused } from './components/portal/PortalPaused';
import { ToastContainer, toast } from './components/Toast';
import { API_BASE_URL, setSessionExpiredCallback } from './config';
import { ConfirmModal } from './components/ConfirmModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import LeadInboxPage from './pages/leads/LeadInboxPage';
import LeadSourcesPage from './pages/leads/LeadSourcesPage';
import AdsPage from './pages/ads/AdsPage';
import { EmailAliasesPage, EmailDomainPage, InboundMessagesPage, isAccountLocked, useBrandPalette } from './shared';
import PaywallPage from './pages/PaywallPage';
import { LOCK_PAGE } from './services/api';
import { usePageTitle } from './hooks/usePageTitle';

// The agency's name, filled in when the CRM is generated (as the sign-in page's heading is). index.html's own title is
// "<agency> CRM" — right for the office, wrong on the pages the public, clients and families open. A template literal,
// because the generator pastes the name in raw and "Mary's Home Care" would end a quoted string.
const AGENCY = `{{COMPANY_NAME}}`;

// ── Protected Route wrapper ──────────────────────────────────────────────────
// A locked agency (cancelled in the Factory — the server refuses it 402) goes to the lock page, every role, from every
// door: this wrapper and MainApp below.
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, company, loading } = useAuth();

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!user) return <Login onLogin={() => {}} />;
  if (isAccountLocked(company)) return <Navigate to={LOCK_PAGE} replace />;

  return <>{children}</>;
};

/** The browser tab's title for a public page, which has no CRM around it. */
const Titled = ({ title, children }: { title: string; children: React.ReactNode }) => {
  usePageTitle(title);
  return <>{children}</>;
};

const App = () => {
  return (
    <BrowserRouter>
      <ToastContainer />
      <ConfirmModal />

      <Routes>
        {/* Public payment routes */}
        <Route path="/pay/:invoiceId"    element={<Titled title={`Pay your invoice — ${AGENCY}`}><PaymentPage /></Titled>} />
        <Route path="/payment-success"   element={<Titled title={`Payment received — ${AGENCY}`}><PaymentSuccess /></Titled>} />

        {/* Public careers page + the new hire's tokenized onboarding packet (no sign-in). The careers page names its
            own tab (it knows the opening); the packet is the new hire's. */}
        <Route path="/careers"           element={<CareersPage />} />
        <Route path="/careers/:slug"     element={<CareersPage />} />
        <Route path="/onboarding/:token" element={<Titled title={`Your onboarding — ${AGENCY}`}><OnboardingPacketPage /></Titled>} />

        {/* Client portal setup (invite link) */}
        <Route path="/portal/setup"      element={<Titled title={`Client portal — ${AGENCY}`}><PortalSetup /></Titled>} />

        {/* Client portal */}
        <Route path="/portal/*"          element={<Titled title={`Client portal — ${AGENCY}`}><PortalApp /></Titled>} />

        {/* Family portal */}
        <Route path="/family/*"          element={<Titled title={`Family portal — ${AGENCY}`}><FamilyApp /></Titled>} />

        {/* The lock page: a cancelled agency, every role. The Factory's restart checkout returns here. */}
        <Route path="/crm/paywall"       element={<AuthProvider><PaywallPage /></AuthProvider>} />

        {/* Lead Inbox */}
        <Route path="leads" element={<LeadInboxPage />} />
        <Route path="lead-sources" element={<LeadSourcesPage />} />
        <Route path="ads" element={<AdsPage />} />

        {/* Branded email */}
        <Route path="settings/email" element={<EmailAliasesPage />} />
        <Route path="settings/email-domain" element={<EmailDomainPage />} />
        <Route path="settings/email-inbox" element={<InboundMessagesPage />} />
        {/* The address page every other CRM has at /crm/settings/email — where a paired premium website's Email
            page sends the owner (CRM_EMAIL_PAGE_PATH in each premium site's routes/admin.ts). Home care's admin keeps it
            as a dashboard section, deep-linked by hash (AdminDashboard M-04). */}
        <Route path="/crm/settings/email" element={<Navigate to="/crm#branded-email" replace />} />

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
  const [linkError, setLinkError] = useState('');
  // An emailed portal link arrives as /portal?token=<database token>, which is
  // not a JWT. Redeem it once for a session, then take it out of the URL so it
  // does not sit in browser history or get pasted into a share.
  const [redeeming] = useState(() => new URLSearchParams(window.location.search).has('token'));
  // A locked agency's portal is paused: every data call is refused 402 (services/sessionFetch.ts raises it).
  const paused = usePortalPaused();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkToken = params.get('token');
    if (!linkToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/portal/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: linkToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.token) {
          localStorage.setItem('portal_token', data.token);
          setToken(data.token);
        } else {
          setLinkError(data.error || 'This link is no longer valid. Please contact your care coordinator.');
        }
      } catch {
        if (!cancelled) setLinkError('We could not open your portal. Please check your connection and try again.');
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, '', window.location.pathname);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('portal_token');
    setToken(null);
    setClient(null);
  }, []);

  useEffect(() => {
    setSessionExpiredCallback(handleLogout);
  }, [handleLogout]);

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
    // While a link is being redeemed the exchange effect owns `loading`,
    // otherwise the login screen flashes before the portal opens.
    if (!redeeming || token) setLoading(false);
  }, [token, handleLogout, redeeming]);

  const handleLogin = (token, clientData) => {
    localStorage.setItem('portal_token', token);
    setToken(token);
    const payload = JSON.parse(atob(token.split('.')[1]));
    setClient({ ...payload, firstName: clientData.firstName, lastName: clientData.lastName });
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (!client) return (
    <>
      {linkError && (
        <div style={{
          maxWidth: '520px', margin: '24px auto -8px', padding: '0.85rem 1rem',
          background: '#fed7d7', color: '#822727', borderRadius: '8px', textAlign: 'center',
        }}>
          {linkError}
        </div>
      )}
      <PortalLogin onLogin={handleLogin} />
    </>
  );

  if (paused) return <PortalPaused onLogout={handleLogout} />;

  return (
    <ErrorBoundary>
      <ClientPortal user={client} token={token} onLogout={handleLogout} />
    </ErrorBoundary>
  );
};

// ── Family Portal App ─────────────────────────────────────────────────────────
// A relative's own sign-in (family_members), separate from the client portal.
const FamilyApp = () => {
  const [familyUser, setFamilyUser] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [token, setToken]           = useState(localStorage.getItem('family_token'));
  const paused = usePortalPaused();

  const handleLogout = useCallback(() => {
    localStorage.removeItem('family_token');
    localStorage.removeItem('family_user');
    setToken(null);
    setFamilyUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredCallback(handleLogout);
  }, [handleLogout]);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if ((payload.exp && payload.exp * 1000 < Date.now()) || payload.role !== 'family') {
          handleLogout();
        } else {
          let stored = null;
          try { stored = JSON.parse(localStorage.getItem('family_user') || 'null'); } catch { stored = null; }
          setFamilyUser(stored || { id: payload.familyMemberId });
        }
      } catch {
        handleLogout();
      }
    }
    setLoading(false);
  }, [token, handleLogout]);

  const handleLogin = (newToken, userData) => {
    localStorage.setItem('family_token', newToken);
    localStorage.setItem('family_user', JSON.stringify(userData || {}));
    setToken(newToken);
    setFamilyUser(userData || {});
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!familyUser || !token) return <FamilyPortalLogin onLogin={handleLogin} />;
  if (paused) return <PortalPaused onLogout={handleLogout} />;

  return (
    <ErrorBoundary>
      <FamilyPortal user={familyUser} token={token} onLogout={handleLogout} />
    </ErrorBoundary>
  );
};

// ── Staff App (uses AuthContext) ─────────────────────────────────────────────
const MainApp = () => {
  const auth = useAuth();
  const { user, company, loading, isAdmin, isCaregiver, token, login, logout } = auth;
  // The agency's colour on every brand-coloured (orange-/primary-/brand-) class — the stored one, not only the one
  // the build baked in; same generator and clamps as tailwind.config.js. Before any early return: it is a hook.
  useBrandPalette(company?.primaryColor);

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

  // A locked agency sees the lock page, never a CRM whose every call is refused.
  if (isAccountLocked(company)) return <Navigate to={LOCK_PAGE} replace />;

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
              ({impersonationUser.role === 'client' ? 'client portal' : impersonationUser.role}) — read-only debug view
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
          {impersonationUser.role === 'client'
            ? <ClientPortal user={impersonationUser} token={impersonationToken} onLogout={exitImpersonation} />
            : (
              // The viewed user's screens read the session from useAuth(): hand them that user and the
              // View As token (POST /api/auth/impersonate/:id), so they load THAT user's data.
              <AuthContext.Provider value={{
                ...auth,
                user: impersonationUser,
                token: impersonationToken,
                isAdmin: impersonationUser.role === 'admin' || impersonationUser.role === 'owner',
                isCaregiver: impersonationUser.role === 'caregiver',
                logout: exitImpersonation,
              }}>
                {impersonationUser.role === 'admin' || impersonationUser.role === 'owner'
                  ? <AdminDashboard onLogout={exitImpersonation} />
                  : <CaregiverDashboard onLogout={exitImpersonation} />}
              </AuthContext.Provider>
            )
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
