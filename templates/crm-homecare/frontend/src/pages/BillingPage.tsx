import BillingDashboard from '../components/admin/BillingDashboard';
import { useAuth } from '../contexts/AuthContext';

export default function BillingPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <BillingDashboard token={token} user={user} />;
}
