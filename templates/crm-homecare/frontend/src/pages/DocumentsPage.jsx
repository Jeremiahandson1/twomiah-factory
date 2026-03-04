import DocumentsManagement from '../components/admin/DocumentsManagement.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function DocumentsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <DocumentsManagement token={token} user={user} />;
}
