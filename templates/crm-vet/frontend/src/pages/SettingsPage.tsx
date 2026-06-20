import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import type { Company } from '../types';
import { Building2, User, Lock, Users, CreditCard, Plug, Upload, ArrowRightLeft, Calculator } from 'lucide-react';
import { Button } from '../components/ui/DataTable';

interface CompanyForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  licenseNumber: string;
  [key: string]: string;
}

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, company, updateCompany } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('company');
  const [companyForm, setCompanyForm] = useState<CompanyForm>({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', website: '', licenseNumber: '' });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (company) {
      setCompanyForm({ name: company.name || '', email: company.email || '', phone: company.phone || '', address: company.address || '', city: company.city || '', state: company.state || '', zip: company.zip || '', website: company.website || '', licenseNumber: (company as unknown as Record<string, unknown>).licenseNumber as string || '' });
    }
    loadUsers();
  }, [company]);

  const loadUsers = async () => {
    try { const data = await api.company.users(); setUsers(Array.isArray(data) ? data : (data?.data ?? [])); }
    catch (err) { console.error('Failed to load users'); }
  };

  const handleSaveCompany = async () => {
    setSaving(true);
    try { const updated = await api.company.update(companyForm); updateCompany(updated as Partial<Company>); toast.success('Company updated'); }
    catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (passwordForm.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setSaving(true);
    try {
      await api.request('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      toast.success('Password changed');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const tabs: TabItem[] = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'users', label: 'Users', icon: Users },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="flex gap-6">
        <div className="w-48 space-y-1">
          {tabs.map((t: TabItem) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left ${tab === t.id ? 'bg-orange-50 text-orange-600' : 'hover:bg-gray-100'}`}>
              <t.icon className="w-5 h-5" />{t.label}
            </button>
          ))}
          <div className="border-t my-3 pt-3">
            <button onClick={() => navigate('/crm/settings/billing')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <CreditCard className="w-5 h-5" />Billing
            </button>
            <button onClick={() => navigate('/crm/settings/integrations')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Plug className="w-5 h-5" />Integrations
            </button>
            <button onClick={() => navigate('/crm/settings/migration')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <ArrowRightLeft className="w-5 h-5" />Migrate Data
            </button>
            <button onClick={() => navigate('/crm/settings/estimator')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Calculator className="w-5 h-5" />Instant Estimator
            </button>
          </div>
        </div>
        <div className="flex-1 bg-white rounded-lg shadow-sm p-6">
          {tab === 'company' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold">Company Information</h2>
              <div><label className="block text-sm font-medium mb-1">Company Name</label><input value={companyForm.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" value={companyForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label><input value={companyForm.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Address</label><input value={companyForm.address} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, address: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">City</label><input value={companyForm.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, city: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">State</label><input value={companyForm.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, state: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">ZIP</label><input value={companyForm.zip} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, zip: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Website</label><input value={companyForm.website} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, website: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">License #</label><input value={companyForm.licenseNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyForm({...companyForm, licenseNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              </div>
              <Button onClick={handleSaveCompany} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          )}
          {tab === 'profile' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold">Profile</h2>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p><span className="font-medium">Name:</span> {user?.firstName} {user?.lastName}</p>
                <p><span className="font-medium">Email:</span> {user?.email}</p>
                <p><span className="font-medium">Role:</span> {user?.role}</p>
              </div>
            </div>
          )}
          {tab === 'security' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold">Change Password</h2>
              <div><label className="block text-sm font-medium mb-1">Current Password</label><input type="password" value={passwordForm.currentPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm({...passwordForm, currentPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">New Password</label><input type="password" value={passwordForm.newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm({...passwordForm, newPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">Confirm Password</label><input type="password" value={passwordForm.confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <Button onClick={handleChangePassword} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</Button>
            </div>
          )}
          {tab === 'users' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Users</h2>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium">Name</th><th className="px-4 py-2 text-left text-xs font-medium">Email</th><th className="px-4 py-2 text-left text-xs font-medium">Role</th><th className="px-4 py-2 text-left text-xs font-medium">Status</th></tr></thead>
                  <tbody className="divide-y">{users.map((u: Record<string, unknown>) => (
                    <tr key={u.id as string}><td className="px-4 py-3">{u.firstName as string} {u.lastName as string}</td><td className="px-4 py-3">{u.email as string}</td><td className="px-4 py-3 capitalize">{u.role as string}</td><td className="px-4 py-3">{u.isActive ? <span className="text-green-600">Active</span> : <span className="text-gray-400">Inactive</span>}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
