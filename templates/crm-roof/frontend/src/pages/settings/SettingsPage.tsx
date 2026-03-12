import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Building2, Palette, Users, Plus, Send, X, Save, Calculator, ChevronRight, Zap, MessageSquare, Link2, Unlink, RefreshCw, CloudLightning } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useFeature } from '../../data/features';

export default function SettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [company, setCompany] = useState({ name: '', phone: '', email: '', address: '', city: '', state: '', zip: '' });
  const [branding, setBranding] = useState({ primaryColor: '#3b82f6' });
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'user' });
  const [inviting, setInviting] = useState(false);

  // QuickBooks state
  const [qbStatus, setQbStatus] = useState<any>(null);
  const [qbLoading, setQbLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Storm settings state
  const [stormSettings, setStormSettings] = useState({
    zipCodes: [] as string[],
    stormAlertEnabled: false,
    minHailSize: 1.0,
    maxLeadsPerZip: 200,
    autoGenerate: false,
  });
  const [zipInput, setZipInput] = useState('');
  const [savingStorm, setSavingStorm] = useState(false);

  const hasQB = useFeature('quickbooks_sync');
  const hasStorm = useFeature('storm_lead_gen');

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const fetches: Promise<any>[] = [
        fetch('/api/settings/company', { headers }).catch(() => null),
        fetch('/api/users', { headers }),
      ];
      if (hasQB) fetches.push(fetch('/api/quickbooks/status', { headers }).catch(() => null));
      if (hasStorm) fetches.push(fetch('/api/storms/service-area', { headers }).catch(() => null));

      const results = await Promise.all(fetches);
      const [companyRes, usersRes] = results;

      if (companyRes?.ok) {
        const data = await companyRes.json();
        setCompany((prev) => ({ ...prev, ...data }));
        if (data.primaryColor) setBranding({ primaryColor: data.primaryColor });
      }
      const usersData = await usersRes.json();
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);

      let idx = 2;
      if (hasQB && results[idx]?.ok) {
        setQbStatus(await results[idx].json());
        idx++;
      } else if (hasQB) idx++;
      if (hasStorm && results[idx]?.ok) {
        const stormData = await results[idx].json();
        setStormSettings(prev => ({ ...prev, ...stormData }));
      }
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const saveCompany = async () => {
    setSavingCompany(true);
    try {
      const res = await fetch('/api/settings/company', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      });
      if (!res.ok) throw new Error();
      toast.success('Company info saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingCompany(false);
    }
  };

  const saveBrandingSettings = async () => {
    setSavingBranding(true);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(branding),
      });
      if (!res.ok) throw new Error();
      toast.success('Branding saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingBranding(false);
    }
  };

  const inviteUser = async () => {
    if (!inviteForm.email.trim()) { toast.error('Email is required'); return; }
    setInviting(true);
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      });
      if (!res.ok) throw new Error();
      toast.success('Invitation sent');
      setInviteOpen(false);
      setInviteForm({ email: '', name: '', role: 'user' });
      load();
    } catch {
      toast.error('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const connectQB = () => {
    window.location.href = '/api/quickbooks/connect';
  };

  const disconnectQB = async () => {
    setQbLoading(true);
    try {
      await fetch('/api/quickbooks/disconnect', { method: 'POST', headers });
      setQbStatus({ connected: false });
      toast.success('QuickBooks disconnected');
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setQbLoading(false);
    }
  };

  const syncQB = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/quickbooks/sync', { method: 'POST', headers });
      if (!res.ok) throw new Error();
      toast.success('QuickBooks sync complete');
      load();
    } catch {
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const addZip = () => {
    const zip = zipInput.trim();
    if (zip && /^\d{5}$/.test(zip) && !stormSettings.zipCodes.includes(zip)) {
      setStormSettings(prev => ({ ...prev, zipCodes: [...prev.zipCodes, zip] }));
      setZipInput('');
    }
  };

  const removeZip = (zip: string) => {
    setStormSettings(prev => ({ ...prev, zipCodes: prev.zipCodes.filter(z => z !== zip) }));
  };

  const saveStormSettings = async () => {
    setSavingStorm(true);
    try {
      const res = await fetch('/api/storms/service-area', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(stormSettings),
      });
      if (!res.ok) throw new Error();
      toast.success('Storm settings saved');
    } catch {
      toast.error('Failed to save storm settings');
    } finally {
      setSavingStorm(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-gray-400" /> Settings
        </h1>

        {/* Company Info */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-gray-400" /> Company Info
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Company Name</label>
              <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Phone</label>
              <input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Email</label>
              <input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Address</label>
              <input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">City</label>
              <input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">State</label>
                <input value={company.state} onChange={(e) => setCompany({ ...company, state: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Zip</label>
                <input value={company.zip} onChange={(e) => setCompany({ ...company, zip: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={saveCompany} disabled={savingCompany} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Save className="w-4 h-4" /> {savingCompany ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Branding */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Palette className="w-4 h-4 text-gray-400" /> Branding
          </h2>
          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  className="w-10 h-10 rounded border cursor-pointer"
                />
                <input
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  className="w-24 text-sm border rounded-lg px-3 py-2 font-mono"
                />
              </div>
            </div>
            <div className="flex-1 flex items-end justify-end">
              <button onClick={saveBrandingSettings} disabled={savingBranding} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-4 h-4" /> {savingBranding ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Instant Estimator */}
        <div
          onClick={() => navigate('/crm/settings/estimator')}
          className="bg-white rounded-xl shadow-sm border p-6 hover:border-purple-300 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Calculator className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Instant Estimator Widget</h2>
                <p className="text-xs text-gray-500">Embed a roof cost estimator on your website</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </div>
        </div>

        {/* QuickBooks Integration */}
        {hasQB && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Link2 className="w-4 h-4 text-green-600" /> QuickBooks Integration
            </h2>
            {qbStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700 font-medium">Connected</span>
                  {qbStatus.realmId && <span className="text-xs text-gray-400">Realm: {qbStatus.realmId}</span>}
                </div>
                {qbStatus.lastSyncedAt && (
                  <p className="text-xs text-gray-500">Last synced: {new Date(qbStatus.lastSyncedAt).toLocaleString()}</p>
                )}
                {qbStatus.connectedSince && (
                  <p className="text-xs text-gray-500">Connected since: {new Date(qbStatus.connectedSince).toLocaleDateString()}</p>
                )}
                <div className="flex gap-2 pt-2">
                  <button onClick={syncQB} disabled={syncing} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing...' : 'Full Sync'}
                  </button>
                  <button onClick={disconnectQB} disabled={qbLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs rounded-lg hover:bg-red-100 disabled:opacity-50">
                    <Unlink className="w-3.5 h-3.5" /> Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">Connect QuickBooks to automatically sync contacts and invoices.</p>
                <button onClick={connectQB} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                  <Link2 className="w-4 h-4" /> Connect QuickBooks
                </button>
              </div>
            )}
          </div>
        )}

        {/* Storm Lead Settings */}
        {hasStorm && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <CloudLightning className="w-4 h-4 text-amber-500" /> Storm Lead Generation
            </h2>
            <div className="space-y-4">
              {/* Service Area Zip Codes */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Service Area Zip Codes</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={zipInput}
                    onChange={(e) => setZipInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addZip()}
                    placeholder="Enter zip code"
                    className="w-32 text-sm border rounded-lg px-3 py-1.5"
                    maxLength={5}
                  />
                  <button onClick={addZip} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stormSettings.zipCodes.map((zip) => (
                    <span key={zip} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                      {zip}
                      <button onClick={() => removeZip(zip)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {stormSettings.zipCodes.length === 0 && <span className="text-xs text-gray-400">No zip codes configured</span>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Min Hail Size (inches)</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.5"
                    value={stormSettings.minHailSize}
                    onChange={(e) => setStormSettings(prev => ({ ...prev, minHailSize: parseFloat(e.target.value) || 1.0 }))}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Max Leads Per Zip</label>
                  <input
                    type="number"
                    min="10"
                    max="1000"
                    value={stormSettings.maxLeadsPerZip}
                    onChange={(e) => setStormSettings(prev => ({ ...prev, maxLeadsPerZip: parseInt(e.target.value) || 200 }))}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stormSettings.stormAlertEnabled}
                    onChange={(e) => setStormSettings(prev => ({ ...prev, stormAlertEnabled: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Enable storm alerts for service area</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stormSettings.autoGenerate}
                    onChange={(e) => setStormSettings(prev => ({ ...prev, autoGenerate: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Auto-generate leads when storms are detected</span>
                </label>
              </div>

              <div className="flex justify-end">
                <button onClick={saveStormSettings} disabled={savingStorm} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <Save className="w-4 h-4" /> {savingStorm ? 'Saving...' : 'Save Storm Settings'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SMS / Twilio Configuration */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-blue-500" /> SMS / Twilio
          </h2>
          <p className="text-sm text-gray-500 mb-3">
            Automated SMS messages are sent at each pipeline stage when two-way texting is enabled.
            Configure your Twilio credentials as environment variables:
          </p>
          <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs text-gray-600 space-y-1">
            <p>TWILIO_ACCOUNT_SID=your_account_sid</p>
            <p>TWILIO_AUTH_TOKEN=your_auth_token</p>
            <p>TWILIO_FROM_NUMBER=+1XXXXXXXXXX</p>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            SMS triggers: inspection scheduled, inspected, measurement ordered, proposal sent, signed, material ordered, in production, final inspection, invoiced, collected, insurance claim filed, insurance approved, supplement submitted
          </p>
        </div>

        {/* User Management */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-400" /> User Management
            </h2>
            <button
              onClick={() => { setInviteForm({ email: '', name: '', role: 'user' }); setInviteOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" /> Invite User
            </button>
          </div>

          <div className="divide-y">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{user.name || user.email}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">
                  {user.role || 'user'}
                </span>
              </div>
            ))}
            {users.length === 0 && (
              <p className="py-4 text-sm text-gray-400 text-center">No users</p>
            )}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInviteOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Invite User</h2>
              <button onClick={() => setInviteOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Email *</label>
                <input value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name</label>
                <input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Role</label>
                <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="sales">Sales</option>
                  <option value="technician">Technician</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setInviteOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={inviteUser} disabled={inviting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
