// The lock page. ONE implementation for every CRM: packages/tenant-ui/src/auth/PaywallScreen.tsx — its words follow WHY
// the agency is locked, and the owner restarts it by paying (no email). This file only hands it home care's signed-in
// agency, sign-out and API client. Home care's screens open at /, not /crm. (Run 3, blocker 2)
import { Navigate } from 'react-router-dom';
import { PaywallScreen, isAccountLocked } from '../shared';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import Login from '../components/Login';

export default function PaywallPage() {
  const { user, company, loading, logout } = useAuth();
  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!user) return <Login />;
  // An agency that is not locked (or was just unlocked by its payment) has no business on the lock page.
  if (!isAccountLocked(company)) return <Navigate to="/" replace />;
  const signOut = async () => { await logout(); window.location.assign('/'); };
  return <PaywallScreen company={company as any} onSignOut={signOut} homePath="/" request={(method, path) => api.request(path, { method })} />;
}
