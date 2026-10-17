// The lock page. ONE implementation for every CRM: packages/tenant-ui/src/auth/PaywallScreen.tsx — its words follow WHY
// the company is locked, and the owner restarts it by paying (no email). This file only hands it this template's
// signed-in company, sign-out and API client. (10/14)
import { PaywallScreen } from '../shared';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export default function PaywallPage() {
  const { company, logout } = useAuth();
  return <PaywallScreen company={company as any} onSignOut={logout} request={(method, path) => api.request(path, { method })} />;
}
