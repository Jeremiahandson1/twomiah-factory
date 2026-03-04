import NotificationCenter from '../components/admin/NotificationCenter.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function NotificationsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <NotificationCenter token={token} user={user} />;
}
