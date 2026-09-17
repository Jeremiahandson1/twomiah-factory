import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

export interface SiteOption { id: string; name: string; address?: string | null; contactName?: string | null }

/** Loads this company's properties once and keeps them; callers re-use the same list. */
export function useSites() {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const load = async () => {
    try { const res = await api.get('/api/sites'); setSites(res.data || []); }
    catch { /* an empty list is handled by the picker's own message */ }
  };
  useEffect(() => { load(); }, []);
  return { sites, reloadSites: load };
}

/**
 * Pick the property (site) a price or a snow contract is for — the pages used to ask the operator to type a
 * 24-character internal id, and nothing in the app could create or list one. (Landscaping T14 M7)
 * "+ Add property" saves a new one (name, address, customer) and selects it, without leaving the page.
 */
export function SitePicker({ id, value, sites, onChange, onAdded, allowAdd = true }: {
  id: string; value: string; sites: SiteOption[]; onChange: (siteId: string) => void; onAdded?: () => void; allowAdd?: boolean;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ name: '', address: '', contactId: '' });

  const openAdd = async () => {
    setAdding(true);
    try { const res = await api.get('/api/contacts?limit=200'); setContacts(res.data || []); }
    catch { toast.error('Could not load customers'); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const created = await api.post('/api/sites', form);
      toast.success(`Property "${created.name}" added`);
      setAdding(false); setForm({ name: '', address: '', contactId: '' });
      onAdded?.(); onChange(created.id);
    } catch (e: any) { toast.error(e?.message || 'Could not add the property'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex gap-2">
        <select id={id} className="w-full border rounded px-2 py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{sites.length ? 'Select a property…' : 'No properties yet — add one'}</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}
        </select>
        {allowAdd && !adding && (
          <button type="button" onClick={openAdd} className="shrink-0 text-xs border rounded px-2 py-1.5 flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-slate-800">
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>
      {adding && (
        <div className="mt-2 border rounded p-2 space-y-2 bg-gray-50 dark:bg-slate-800">
          <div>
            <label htmlFor={`${id}-new-name`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Property name</label>
            <input id={`${id}-new-name`} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="Maple Plaza — parking lot" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-new-address`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Address</label>
            <input id={`${id}-new-address`} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="120 Maple St" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-new-contact`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Customer</label>
            <select id={`${id}-new-contact`} className="w-full border rounded px-2 py-1.5 text-sm" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
              <option value="">Select a customer…</option>
              {contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs disabled:opacity-50">{saving ? 'Saving…' : 'Save property'}</button>
            <button type="button" onClick={() => setAdding(false)} className="border rounded px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
