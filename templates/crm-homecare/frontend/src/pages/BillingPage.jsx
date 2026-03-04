import BillingDashboard from '../components/admin/BillingDashboard.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function BillingPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <BillingDashboard token={token} user={user} />;
}
