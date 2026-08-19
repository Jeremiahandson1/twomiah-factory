import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import type { Company } from '../types';
import { Building2, User, Lock, Users, CreditCard, Plug, Upload, ArrowRightLeft, Calculator, ToggleLeft, AtSign, Globe, Inbox } from 'lucide-react';
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
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'user' });

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

  // Adding a teammate is what makes the seat-based plan real: the backend
  // endpoint has always existed, but nothing in the UI called it, so every
  // account was stuck at one login regardless of the tier being paid for.
  // The admin sets the first password and passes it along — no invite email,
  // because tenant outbound mail isn't guaranteed and a mail that never
  // arrives is indistinguishable from a broken product.
  const handleAddUser = async () => {
    if (!newUser.firstName.trim() || !newUser.lastName.trim()) { toast.error('First and last name are required'); return; }
    if (!newUser.email.trim()) { toast.error('Email is required'); return; }
    if (newUser.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setAddingUser(true);
    try {
      await api.company.createUser(newUser);
      toast.success('User added');
      setAddUserOpen(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '', role: 'user' });
      loadUsers();
    } catch (err) { toast.error((err as Error).message || 'Could not add the user'); }
    finally { setAddingUser(false); }
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
            <button onClick={() => navigate('/crm/settings/features')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <ToggleLeft className="w-5 h-5" />Features
            </button>
            <button onClick={() => navigate('/crm/settings/billing')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <CreditCard className="w-5 h-5" />Billing
            </button>
            <button onClick={() => navigate('/crm/settings/email')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <AtSign className="w-5 h-5" />Branded Email
            </button>
            <button onClick={() => navigate('/crm/settings/email-domain')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Globe className="w-5 h-5" />Email Domain
            </button>
            <button onClick={() => navigate('/crm/settings/email-inbox')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Inbox className="w-5 h-5" />Email Inbox
            </button>
            <button onClick={() => navigate('/crm/settings/integrations')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Plug className="w-5 h-5" />Integrations
            </button>
            <button onClick={() => navigate('/crm/settings/migration')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <ArrowRightLeft className="w-5 h-5" />Migrate Data
            </button>
            <button onClick={() => navigate('/crm/settings/import')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left hover:bg-gray-100">
              <Upload className="w-5 h-5" />Import from CSV
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
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Users</h2>
                <Button onClick={() => { setNewUser({ firstName: '', lastName: '', email: '', password: '', role: 'user' }); setAddUserOpen(true); }}>Add User</Button>
              </div>

              {addUserOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddUserOpen(false)}>
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-4">Add User</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">First name *</label>
                          <input value={newUser.firstName} onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Last name *</label>
                          <input value={newUser.lastName} onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Email *</label>
                        <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Temporary password *</label>
                        <input type="text" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="At least 8 characters" className="w-full text-sm border rounded-lg px-3 py-2" />
                        <p className="text-xs text-gray-400 mt-1">Share this with them — they can change it after signing in.</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Role</label>
                        <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                          <option value="user">User — day-to-day access</option>
                          <option value="field">Field — mobile / on-site access</option>
                          <option value="manager">Manager — can approve and manage work</option>
                          <option value="admin">Admin — full access including settings</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                      <button onClick={() => setAddUserOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                      <Button onClick={handleAddUser} disabled={addingUser}>{addingUser ? 'Adding...' : 'Add User'}</Button>
                    </div>
                  </div>
                </div>
              )}
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
