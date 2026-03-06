import PayrollProcessing from '../components/admin/PayrollProcessing';
import { useAuth } from '../contexts/AuthContext';

export default function PayrollPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <PayrollProcessing token={token} user={user} />;
}
