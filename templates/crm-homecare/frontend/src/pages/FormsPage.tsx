import FormBuilder from '../components/admin/FormBuilder';
import { useAuth } from '../contexts/AuthContext';

export default function FormsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';
  return <FormBuilder token={token} user={user} />;
}
