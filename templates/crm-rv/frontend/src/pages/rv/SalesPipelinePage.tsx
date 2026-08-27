import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Upload, User, Phone, Mail, Calculator } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import DealDeskModal from './DealDeskModal';

/**
 * RV Sales Pipeline — kanban over /api/sales-leads.
 *
 * Rows are shaped: { lead: {...}, contactName, contactPhone, contactEmail,
 * unitYear, unitMake, unitModelName, salespersonFirstName, salespersonLastName }.
 * Stage VALUES drive everything; labels are display-only.
 */

const STAGES: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'demo', label: 'Demo' },
  { value: 'desking', label: 'Desking' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
];

const STAGE_ACCENT: Record<string, string> = {
  new: 'border-t-blue-400',
  contacted: 'border-t-indigo-400',
  demo: 'border-t-purple-400',
  desking: 'border-t-amber-400',
  closed_won: 'border-t-green-500',
  closed_lost: 'border-t-gray-400',
};

interface LeadRow {
  lead: {
    id: string;
    stage: string;
    source?: string;
    notes?: string | null;
    tradeInInfo?: string | null;
    followUpDate?: string | null;
    unitId?: string | null;
    createdAt?: string;
  };
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  unitYear?: number | null;
  unitMake?: string | null;
  unitModelName?: string | null;
  salespersonFirstName?: string | null;
  salespersonLastName?: string | null;
}

function salespersonName(row: LeadRow): string {
  const name = [row.salespersonFirstName, row.salespersonLastName].filter(Boolean).join(' ');
  return name || 'Unassigned';
}

function unitDesc(row: LeadRow): string {
  return [row.unitYear, row.unitMake, row.unitModelName].filter(Boolean).join(' ') || 'No unit selected';
}

export default function SalesPipelinePage() {
  const { hasFeature } = useAuth();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [showAdf, setShowAdf] = useState<boolean>(false);
  const [deskLead, setDeskLead] = useState<LeadRow['lead'] | null>(null);

  const canDealDesk = hasFeature('deal_desk');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/sales-leads?limit=500');
      setRows(res.data || []);
    } catch (error) {
      console.error('Failed to load pipeline:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveTo = async (id: string, stage: string) => {
    // Optimistic move by stage VALUE
    setRows((prev) => prev.map((r) => (r.lead.id === id ? { ...r, lead: { ...r.lead, stage } } : r)));
    try {
      await api.put(`/api/sales-leads/${id}`, { stage });
    } catch {
      alert('Failed to move lead');
      load();
    }
  };

  const grouped: Record<string, LeadRow[]> = {};
  STAGES.forEach((s) => (grouped[s.value] = []));
  rows.forEach((r) => {
    const stage = r.lead.stage || 'new';
    if (!grouped[stage]) grouped[stage] = [];
    grouped[stage].push(r);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Sales Pipeline</h1>
          <p className="text-gray-500 dark:text-slate-400">Track deals from first contact to delivery</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdf(true)} className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50">
            <Upload className="w-4 h-4" /> Import ADF
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
            <Plus className="w-4 h-4" /> New Lead
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <div
              key={stage.value}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId) { moveTo(dragId, stage.value); setDragId(null); } }}
              className={`flex-shrink-0 w-72 bg-gray-50 rounded-xl border-t-4 ${STAGE_ACCENT[stage.value] || 'border-t-gray-300'}`}
            >
              <div className="p-3 flex items-center justify-between">
                <span className="font-semibold text-gray-900 dark:text-slate-100">{stage.label}</span>
                <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border dark:text-slate-400 dark:bg-slate-900">{grouped[stage.value].length}</span>
              </div>
              <div className="px-2 pb-3 space-y-2 min-h-[80px]">
                {grouped[stage.value].map((row) => (
                  <div
                    key={row.lead.id}
                    draggable
                    onDragStart={() => setDragId(row.lead.id)}
                    className="bg-white rounded-lg border p-3 cursor-grab active:cursor-grabbing space-y-2 hover:shadow-sm dark:bg-slate-900"
                  >
                    <p className="font-medium text-gray-900 flex items-center gap-1 dark:text-slate-100">
                      <User className="w-4 h-4 text-gray-400" /> {row.contactName || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{unitDesc(row)}</p>
                    {row.contactPhone && (
                      <p className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" /> {row.contactPhone}</p>
                    )}
                    {row.contactEmail && (
                      <p className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {row.contactEmail}</p>
                    )}
                    {row.lead.tradeInInfo && (
                      <p className="text-xs text-amber-600">Trade-in: {row.lead.tradeInInfo}</p>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t">
                      <span className="text-xs text-gray-400">{salespersonName(row)}</span>
                      {row.lead.source && <span className="text-xs text-gray-400">{row.lead.source}</span>}
                    </div>
                    {canDealDesk && (
                      <button
                        type="button"
                        onClick={() => setDeskLead(row.lead)}
                        className="w-full flex items-center justify-center gap-1 text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded px-2 py-1"
                      >
                        <Calculator className="w-3 h-3" /> Deal Desk
                      </button>
                    )}
                    {/* Mobile-friendly stage selector (drag fallback) */}
                    <select
                      value={row.lead.stage}
                      onChange={(e) => moveTo(row.lead.id, e.target.value)}
                      className="w-full text-xs border rounded px-2 py-1 text-gray-600 dark:text-slate-400"
                    >
                      {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                ))}
                {grouped[stage.value].length === 0 && (
                  <p className="text-center text-xs text-gray-400 py-4">No leads</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <LeadFormModal onSave={() => { setShowForm(false); load(); }} onClose={() => setShowForm(false)} />}
      {showAdf && <AdfImportModal onSave={() => { setShowAdf(false); load(); }} onClose={() => setShowAdf(false)} />}
      {deskLead && (
        <DealDeskModal
          lead={deskLead}
          onClose={() => setDeskLead(null)}
          onSaved={() => { setDeskLead(null); load(); }}
        />
      )}
    </div>
  );
}

/* ---------------- New Lead Modal ---------------- */

interface ContactOption { id: string; name: string }
interface UnitOption { id: string; year?: number; make?: string; modelName?: string }
interface UserOption { id: string; firstName?: string; lastName?: string }

interface LeadFormModalProps { onSave: () => void; onClose: () => void }

function LeadFormModal({ onSave, onClose }: LeadFormModalProps) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({
    contactId: '', unitId: '', assignedTo: '',
    source: 'web', stage: 'new', notes: '', tradeInInfo: '', followUpDate: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const [contactsRes, unitsRes, teamRes] = await Promise.all([
          api.get('/api/contacts?limit=500'),
          api.get('/api/units?limit=500'),
          api.get('/api/team?limit=500'),
        ]);
        setContacts(contactsRes.data || []);
        setUnits(unitsRes.data || []);
        setUsers(teamRes.data || []);
      } catch {
        /* dropdowns degrade gracefully */
      }
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.contactId) { alert('Contact is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/sales-leads', {
        contactId: form.contactId,
        unitId: form.unitId || undefined,
        assignedTo: form.assignedTo || undefined,
        source: form.source || 'web',
        stage: form.stage || 'new',
        notes: form.notes || undefined,
        tradeInInfo: form.tradeInInfo || undefined,
        followUpDate: form.followUpDate || undefined,
      });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to create lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">New Sales Lead</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Contact <span className="text-red-500">*</span></label>
              <select value={form.contactId} onChange={(e) => set('contactId', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select contact...</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Unit of Interest</label>
              <select value={form.unitId} onChange={(e) => set('unitId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                <option value="">None</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{[u.year, u.make, u.modelName].filter(Boolean).join(' ') || u.id}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Salesperson</label>
                <select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Stage</label>
                <select value={form.stage} onChange={(e) => set('stage', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Source</label>
                <input type="text" value={form.source} onChange={(e) => set('source', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="web, walk-in, phone..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Follow-Up Date</label>
                <input type="date" value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Trade-In Info</label>
              <input type="text" value={form.tradeInInfo} onChange={(e) => set('tradeInInfo', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Saving...' : 'Create Lead'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------- ADF Import Modal ---------------- */

interface AdfImportModalProps { onSave: () => void; onClose: () => void }

function AdfImportModal({ onSave, onClose }: AdfImportModalProps) {
  const [xml, setXml] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!xml.trim()) { alert('Paste ADF/XML content'); return; }
    setSaving(true);
    try {
      await api.post('/api/sales-leads/import-adf', { xml });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to import ADF');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Import ADF Lead</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">Paste ADF/XML from your lead provider to auto-create a contact and lead.</p>
            <textarea
              value={xml}
              onChange={(e) => setXml(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border rounded-lg font-mono text-xs"
              placeholder="<?adf?><adf><prospect>...</prospect></adf>"
            />
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
