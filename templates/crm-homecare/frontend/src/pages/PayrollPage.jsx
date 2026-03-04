import PayrollProcessing from '../components/admin/PayrollProcessing.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function PayrollPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <PayrollProcessing token={token} user={user} />;
}
