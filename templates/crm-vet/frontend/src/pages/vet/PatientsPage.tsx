import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2, PawPrint, AlertTriangle, X } from 'lucide-react';
import api from '../../services/api';
import OwnerPicker, { ContactLite } from '../../components/vet/OwnerPicker';

/**
 * Patients — searchable list (pet name + owner) backed by /api/patients.
 * Each row links to the patient chart; "New Patient" modal picks an existing
 * owner contact and captures core signalment.
 */

const SPECIES = ['dog', 'cat', 'avian', 'reptile', 'equine', 'exotic', 'other'];
const SEXES = ['male', 'female', 'unknown'];

interface Patient {
  id: string;
  name?: string;
  species?: string;
  breed?: string;
  sex?: string;
  dob?: string;
  weightLb?: number | string;
  color?: string;
  alerts?: string;
  deceased?: boolean;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
}

export function ageFromDob(dob?: string): string {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) return '';
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths ? `${years}y ${remMonths}m` : `${years}y`;
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
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
      const res = await api.get(`/api/patients?search=${encodeURIComponent(search)}`);
      setPatients(res.data || []);
    } catch (error) {
      console.error('Failed to load patients:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Patients</h1>
          <p className="text-gray-500 dark:text-slate-400">Pets under your care</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> New Patient
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by pet or owner name..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No patients found</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Species / Breed</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Age</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/crm/patients/${p.id}`} className="flex items-center gap-2 font-medium text-gray-900 hover:text-teal-600 dark:text-slate-100">
                      <PawPrint className="w-4 h-4 text-teal-500" />
                      {p.name || 'Unnamed'}
                      {p.deceased && <span className="text-xs text-gray-400">(deceased)</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize dark:text-slate-400">
                    {[p.species, p.breed].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                    <div>{p.ownerName || '—'}</div>
                    {p.ownerPhone && <div className="text-xs text-gray-400">{p.ownerPhone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{ageFromDob(p.dob) || '—'}</td>
                  <td className="px-4 py-3">
                    {p.alerts && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={p.alerts}>
                        <AlertTriangle className="w-3 h-3" /> Alert
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
        <NewPatientModal
          onSave={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

/* ---------------- New Patient Modal ---------------- */

interface NewPatientModalProps {
  onSave: () => void;
  onClose: () => void;
  patient?: Record<string, unknown> | null;
}

export function NewPatientModal({ onSave, onClose, patient }: NewPatientModalProps) {
  const editing = !!patient;
  const [saving, setSaving] = useState<boolean>(false);
  const [ownerId, setOwnerId] = useState<string>((patient?.ownerId as string) || '');
  const [, setOwner] = useState<ContactLite | null>(null);
  const [form, setForm] = useState({
    name: (patient?.name as string) || '', species: (patient?.species as string) || 'dog',
    breed: (patient?.breed as string) || '', sex: (patient?.sex as string) || 'unknown',
    spayedNeutered: !!patient?.spayedNeutered,
    dob: ((patient?.dob as string) || '').slice(0, 10),
    weightLb: patient?.weightLb != null ? String(patient.weightLb) : '',
    color: (patient?.color as string) || '', microchip: (patient?.microchip as string) || '',
    bloodType: (patient?.bloodType as string) || '',
    insuranceProvider: (patient?.insuranceProvider as string) || '',
    insurancePolicy: (patient?.insurancePolicy as string) || '',
    allergies: (patient?.allergies as string) || '', alerts: (patient?.alerts as string) || '',
    rabiesTag: (patient?.rabiesTag as string) || '', notes: (patient?.notes as string) || '',
    deceased: !!patient?.deceased,
  });

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Patient name is required'); return; }
    if (!ownerId) { alert('An owner is required'); return; }
    setSaving(true);
    try {
      // On edit send every field (empty string clears it); on create keep the terse payload.
      const payload: Record<string, unknown> = {
        ownerId,
        name: form.name.trim(),
        species: form.species,
        sex: form.sex,
        spayedNeutered: form.spayedNeutered,
        deceased: form.deceased,
      };
      const put = (k: string, v: unknown) => { if (editing || v) payload[k] = v; };
      put('breed', form.breed);
      put('dob', form.dob || null);
      put('weightLb', form.weightLb ? Number(form.weightLb) : (editing ? null : undefined));
      put('color', form.color);
      put('microchip', form.microchip);
      put('bloodType', form.bloodType);
      put('insuranceProvider', form.insuranceProvider);
      put('insurancePolicy', form.insurancePolicy);
      put('allergies', form.allergies);
      put('alerts', form.alerts);
      put('rabiesTag', form.rabiesTag);
      put('notes', form.notes);
      if (editing) await api.put(`/api/patients/${patient!.id as string}`, payload);
      else await api.post('/api/patients', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || `Failed to ${editing ? 'update' : 'create'} patient`);
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
            <h2 className="text-lg font-bold">{editing ? 'Edit Patient' : 'New Patient'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Owner <span className="text-red-500">*</span></label>
              <OwnerPicker value={ownerId} onChange={(id, c) => { setOwnerId(id); setOwner(c); }} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Species</label>
                <select value={form.species} onChange={(e) => set('species', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Breed</label>
                <input type="text" value={form.breed} onChange={(e) => set('breed', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Sex</label>
                <select value={form.sex} onChange={(e) => set('sex', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {SEXES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date of Birth</label>
                <input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Weight (lb)</label>
                <input type="number" step="any" value={form.weightLb} onChange={(e) => set('weightLb', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Color</label>
                <input type="text" value={form.color} onChange={(e) => set('color', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Microchip</label>
                <input type="text" value={form.microchip} onChange={(e) => set('microchip', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Blood Type</label>
                <input type="text" value={form.bloodType} onChange={(e) => set('bloodType', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <input id="spayedNeutered" type="checkbox" checked={form.spayedNeutered} onChange={(e) => set('spayedNeutered', e.target.checked)} className="w-4 h-4" />
                <label htmlFor="spayedNeutered" className="text-sm font-medium text-gray-700 dark:text-slate-200">Spayed / Neutered</label>
              </div>
              {editing && (
                <div className="flex items-center gap-2">
                  <input id="deceased" type="checkbox" checked={form.deceased} onChange={(e) => set('deceased', e.target.checked)} className="w-4 h-4" />
                  <label htmlFor="deceased" className="text-sm font-medium text-gray-700 dark:text-slate-200">Deceased</label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Insurance Provider</label>
                <input type="text" value={form.insuranceProvider} onChange={(e) => set('insuranceProvider', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Insurance Policy #</label>
                <input type="text" value={form.insurancePolicy} onChange={(e) => set('insurancePolicy', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Rabies Tag</label>
                <input type="text" value={form.rabiesTag} onChange={(e) => set('rabiesTag', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Allergies</label>
                <input type="text" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Medical Alerts <span className="text-xs text-gray-400">(shown as a red banner)</span></label>
              <input type="text" value={form.alerts} onChange={(e) => set('alerts', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Aggressive, drug reactions, etc." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : (editing ? 'Save Changes' : 'Create Patient')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
