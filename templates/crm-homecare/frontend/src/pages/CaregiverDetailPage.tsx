import CaregiverProfile from '../components/admin/CaregiverProfile';
import { useAuth } from '../contexts/AuthContext';

export default function CaregiverDetailPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <CaregiverProfile token={token} user={user} />;
}
