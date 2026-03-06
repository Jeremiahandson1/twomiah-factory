import DocumentsManagement from '../components/admin/DocumentsManagement';
import { useAuth } from '../contexts/AuthContext';

export default function DocumentsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <DocumentsManagement token={token} user={user} />;
}
