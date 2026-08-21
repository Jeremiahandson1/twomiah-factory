import { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Copy, Check, DollarSign, Clock, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import BookingSettingsTab from './BookingSettingsTab';
import { useToast } from '../../contexts/ToastContext';

interface BookingRow {
  id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  scheduled_date?: string;
  status?: string;
  confirmation_code?: string;
  service_name?: string;
  appointment_status?: string;
  deposit_amount?: string | number;
  deposit_status?: string;
  [k: string]: unknown;
}

interface BookableService {
  id?: string;
  name: string;
  description?: string;
  duration_minutes?: number;
  durationMinutes?: number;
  price?: string | number;
  deposit_required?: boolean;
  depositRequired?: boolean;
  deposit_amount?: string | number;
  depositAmount?: string | number;
  active?: boolean;
  [k: string]: unknown;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
};

const DEPOSIT_STYLES: Record<string, string> = {
  none: 'text-gray-400',
  pending: 'text-yellow-600',
  paid: 'text-green-600',
  failed: 'text-red-600',
};

const money = (v: unknown) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export default function BookingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'bookings' | 'services' | 'embed' | 'settings'>('bookings');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [services, setServices] = useState<BookableService[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<BookableService | null>(null);
  const [embed, setEmbed] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([
        api.get('/api/booking', statusFilter ? { status: statusFilter } : {}),
        api.get('/api/booking/services'),
      ]);
      setBookings(Array.isArray(b) ? b : b.data || []);
      setServices(Array.isArray(s) ? s : s.data || []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load bookings');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'embed' || embed) return;
    api.get('/api/booking/embed-code')
      .then((r: { embedCode?: string }) => setEmbed(r?.embedCode || ''))
      .catch(() => setEmbed(''));
  }, [tab, embed]);

  const saveService = async (form: BookableService) => {
    try {
      const payload = {
        name: form.name,
        description: form.description || '',
        durationMinutes: Number(form.durationMinutes || form.duration_minutes || 60),
        price: Number(form.price || 0),
        depositRequired: !!(form.depositRequired ?? form.deposit_required),
        depositAmount: Number(form.depositAmount ?? form.deposit_amount ?? 0),
        active: form.active !== false,
      };
      if (form.id) await api.put(`/api/booking/services/${form.id}`, payload);
      else await api.post('/api/booking/services', payload);
      toast.success('Service saved');
      setEditing(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save service');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Online Booking</h1>
          <p className="text-gray-500">What customers can book, and what they have booked</p>
        </div>
        {tab === 'services' && (
          <button
            onClick={() => setEditing({ name: '', durationMinutes: 60, price: 0, depositRequired: false, depositAmount: 0, active: true })}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" /> New Service
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b mb-6">
        {([['bookings', 'Bookings'], ['services', 'Bookable Services'], ['settings', 'Settings'], ['embed', 'Embed Code']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bookings' && (
        <>
          <div className="mb-4">
            <select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All statuses</option>
              <option value="pending">Pending (deposit unpaid)</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">Loading...</div>
          ) : bookings.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No online bookings yet.</p>
              <p className="text-sm text-gray-400 mt-1">Add a bookable service, then put the embed code on your website.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Service</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">When</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Deposit</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{b.customer_name || '-'}</div>
                        <div className="text-xs text-gray-500">{b.customer_email}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{b.service_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {b.scheduled_date ? new Date(b.scheduled_date).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_STYLES[b.status || ''] || 'bg-gray-100 text-gray-600'}`}>
                          {(b.status || '').replace(/\b\w/g, (ch) => ch.toUpperCase())}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-xs ${DEPOSIT_STYLES[b.deposit_status || 'none']}`}>
                        {b.deposit_status && b.deposit_status !== 'none'
                          ? `${money(b.deposit_amount)} ${b.deposit_status}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{b.confirmation_code || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'services' && (
        <div className="space-y-3">
          {services.length === 0 && !loading && (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-500">
              No bookable services yet. Add one so customers have something to book.
            </div>
          )}
          {services.map((s) => {
            const depositOn = !!(s.depositRequired ?? s.deposit_required);
            return (
              <div key={s.id} className="bg-white rounded-xl border p-4 flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900">{s.name}</div>
                  {s.description && <div className="text-sm text-gray-500">{s.description}</div>}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Number(s.durationMinutes ?? s.duration_minutes ?? 60)} min</span>
                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{money(s.price)}</span>
                    <span className={depositOn ? 'text-orange-600' : ''}>
                      {depositOn ? `Deposit ${money(s.depositAmount ?? s.deposit_amount)}` : 'No deposit'}
                    </span>
                    {s.active === false && <span className="text-red-500">Inactive</span>}
                  </div>
                </div>
                <button onClick={() => setEditing(s)} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Edit</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'settings' && <BookingSettingsTab />}

      {tab === 'embed' && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold mb-2">Put booking on your website</h2>
          <p className="text-sm text-gray-500 mb-4">
            Paste this where you want the booking form to appear. If a service requires a deposit, the customer pays it
            before the slot is confirmed.
          </p>
          <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">{embed || 'Loading...'}</pre>
          <button
            onClick={() => { navigator.clipboard?.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            disabled={!embed}
            className="mt-3 flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy embed code'}
          </button>
        </div>
      )}

      {editing && (
        <ServiceModal service={editing} onClose={() => setEditing(null)} onSave={saveService} />
      )}
    </div>
  );
}

interface ServiceModalProps {
  service: BookableService;
  onClose: () => void;
  onSave: (s: BookableService) => void;
}

function ServiceModal({ service, onClose, onSave }: ServiceModalProps) {
  const [form, setForm] = useState<BookableService>({
    ...service,
    durationMinutes: Number(service.durationMinutes ?? service.duration_minutes ?? 60),
    depositRequired: !!(service.depositRequired ?? service.deposit_required),
    depositAmount: Number(service.depositAmount ?? service.deposit_amount ?? 0),
    price: Number(service.price ?? 0),
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">{form.id ? 'Edit Service' : 'New Bookable Service'}</h2>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input value={form.name} required onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={(form.description as string) || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
                <input type="number" min={5} step={5} value={Number(form.durationMinutes)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                <input type="number" min={0} step="0.01" value={Number(form.price)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.depositRequired}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, depositRequired: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                <span className="text-sm font-medium text-gray-700">Require a deposit to hold the slot</span>
              </label>
              {form.depositRequired && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Deposit amount</label>
                  <input type="number" min={0} step="0.01" value={Number(form.depositAmount)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, depositAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg" />
                  <p className="mt-1 text-xs text-gray-500">
                    The booking stays pending until this is paid. Requires card payments to be set up.
                  </p>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.active !== false}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, active: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <span className="text-sm text-gray-700">Bookable now</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
