import ClaimsManagement from '../components/admin/ClaimsManagement';
import { useAuth } from '../contexts/AuthContext';

export default function ClaimsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <ClaimsManagement token={token} user={user} />;
}
