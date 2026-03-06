import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { Building2, User, Lock, Users } from 'lucide-react';
import { Button } from '../components/ui/DataTable';

export default function SettingsPage() {
  const { user, company, updateCompany } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('company');
  const [companyForm, setCompanyForm] = useState({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', website: '', licenseNumber: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (company) {
      setCompanyForm({ name: company.name || '', email: company.email || '', phone: company.phone || '', address: company.address || '', city: company.city || '', state: company.state || '', zip: company.zip || '', website: company.website || '', licenseNumber: company.licenseNumber || '' });
    }
    loadUsers();
  }, [company]);

  const loadUsers = async () => {
    try { const data = await api.company.users(); setUsers(data); }
    catch (err) { console.error('Failed to load users'); }
  };

  const handleSaveCompany = async () => {
    setSaving(true);
    try { const updated = await api.company.update(companyForm); updateCompany(updated); toast.success('Company updated'); }
    catch (err) { toast.error(err.message); }
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
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const tabs = [
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
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left ${tab === t.id ? 'bg-orange-50 text-orange-600' : 'hover:bg-gray-100'}`}>
              <t.icon className="w-5 h-5" />{t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 bg-white rounded-lg shadow-sm p-6">
          {tab === 'company' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold">Company Information</h2>
              <div><label className="block text-sm font-medium mb-1">Company Name</label><input value={companyForm.name} onChange={(e) => setCompanyForm({...companyForm, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" value={companyForm.email} onChange={(e) => setCompanyForm({...companyForm, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label><input value={companyForm.phone} onChange={(e) => setCompanyForm({...companyForm, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Address</label><input value={companyForm.address} onChange={(e) => setCompanyForm({...companyForm, address: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">City</label><input value={companyForm.city} onChange={(e) => setCompanyForm({...companyForm, city: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">State</label><input value={companyForm.state} onChange={(e) => setCompanyForm({...companyForm, state: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">ZIP</label><input value={companyForm.zip} onChange={(e) => setCompanyForm({...companyForm, zip: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Website</label><input value={companyForm.website} onChange={(e) => setCompanyForm({...companyForm, website: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-1">License #</label><input value={companyForm.licenseNumber} onChange={(e) => setCompanyForm({...companyForm, licenseNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
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
              <div><label className="block text-sm font-medium mb-1">Current Password</label><input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">New Password</label><input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">Confirm Password</label><input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
              <Button onClick={handleChangePassword} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</Button>
            </div>
          )}
          {tab === 'users' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Users</h2>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium">Name</th><th className="px-4 py-2 text-left text-xs font-medium">Email</th><th className="px-4 py-2 text-left text-xs font-medium">Role</th><th className="px-4 py-2 text-left text-xs font-medium">Status</th></tr></thead>
                  <tbody className="divide-y">{users.map(u => (
                    <tr key={u.id}><td className="px-4 py-3">{u.firstName} {u.lastName}</td><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3 capitalize">{u.role}</td><td className="px-4 py-3">{u.isActive ? <span className="text-green-600">Active</span> : <span className="text-gray-400">Inactive</span>}</td></tr>
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
