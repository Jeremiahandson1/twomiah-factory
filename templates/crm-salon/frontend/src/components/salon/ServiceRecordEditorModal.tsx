import { useState, useEffect } from 'react';
import { X, Scissors, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';

/**
 * Service record editor — the formula log.
 *
 * The formula is a repeatable list of {product, shade, parts} rather than a free
 * text blob: that is what lets a different stylist reproduce the colour when the
 * regular one is out, which is the whole retention argument for the record.
 */

export interface FormulaLine {
  product?: string;
  shade?: string;
  parts?: string;
}

export interface ServiceRecord {
  id?: string;
  contactId?: string;
  appointmentId?: string;
  stylistId?: string;
  serviceId?: string;
  performedAt?: string;
  formula?: FormulaLine[];
  developerVolume?: string;
  processingMin?: number | string;
  productsUsed?: string;
  result?: string;
  priceCharged?: number | string;
  notes?: string;
  serviceName?: string;
  stylistFirstName?: string;
  stylistLastName?: string;
}

interface ServiceOption { id: string; name?: string; price?: string | number }
interface StylistOption { id: string; firstName?: string; lastName?: string }

interface Props {
  contactId: string;
  record: ServiceRecord | null;
  appointmentId?: string;
  onSave: () => void;
  onClose: () => void;
}

function toDateInput(s?: string): string {
  const d = s ? new Date(s) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export default function ServiceRecordEditorModal({ contactId, record, appointmentId, onSave, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [stylists, setStylists] = useState<StylistOption[]>([]);
  const [formula, setFormula] = useState<FormulaLine[]>(
    record?.formula?.length ? record.formula : [{ product: '', shade: '', parts: '' }]
  );
  const [form, setForm] = useState({
    serviceId: record?.serviceId || '',
    stylistId: record?.stylistId || '',
    performedAt: toDateInput(record?.performedAt),
    developerVolume: record?.developerVolume || '',
    processingMin: record?.processingMin?.toString() || '',
    productsUsed: record?.productsUsed || '',
    result: record?.result || '',
    priceCharged: record?.priceCharged?.toString() || '',
    notes: record?.notes || '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [svcRes, teamRes] = await Promise.all([
          api.get('/api/service-menu'),
          api.get('/api/team?limit=500'),
        ]);
        setServices(svcRes.data || []);
        setStylists(teamRes.data || []);
      } catch {
        /* degrade gracefully — the record can still be written free-hand */
      }
    })();
  }, []);

  // Picking a service pre-fills the menu price, which is what actually gets
  // charged most of the time; the stylist can still override it.
  const onService = (id: string) => {
    set('serviceId', id);
    if (!form.priceCharged) {
      const svc = services.find((s) => s.id === id);
      if (svc?.price) set('priceCharged', String(svc.price));
    }
  };

  const setLine = (i: number, k: keyof FormulaLine, v: string) => {
    setFormula((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanFormula = formula.filter((l) => (l.product || '').trim() || (l.shade || '').trim());
      const payload: Record<string, unknown> = {
        contactId,
        performedAt: new Date(`${form.performedAt}T12:00:00`).toISOString(),
        formula: cleanFormula,
      };
      if (appointmentId) payload.appointmentId = appointmentId;
      if (form.serviceId) payload.serviceId = form.serviceId;
      if (form.stylistId) payload.stylistId = form.stylistId;
      if (form.developerVolume) payload.developerVolume = form.developerVolume;
      if (form.processingMin !== '') payload.processingMin = Number(form.processingMin);
      if (form.productsUsed) payload.productsUsed = form.productsUsed;
      if (form.result) payload.result = form.result;
      if (form.priceCharged !== '') payload.priceCharged = Number(form.priceCharged);
      if (form.notes) payload.notes = form.notes;

      if (record?.id) await api.put(`/api/service-records/${record.id}`, payload);
      else await api.post('/api/service-records', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save service record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Scissors className="w-5 h-5 text-teal-600" /> {record?.id ? 'Edit Service Record' : 'New Service Record'}
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
                <select value={form.serviceId} onChange={(e) => onService(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select service...</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stylist</label>
                <select value={form.stylistId} onChange={(e) => set('stylistId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {stylists.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={form.performedAt} onChange={(e) => set('performedAt', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            {/* Formula */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Formula</label>
                <button
                  type="button"
                  onClick={() => setFormula((rows) => [...rows, { product: '', shade: '', parts: '' }])}
                  className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
                >
                  <Plus className="w-3 h-3" /> Add line
                </button>
              </div>
              <div className="space-y-2">
                {formula.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input
                      type="text" value={line.product || ''} onChange={(e) => setLine(i, 'product', e.target.value)}
                      placeholder="Product / line" className="col-span-5 px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      type="text" value={line.shade || ''} onChange={(e) => setLine(i, 'shade', e.target.value)}
                      placeholder="Shade" className="col-span-4 px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      type="text" value={line.parts || ''} onChange={(e) => setLine(i, 'parts', e.target.value)}
                      placeholder="Parts" className="col-span-2 px-3 py-2 border rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setFormula((rows) => (rows.length === 1 ? [{ product: '', shade: '', parts: '' }] : rows.filter((_, idx) => idx !== i)))}
                      className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-600"
                      title="Remove line"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Developer</label>
                <input type="text" value={form.developerVolume} onChange={(e) => set('developerVolume', e.target.value)} placeholder="20 vol" className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Processing (min)</label>
                <input type="number" value={form.processingMin} onChange={(e) => set('processingMin', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price charged ($)</label>
                <input type="number" step="any" value={form.priceCharged} onChange={(e) => set('priceCharged', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Other products used</label>
              <input type="text" value={form.productsUsed} onChange={(e) => set('productsUsed', e.target.value)} placeholder="Toner, bond builder, treatment..." className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Result <span className="text-xs text-gray-400">(what to repeat or change next time)</span></label>
              <textarea value={form.result} onChange={(e) => set('result', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Record'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
