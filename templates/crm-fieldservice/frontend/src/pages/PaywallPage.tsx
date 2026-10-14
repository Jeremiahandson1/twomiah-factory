// The lock page. ONE implementation for every CRM: packages/tenant-ui/src/auth/PaywallScreen.tsx — its words follow WHY
// the company is locked (an ended subscription, or a trial that ran out). This file only hands it this template's
// signed-in company and sign-out. (10/14)
import { PaywallScreen } from '../shared';
import { useAuth } from '../contexts/AuthContext';

export default function PaywallPage() {
  const { company, logout } = useAuth();
  return <PaywallScreen company={company as any} onSignOut={logout} />;
}
