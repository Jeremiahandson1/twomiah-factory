import ComplianceTracking from '../components/admin/ComplianceTracking.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CompliancePage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <ComplianceTracking token={token} user={user} />;
}
