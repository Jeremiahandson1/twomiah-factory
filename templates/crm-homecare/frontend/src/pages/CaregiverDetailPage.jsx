import CaregiverProfile from '../components/admin/CaregiverProfile.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CaregiverDetailPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <CaregiverProfile token={token} user={user} />;
}
