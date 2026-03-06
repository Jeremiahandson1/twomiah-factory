import IntegrationsHub from '../components/admin/IntegrationsHub';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <IntegrationsHub token={token} user={user} />;
}
