import { useState } from 'react';
import { X, Stethoscope } from 'lucide-react';
import api from '../../services/api';

/**
 * Visit editor — create/update a visit (vitals + SOAP) for a patient.
 * POST /api/visits (new) or PUT /api/visits/:id (edit).
 * Diagnoses are entered comma-separated and sent as string[].
 */

export interface Visit {
  id?: string;
  patientId?: string;
  appointmentId?: string | null;
  providerId?: string | null;
  visitDate?: string;
  reason?: string;
  weightLb?: number | string;
  temperatureF?: number | string;
  heartRate?: number | string;
  respRate?: number | string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  diagnoses?: string[];
  treatments?: string;
  notes?: string;
  total?: number | string;
}

interface VisitEditorModalProps {
  patientId: string;
  visit?: Visit | null;
  onSave: () => void;
  onClose: () => void;
}

function toDateInput(s?: string): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export default function VisitEditorModal({ patientId, visit, onSave, onClose }: VisitEditorModalProps) {
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({
    visitDate: toDateInput(visit?.visitDate),
    reason: visit?.reason || '',
    weightLb: visit?.weightLb ?? '',
    temperatureF: visit?.temperatureF ?? '',
    heartRate: visit?.heartRate ?? '',
    respRate: visit?.respRate ?? '',
    subjective: visit?.subjective || '',
    objective: visit?.objective || '',
    assessment: visit?.assessment || '',
    plan: visit?.plan || '',
    diagnoses: (visit?.diagnoses || []).join(', '),
    treatments: visit?.treatments || '',
    notes: visit?.notes || '',
    total: visit?.total ?? '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        patientId,
        visitDate: form.visitDate,
      };
      if (form.reason) payload.reason = form.reason;
      if (form.weightLb !== '') payload.weightLb = Number(form.weightLb);
      if (form.temperatureF !== '') payload.temperatureF = Number(form.temperatureF);
      if (form.heartRate !== '') payload.heartRate = Number(form.heartRate);
      if (form.respRate !== '') payload.respRate = Number(form.respRate);
      if (form.subjective) payload.subjective = form.subjective;
      if (form.objective) payload.objective = form.objective;
      if (form.assessment) payload.assessment = form.assessment;
      if (form.plan) payload.plan = form.plan;
      const diagnoses = form.diagnoses.split(',').map((s) => s.trim()).filter(Boolean);
      if (diagnoses.length) payload.diagnoses = diagnoses;
      if (form.treatments) payload.treatments = form.treatments;
      if (form.notes) payload.notes = form.notes;
      if (form.total !== '') payload.total = Number(form.total);

      if (visit?.id) {
        await api.put(`/api/visits/${visit.id}`, payload);
      } else {
        await api.post('/api/visits', payload);
      }
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save visit');
    } finally {
      setSaving(false);
    }
  };

  const numField = (k: string, label: string) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      <input
        type="number"
        step="any"
        value={(form as Record<string, string>)[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
    </div>
  );

  const soapField = (k: string, label: string, placeholder: string) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      <textarea
        value={(form as Record<string, string>)[k]}
        onChange={(e) => set(k, e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-lg"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-purple-500" />
              {visit?.id ? 'Edit Visit' : 'New Visit'}
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Visit Date</label>
                <input type="date" value={form.visitDate} onChange={(e) => set('visitDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Reason</label>
                <input type="text" value={form.reason} onChange={(e) => set('reason', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            {/* Vitals */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 dark:text-slate-200">Vitals</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {numField('weightLb', 'Weight (lb)')}
                {numField('temperatureF', 'Temp (°F)')}
                {numField('heartRate', 'Heart Rate')}
                {numField('respRate', 'Resp Rate')}
              </div>
            </div>

            {/* SOAP */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 dark:text-slate-200">SOAP</h3>
              <div className="space-y-3">
                {soapField('subjective', 'Subjective', "Owner's report / history")}
                {soapField('objective', 'Objective', 'Exam findings')}
                {soapField('assessment', 'Assessment', 'Clinical impression')}
                {soapField('plan', 'Plan', 'Diagnostics, treatment, follow-up')}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Diagnoses <span className="text-xs text-gray-400">(comma-separated)</span></label>
              <input type="text" value={form.diagnoses} onChange={(e) => set('diagnoses', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Otitis externa, Dental disease" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Treatments</label>
              <textarea value={form.treatments} onChange={(e) => set('treatments', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Total ($)</label>
                <input type="number" step="any" value={form.total} onChange={(e) => set('total', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Visit'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
