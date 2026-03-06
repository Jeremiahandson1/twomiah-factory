import SchedulingHub from '../components/admin/SchedulingHub';
import { useAuth } from '../contexts/AuthContext';

export default function SchedulingPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <SchedulingHub token={token} user={user} />;
}
