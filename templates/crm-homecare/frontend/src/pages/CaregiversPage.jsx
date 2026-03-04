import CaregiverManagement from '../components/admin/CaregiverManagement.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CaregiversPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <CaregiverManagement token={token} user={user} />;
}
