import ReportsAnalytics from '../components/admin/ReportsAnalytics.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ReportsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <ReportsAnalytics token={token} user={user} />;
}
