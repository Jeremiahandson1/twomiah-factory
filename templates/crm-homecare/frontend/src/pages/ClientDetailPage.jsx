import ClientsManagement from '../components/admin/ClientsManagement.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ClientDetailPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <ClientsManagement token={token} user={user} />;
}
