import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2, User, AlertTriangle, X } from 'lucide-react';
import api from '../../services/api';

/**
 * Clients — searchable list backed by /api/clients (contacts left-joined to
 * their salon profile). Each row links to the client chart.
 *
 * "New Client" creates the CONTACT and then upserts the salon profile, because
 * a salon client is a contact — there is no separate client record to create.
 */

const HAIR_TYPES = ['', 'Fine', 'Medium', 'Coarse', 'Curly', 'Coily', 'Wavy', 'Straight', 'Color-treated'];

interface Client {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  hairType?: string;
  allergies?: string;
  patchTestAt?: string;
  preferences?: string;
  stylistFirstName?: string;
  stylistLastName?: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/clients?search=${encodeURIComponent(search)}`);
      setClients(res.data || []);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Clients</h1>
          <p className="text-gray-500 dark:text-slate-400">Everyone who sits in your chairs</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> New Client
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No clients found</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Hair</th>
                <th className="px-4 py-3 font-medium">Regular Stylist</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/crm/clients/${c.id}`} className="flex items-center gap-2 font-medium text-gray-900 hover:text-teal-600 dark:text-slate-100">
                      <User className="w-4 h-4 text-teal-500" />
                      {c.name || 'Unnamed'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                    <div>{c.mobile || c.phone || '—'}</div>
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{c.hairType || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                    {[c.stylistFirstName, c.stylistLastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {c.allergies && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={c.allergies}>
                        <AlertTriangle className="w-3 h-3" /> Allergy
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <NewClientModal
          onSave={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

/* ---------------- New Client Modal ---------------- */

function NewClientModal({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    hairType: '', allergies: '', patchTestAt: '', preferences: '', pronouns: '', birthday: '', notes: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Client name is required'); return; }
    setSaving(true);
    try {
      const contact = await api.post('/api/contacts', {
        type: 'client',
        name: form.name.trim(),
        phone: form.phone || undefined,
        mobile: form.phone || undefined,
        email: form.email || undefined,
      });
      const contactId = contact?.id;
      if (!contactId) throw new Error('Client was created but no id came back');

      // Only write a profile if there is something salon-specific to store —
      // an empty profile row would just be noise on the chart.
      const profile: Record<string, unknown> = {};
      (['hairType', 'allergies', 'patchTestAt', 'preferences', 'pronouns', 'birthday', 'notes'] as const)
        .forEach((k) => { if (form[k]) profile[k] = form[k]; });
      if (Object.keys(profile).length) {
        await api.put(`/api/clients/${contactId}/profile`, profile);
      }
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">New Client</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Mobile</label>
                <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Hair Type</label>
                <select value={form.hairType} onChange={(e) => set('hairType', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {HAIR_TYPES.map((h) => <option key={h} value={h}>{h || '—'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Pronouns</label>
                <input type="text" value={form.pronouns} onChange={(e) => set('pronouns', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Birthday</label>
                <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Patch Test</label>
                <input type="date" value={form.patchTestAt} onChange={(e) => set('patchTestAt', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                Allergies / sensitivities <span className="text-xs text-gray-400">(shown as a red banner on the chart)</span>
              </label>
              <input type="text" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="PPD sensitivity, latex, fragrance..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Preferences</label>
              <input type="text" value={form.preferences} onChange={(e) => set('preferences', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Drink order, quiet appointment, parking..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Create Client'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
