import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Gift, Truck, ShoppingBag, Receipt, Clock, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '../components/ui/DataTable';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

type DayHours = { open: string; close: string; closed: boolean };
type StoreHours = Record<string, DayHours>;

const defaultHours = (): StoreHours =>
  Object.fromEntries(DAYS.map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!enabled)} className="flex items-center gap-3 group">
      {enabled
        ? <ToggleRight className="w-8 h-8 text-green-600" />
        : <ToggleLeft className="w-8 h-8 text-gray-400 group-hover:text-gray-500" />}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 mb-1">{children}</label>;
}

function Input({ value, onChange, type = 'text', placeholder = '', className = '' }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition ${className}`} />;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, company, updateCompany } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // General
  const [generalForm, setGeneralForm] = useState({
    name: '', address: '', phone: '', email: '', taxRate: '0',
  });
  const [storeHours, setStoreHours] = useState<StoreHours>(defaultHours());

  // Loyalty
  const [loyaltyForm, setLoyaltyForm] = useState({
    enabled: false,
    pointsPerDollar: '1',
    bronzeThreshold: '100',
    silverThreshold: '500',
    goldThreshold: '1000',
    platinumThreshold: '2500',
  });

  // Delivery
  const [deliveryForm, setDeliveryForm] = useState({
    enabled: false,
    defaultFee: '5.00',
    minimumOrder: '50.00',
  });

  // Merch
  const [merchForm, setMerchForm] = useState({
    enabled: false,
    stripePublishableKey: '',
    stripeSecretKey: '',
  });

  // Receipts
  const [receiptForm, setReceiptForm] = useState({
    headerText: '',
    footerText: '',
    showLogo: true,
  });

  useEffect(() => {
    if (company) {
      const settings = company.settings || {};
      setGeneralForm({
        name: company.name || '',
        address: company.address || '',
        phone: company.phone || '',
        email: company.email || '',
        taxRate: settings.taxRate?.toString() || '0',
      });
      if (settings.storeHours) setStoreHours({ ...defaultHours(), ...settings.storeHours });
      if (settings.loyalty) setLoyaltyForm({ ...loyaltyForm, ...settings.loyalty, enabled: !!settings.loyalty?.enabled });
      if (settings.delivery) setDeliveryForm({ ...deliveryForm, ...settings.delivery, enabled: !!settings.delivery?.enabled });
      if (settings.merch) setMerchForm({ ...merchForm, ...settings.merch, enabled: !!settings.merch?.enabled });
      if (settings.receipts) setReceiptForm({ ...receiptForm, ...settings.receipts, showLogo: settings.receipts?.showLogo !== false });
    }
    loadUsers();
  }, [company]);

  const loadUsers = async () => {
    try {
      const data = await api.company.users();
      setUsers(Array.isArray(data) ? data : (data?.data || []));
    } catch (err) {
      console.error('Failed to load users');
    }
  };

  const saveSettings = async (section: string) => {
    setSaving(true);
    try {
      const payload: any = {};

      if (section === 'general') {
        payload.name = generalForm.name;
        payload.address = generalForm.address;
        payload.phone = generalForm.phone;
        payload.email = generalForm.email;
        payload.settings = {
          ...(company?.settings || {}),
          taxRate: parseFloat(generalForm.taxRate) || 0,
          storeHours,
        };
      } else if (section === 'loyalty') {
        payload.settings = {
          ...(company?.settings || {}),
          loyalty: {
            enabled: loyaltyForm.enabled,
            pointsPerDollar: loyaltyForm.pointsPerDollar,
            bronzeThreshold: loyaltyForm.bronzeThreshold,
            silverThreshold: loyaltyForm.silverThreshold,
            goldThreshold: loyaltyForm.goldThreshold,
            platinumThreshold: loyaltyForm.platinumThreshold,
          },
        };
      } else if (section === 'delivery') {
        payload.settings = {
          ...(company?.settings || {}),
          delivery: {
            enabled: deliveryForm.enabled,
            defaultFee: deliveryForm.defaultFee,
            minimumOrder: deliveryForm.minimumOrder,
          },
        };
      } else if (section === 'merch') {
        payload.settings = {
          ...(company?.settings || {}),
          merch: {
            enabled: merchForm.enabled,
            stripePublishableKey: merchForm.stripePublishableKey,
            stripeSecretKey: merchForm.stripeSecretKey,
          },
        };
      } else if (section === 'receipts') {
        payload.settings = {
          ...(company?.settings || {}),
          receipts: {
            headerText: receiptForm.headerText,
            footerText: receiptForm.footerText,
            showLogo: receiptForm.showLogo,
          },
        };
      }

      const updated = await api.company.update(payload);
      updateCompany(updated);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateHours = (day: string, field: keyof DayHours, value: string | boolean) => {
    setStoreHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'loyalty', label: 'Loyalty', icon: Gift },
    { id: 'delivery', label: 'Delivery', icon: Truck },
    { id: 'merch', label: 'Merch', icon: ShoppingBag },
    { id: 'receipts', label: 'Receipts', icon: Receipt },
    { id: 'team', label: 'Team', icon: Users },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-48 space-y-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left transition ${
                tab === t.id ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <t.icon className="w-5 h-5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 bg-white rounded-lg shadow-sm p-6">
          {/* GENERAL */}
          {tab === 'general' && (
            <div className="space-y-6 max-w-2xl">
              <h2 className="text-lg font-semibold">Store Information</h2>

              <div className="space-y-4">
                <div>
                  <FieldLabel>Store Name</FieldLabel>
                  <Input value={generalForm.name} onChange={v => setGeneralForm({ ...generalForm, name: v })} />
                </div>

                <div>
                  <FieldLabel>Address</FieldLabel>
                  <Input value={generalForm.address} onChange={v => setGeneralForm({ ...generalForm, address: v })} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Phone</FieldLabel>
                    <Input value={generalForm.phone} onChange={v => setGeneralForm({ ...generalForm, phone: v })} type="tel" />
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <Input value={generalForm.email} onChange={v => setGeneralForm({ ...generalForm, email: v })} type="email" />
                  </div>
                </div>

                <div className="w-48">
                  <FieldLabel>Tax Rate (%)</FieldLabel>
                  <div className="relative">
                    <Input
                      value={generalForm.taxRate}
                      onChange={v => setGeneralForm({ ...generalForm, taxRate: v })}
                      type="number"
                      placeholder="0.00"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>
              </div>

              {/* Store Hours */}
              <div>
                <h3 className="text-md font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Store Hours
                </h3>
                <div className="space-y-2">
                  {DAYS.map(day => (
                    <div key={day} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
                      <span className="w-24 text-sm font-medium text-gray-700">{DAY_LABELS[day]}</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!storeHours[day]?.closed}
                          onChange={e => updateHours(day, 'closed', !e.target.checked)}
                          className="w-4 h-4 rounded text-green-600 focus:ring-green-500"
                        />
                        <span className="text-sm text-gray-500">{storeHours[day]?.closed ? 'Closed' : 'Open'}</span>
                      </label>
                      {!storeHours[day]?.closed && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input
                            type="time"
                            value={storeHours[day]?.open || '09:00'}
                            onChange={e => updateHours(day, 'open', e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                          <span className="text-gray-400 text-sm">to</span>
                          <input
                            type="time"
                            value={storeHours[day]?.close || '21:00'}
                            onChange={e => updateHours(day, 'close', e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={() => saveSettings('general')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}

          {/* LOYALTY */}
          {tab === 'loyalty' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Loyalty Program</h2>

              <Toggle
                enabled={loyaltyForm.enabled}
                onChange={v => setLoyaltyForm({ ...loyaltyForm, enabled: v })}
                label={loyaltyForm.enabled ? 'Loyalty program is active' : 'Loyalty program is disabled'}
              />

              {loyaltyForm.enabled && (
                <div className="space-y-5 pt-2">
                  <div className="w-48">
                    <FieldLabel>Points per Dollar Spent</FieldLabel>
                    <Input
                      value={loyaltyForm.pointsPerDollar}
                      onChange={v => setLoyaltyForm({ ...loyaltyForm, pointsPerDollar: v })}
                      type="number"
                      placeholder="1"
                    />
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Tier Thresholds (points required)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <FieldLabel>Bronze</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-700" />
                          <input
                            type="number"
                            value={loyaltyForm.bronzeThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, bronzeThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Silver</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-gray-400" />
                          <input
                            type="number"
                            value={loyaltyForm.silverThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, silverThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Gold</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-yellow-500" />
                          <input
                            type="number"
                            value={loyaltyForm.goldThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, goldThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Platinum</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-400" />
                          <input
                            type="number"
                            value={loyaltyForm.platinumThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, platinumThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('loyalty')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Loyalty Settings'}
              </Button>
            </div>
          )}

          {/* DELIVERY */}
          {tab === 'delivery' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Delivery Settings</h2>

              <Toggle
                enabled={deliveryForm.enabled}
                onChange={v => setDeliveryForm({ ...deliveryForm, enabled: v })}
                label={deliveryForm.enabled ? 'Delivery is enabled' : 'Delivery is disabled'}
              />

              {deliveryForm.enabled && (
                <div className="space-y-4 pt-2">
                  <div className="w-56">
                    <FieldLabel>Default Delivery Fee ($)</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={deliveryForm.defaultFee}
                        onChange={e => setDeliveryForm({ ...deliveryForm, defaultFee: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                  </div>

                  <div className="w-56">
                    <FieldLabel>Minimum Order Amount ($)</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={deliveryForm.minimumOrder}
                        onChange={e => setDeliveryForm({ ...deliveryForm, minimumOrder: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('delivery')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Delivery Settings'}
              </Button>
            </div>
          )}

          {/* MERCH */}
          {tab === 'merch' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Merch Store</h2>

              <Toggle
                enabled={merchForm.enabled}
                onChange={v => setMerchForm({ ...merchForm, enabled: v })}
                label={merchForm.enabled ? 'Merch store is active' : 'Merch store is disabled'}
              />

              {merchForm.enabled && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm text-gray-500">
                    Connect your Stripe account to accept payments for merchandise.
                  </p>
                  <div>
                    <FieldLabel>Stripe Publishable Key</FieldLabel>
                    <Input
                      value={merchForm.stripePublishableKey}
                      onChange={v => setMerchForm({ ...merchForm, stripePublishableKey: v })}
                      placeholder="pk_live_..."
                    />
                  </div>
                  <div>
                    <FieldLabel>Stripe Secret Key</FieldLabel>
                    <Input
                      value={merchForm.stripeSecretKey}
                      onChange={v => setMerchForm({ ...merchForm, stripeSecretKey: v })}
                      type="password"
                      placeholder="sk_live_..."
                    />
                    <p className="text-xs text-gray-400 mt-1">This key is stored securely and never exposed to the frontend.</p>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('merch')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Merch Settings'}
              </Button>
            </div>
          )}

          {/* RECEIPTS */}
          {tab === 'receipts' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Receipt Settings</h2>

              <div className="space-y-4">
                <div>
                  <FieldLabel>Receipt Header Text</FieldLabel>
                  <textarea
                    value={receiptForm.headerText}
                    onChange={e => setReceiptForm({ ...receiptForm, headerText: e.target.value })}
                    rows={3}
                    placeholder="Text printed at the top of receipts (e.g. store name, license info)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                  />
                </div>

                <div>
                  <FieldLabel>Receipt Footer Text</FieldLabel>
                  <textarea
                    value={receiptForm.footerText}
                    onChange={e => setReceiptForm({ ...receiptForm, footerText: e.target.value })}
                    rows={3}
                    placeholder="Text printed at the bottom (e.g. return policy, thank you message)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                  />
                </div>

                <Toggle
                  enabled={receiptForm.showLogo}
                  onChange={v => setReceiptForm({ ...receiptForm, showLogo: v })}
                  label={receiptForm.showLogo ? 'Show logo on receipts' : 'Logo hidden on receipts'}
                />
              </div>

              <Button onClick={() => saveSettings('receipts')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Receipt Settings'}
              </Button>
            </div>
          )}

          {/* TEAM */}
          {tab === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Team Members</h2>
                <Button onClick={() => navigate('/crm/team')}>
                  Manage Team
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No team members found</td>
                      </tr>
                    )}
                    {users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">{u.firstName} {u.lastName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{u.email}</td>
                        <td className="px-4 py-3 text-sm capitalize">{u.role}</td>
                        <td className="px-4 py-3 text-sm">
                          {u.isActive
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Inactive</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
