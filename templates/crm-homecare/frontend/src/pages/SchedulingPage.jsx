import SchedulingHub from '../components/admin/SchedulingHub.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function SchedulingPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <SchedulingHub token={token} user={user} />;
}
