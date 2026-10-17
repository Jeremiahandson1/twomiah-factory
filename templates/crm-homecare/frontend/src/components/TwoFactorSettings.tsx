// Two-factor sign-in, for whoever is signed in — the fleet's shared card (packages/tenant-ui/src/auth/TwoFactorCard.tsx,
// vendored as ../shared) over home care's own client (services/api.ts `mfa` → /api/auth/mfa-devices).
//
// Rendered in two places, one per kind of seat: the office's Settings › Sign-in & Security (AdminDashboard) and the
// caregiver's Settings page (CaregiverDashboard). It is a person's own account, so neither asks a role or a permission.
import { TwoFactorCard } from '../shared';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { toast } from './Toast';

export default function TwoFactorSettings() {
  const { user } = useAuth();
  // View As shows somebody else's screens, but this client still holds the ADMIN's own session: the card would list
  // the admin's authenticator under another person's name. The server refuses View As writes anyway
  // (middleware/viewAsReadOnly.ts); here it is simply not offered.
  if (user?.impersonatedBy) {
    return (
      <div className="card">
        <div className="card-title">Two-factor authentication</div>
        <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>Not available while viewing as someone else — exit View As to manage your own sign-in.</p>
      </div>
    );
  }
  return <TwoFactorCard api={api as any} toast={{ success: (m: string) => toast(m, 'success'), error: (m: string) => toast(m, 'error') }} />;
}
