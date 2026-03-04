import CommunicationLog from '../components/admin/CommunicationLog.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CommunicationPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <CommunicationLog token={token} user={user} />;
}
