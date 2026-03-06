import CaregiverManagement from '../components/admin/CaregiverManagement';
import { useAuth } from '../contexts/AuthContext';

export default function CaregiversPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <CaregiverManagement token={token} user={user} />;
}
