import AuditLogs from '../components/admin/AuditLogs';
import { useAuth } from '../contexts/AuthContext';

export default function AuditPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <AuditLogs token={token} user={user} />;
}
