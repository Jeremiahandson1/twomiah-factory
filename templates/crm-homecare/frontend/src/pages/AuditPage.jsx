import AuditLogs from '../components/admin/AuditLogs.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function AuditPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <AuditLogs token={token} user={user} />;
}
