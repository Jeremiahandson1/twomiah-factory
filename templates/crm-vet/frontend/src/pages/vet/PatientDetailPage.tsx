import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, PawPrint, AlertTriangle, User, Phone, Mail, Plus, FileText,
  Syringe, Pill, FlaskConical, Stethoscope, ArrowLeft, ExternalLink, X,
} from 'lucide-react';
import api from '../../services/api';
import VisitEditorModal, { Visit } from '../../components/vet/VisitEditorModal';
import { openPrintable } from '../../lib/printable';
import { ageFromDob } from './PatientsPage';

// The lab-result "File URL" is free text, so a stored javascript:/data: URL would
// execute on click if handed straight to href. Only ever emit http/https.
const safeUrl = (u?: string): string | undefined => {
  if (!u) return undefined;
  try {
    const p = new URL(u, window.location.origin);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Patient chart — GET /api/patients/:id returns
 * { patient, owner, visits[], vaccinations[], prescriptions[], labResults[] }.
 * Tabs: Visits / Vaccinations / Prescriptions / Lab Results, each with an
 * add modal. Rabies vaccines link to a printable certificate.
 */

interface Owner {
  id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  address?: string;
}
interface Patient {
  id: string;
  name?: string;
  species?: string;
  breed?: string;
  sex?: string;
  dob?: string;
  weightLb?: number | string;
  color?: string;
  microchip?: string;
  spayedNeutered?: boolean;
  allergies?: string;
  alerts?: string;
  rabiesTag?: string;
  deceased?: boolean;
  notes?: string;
}
interface Vaccination {
  id: string;
  vaccine?: string;
  manufacturer?: string;
  lotNumber?: string;
  site?: string;
  route?: string;
  givenDate?: string;
  dueDate?: string;
  isRabies?: boolean;
  rabiesTag?: string;
  notes?: string;
}
interface Prescription {
  id: string;
  drug?: string;
  strength?: string;
  form?: string;
  sig?: string;
  quantity?: number | string;
  refills?: number | string;
  isControlled?: boolean;
  notes?: string;
}
interface LabResult {
  id: string;
  testName?: string;
  category?: string;
  resultDate?: string;
  status?: string;
  summary?: string;
  fileUrl?: string;
  notes?: string;
}
interface Detail {
  patient?: Patient;
  owner?: Owner;
  visits?: Visit[];
  vaccinations?: Vaccination[];
  prescriptions?: Prescription[];
  labResults?: LabResult[];
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function money(v: number | string | undefined | null): string {
  return `$${Number(v || 0).toLocaleString()}`;
}
function ownerName(o?: Owner): string {
  if (!o) return '—';
  return o.name || [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || 'Owner';
}
function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

type Tab = 'visits' | 'vaccinations' | 'prescriptions' | 'labs';

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<Tab>('visits');
  const [showVisit, setShowVisit] = useState<boolean>(false);
  const [editVisit, setEditVisit] = useState<Visit | null>(null);
  const [showVaccine, setShowVaccine] = useState<boolean>(false);
  const [showRx, setShowRx] = useState<boolean>(false);
  const [showLab, setShowLab] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/patients/${id}`);
      setDetail(res || {});
    } catch (error) {
      console.error('Failed to load patient:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const p = detail.patient;
  if (!p) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-slate-400">
        Patient not found. <Link to="/crm/patients" className="text-teal-600">Back to patients</Link>
      </div>
    );
  }

  const owner = detail.owner;
  const visits = detail.visits || [];
  const vaccinations = detail.vaccinations || [];
  const prescriptions = detail.prescriptions || [];
  const labResults = detail.labResults || [];

  const signalment = [
    p.species,
    p.breed,
    p.sex,
    ageFromDob(p.dob),
    p.weightLb ? `${p.weightLb} lb` : '',
  ].filter(Boolean).join(' · ');

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'visits', label: 'Visits', icon: <Stethoscope className="w-4 h-4" />, count: visits.length },
    { id: 'vaccinations', label: 'Vaccinations', icon: <Syringe className="w-4 h-4" />, count: vaccinations.length },
    { id: 'prescriptions', label: 'Prescriptions', icon: <Pill className="w-4 h-4" />, count: prescriptions.length },
    { id: 'labs', label: 'Lab Results', icon: <FlaskConical className="w-4 h-4" />, count: labResults.length },
  ];

  return (
    <div className="space-y-6">
      <Link to="/crm/patients" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400">
        <ArrowLeft className="w-4 h-4" /> Patients
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-50 rounded-lg">
            <PawPrint className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
              {p.name || 'Unnamed'}
              {p.deceased && <span className="text-sm font-normal text-gray-400">(deceased)</span>}
            </h1>
            <p className="text-gray-500 capitalize dark:text-slate-400">{signalment || '—'}</p>
          </div>
        </div>

        {p.alerts && (
          <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Medical Alert</p>
              <p className="text-sm">{p.alerts}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Owner card */}
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Owner</p>
            <p className="font-medium text-gray-900 flex items-center gap-2 dark:text-slate-100">
              <User className="w-4 h-4 text-gray-400" /> {ownerName(owner)}
            </p>
            {owner?.phone && <p className="text-sm text-gray-500 flex items-center gap-2 mt-1 dark:text-slate-400"><Phone className="w-3 h-3" /> {owner.phone}</p>}
            {owner?.mobile && owner.mobile !== owner.phone && <p className="text-sm text-gray-500 flex items-center gap-2 mt-1 dark:text-slate-400"><Phone className="w-3 h-3" /> {owner.mobile}</p>}
            {owner?.email && <p className="text-sm text-gray-500 flex items-center gap-2 mt-1 dark:text-slate-400"><Mail className="w-3 h-3" /> {owner.email}</p>}
          </div>
          {/* Details card */}
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Details</p>
            <dl className="text-sm text-gray-600 space-y-1 dark:text-slate-400">
              {p.microchip && <div className="flex justify-between"><dt className="text-gray-400">Microchip</dt><dd>{p.microchip}</dd></div>}
              {p.rabiesTag && <div className="flex justify-between"><dt className="text-gray-400">Rabies Tag</dt><dd>{p.rabiesTag}</dd></div>}
              {p.color && <div className="flex justify-between"><dt className="text-gray-400">Color</dt><dd>{p.color}</dd></div>}
              <div className="flex justify-between"><dt className="text-gray-400">Spayed/Neutered</dt><dd>{p.spayedNeutered ? 'Yes' : 'No'}</dd></div>
              {p.allergies && <div className="flex justify-between"><dt className="text-gray-400">Allergies</dt><dd>{p.allergies}</dd></div>}
            </dl>
          </div>
        </div>
        {p.notes && <p className="text-sm text-gray-500 mt-3 whitespace-pre-wrap dark:text-slate-400">{p.notes}</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Visits */}
      {tab === 'visits' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setEditVisit(null); setShowVisit(true); }} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> New Visit
            </button>
          </div>
          {visits.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No visits recorded</div>
          ) : (
            <div className="space-y-3">
              {visits.map((v) => (
                <div key={v.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">{fmtDate(v.visitDate)}{v.reason ? ` — ${v.reason}` : ''}</p>
                      {(v.diagnoses || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(v.diagnoses || []).map((d, i) => (
                            <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{d}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{money(v.total)}</span>
                      <button onClick={() => { setEditVisit(v); setShowVisit(true); }} className="text-sm text-teal-600 hover:text-teal-700">Edit</button>
                    </div>
                  </div>
                  {(v.assessment || v.plan) && (
                    <div className="mt-2 text-sm text-gray-600 space-y-1 dark:text-slate-400">
                      {v.assessment && <p><span className="font-medium text-gray-500 dark:text-slate-400">A:</span> {v.assessment}</p>}
                      {v.plan && <p><span className="font-medium text-gray-500 dark:text-slate-400">P:</span> {v.plan}</p>}
                    </div>
                  )}
                  {(v.weightLb || v.temperatureF || v.heartRate || v.respRate) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                      {v.weightLb ? <span>Wt {v.weightLb} lb</span> : null}
                      {v.temperatureF ? <span>Temp {v.temperatureF}°F</span> : null}
                      {v.heartRate ? <span>HR {v.heartRate}</span> : null}
                      {v.respRate ? <span>RR {v.respRate}</span> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vaccinations */}
      {tab === 'vaccinations' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowVaccine(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Add Vaccine
            </button>
          </div>
          {vaccinations.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No vaccinations recorded</div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Vaccine</th>
                    <th className="px-4 py-3 font-medium">Given</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Lot</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {vaccinations.map((v) => (
                    <tr key={v.id} className={isOverdue(v.dueDate) ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                        {v.vaccine || '—'}
                        {v.isRabies && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Rabies</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{fmtDate(v.givenDate)}</td>
                      <td className={`px-4 py-3 ${isOverdue(v.dueDate) ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                        {fmtDate(v.dueDate)}{isOverdue(v.dueDate) ? ' (overdue)' : ''}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{v.lotNumber || '—'}</td>
                      <td className="px-4 py-3">
                        {v.isRabies && (
                          <button
                            onClick={() => openPrintable(`/api/reminders/rabies/${v.id}`)}
                            className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
                          >
                            <ExternalLink className="w-3 h-3" /> Rabies Certificate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Prescriptions */}
      {tab === 'prescriptions' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowRx(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Add Rx
            </button>
          </div>
          {prescriptions.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No prescriptions recorded</div>
          ) : (
            <div className="space-y-2">
              {prescriptions.map((rx) => (
                <div key={rx.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {[rx.drug, rx.strength, rx.form].filter(Boolean).join(' ') || 'Medication'}
                      {rx.isControlled && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Controlled</span>}
                    </p>
                    <span className="text-xs text-gray-400">
                      Qty {rx.quantity ?? '—'} · {rx.refills ?? 0} refills
                    </span>
                  </div>
                  {rx.sig && <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">{rx.sig}</p>}
                  {rx.notes && <p className="text-xs text-gray-400 mt-1">{rx.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lab Results */}
      {tab === 'labs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowLab(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Add Lab
            </button>
          </div>
          {labResults.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No lab results recorded</div>
          ) : (
            <div className="space-y-2">
              {labResults.map((l) => (
                <div key={l.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {l.testName || 'Lab'}
                      {l.category && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{l.category}</span>}
                    </p>
                    <div className="flex items-center gap-3">
                      {l.status && <span className="text-xs text-gray-500 capitalize dark:text-slate-400">{l.status}</span>}
                      <span className="text-xs text-gray-400">{fmtDate(l.resultDate)}</span>
                    </div>
                  </div>
                  {l.summary && <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">{l.summary}</p>}
                  {safeUrl(l.fileUrl) && (
                    <a href={safeUrl(l.fileUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 mt-1">
                      <FileText className="w-3 h-3" /> View file
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showVisit && (
        <VisitEditorModal
          patientId={p.id}
          visit={editVisit}
          onSave={() => { setShowVisit(false); setEditVisit(null); load(); }}
          onClose={() => { setShowVisit(false); setEditVisit(null); }}
        />
      )}
      {showVaccine && <VaccineModal patientId={p.id} onSave={() => { setShowVaccine(false); load(); }} onClose={() => setShowVaccine(false)} />}
      {showRx && <RxModal patientId={p.id} onSave={() => { setShowRx(false); load(); }} onClose={() => setShowRx(false)} />}
      {showLab && <LabModal patientId={p.id} onSave={() => { setShowLab(false); load(); }} onClose={() => setShowLab(false)} />}
    </div>
  );
}

/* ---------------- Shared modal shell ---------------- */

function ModalShell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">{icon} {title}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      {children}
    </div>
  );
}

function FormButtons({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}

/* ---------------- Vaccine Modal ---------------- */

function VaccineModal({ patientId, onSave, onClose }: { patientId: string; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vaccine: '', manufacturer: '', lotNumber: '', serialNumber: '', site: '', route: '',
    givenDate: new Date().toISOString().slice(0, 10), dueDate: '', isRabies: false, rabiesTag: '', notes: '',
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vaccine.trim()) { alert('Vaccine name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { patientId, vaccine: form.vaccine.trim(), isRabies: form.isRabies };
      ['manufacturer', 'lotNumber', 'serialNumber', 'site', 'route', 'givenDate', 'dueDate', 'rabiesTag', 'notes'].forEach((k) => {
        const v = (form as Record<string, string>)[k];
        if (v) payload[k] = v;
      });
      await api.post('/api/vaccinations', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to add vaccine');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title="Add Vaccine" icon={<Syringe className="w-5 h-5 text-teal-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Vaccine *"><input type="text" value={form.vaccine} onChange={(e) => set('vaccine', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Manufacturer"><input type="text" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Lot #"><input type="text" value={form.lotNumber} onChange={(e) => set('lotNumber', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Serial #"><input type="text" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Site"><input type="text" value={form.site} onChange={(e) => set('site', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Route"><input type="text" value={form.route} onChange={(e) => set('route', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Given Date"><input type="date" value={form.givenDate} onChange={(e) => set('givenDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Due Date"><input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
        </div>
        <div className="flex items-center gap-2">
          <input id="isRabies" type="checkbox" checked={form.isRabies} onChange={(e) => set('isRabies', e.target.checked)} className="w-4 h-4" />
          <label htmlFor="isRabies" className="text-sm font-medium text-gray-700 dark:text-slate-200">Rabies vaccine</label>
        </div>
        {form.isRabies && (
          <Field label="Rabies Tag"><input type="text" value={form.rabiesTag} onChange={(e) => set('rabiesTag', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
        )}
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" /></Field>
        <FormButtons saving={saving} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

/* ---------------- Rx Modal ---------------- */

function RxModal({ patientId, onSave, onClose }: { patientId: string; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ drug: '', strength: '', form: '', sig: '', quantity: '', refills: '', isControlled: false, notes: '' });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.drug.trim()) { alert('Drug is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { patientId, drug: form.drug.trim(), isControlled: form.isControlled };
      if (form.strength) payload.strength = form.strength;
      if (form.form) payload.form = form.form;
      if (form.sig) payload.sig = form.sig;
      if (form.quantity !== '') payload.quantity = Number(form.quantity);
      if (form.refills !== '') payload.refills = Number(form.refills);
      if (form.notes) payload.notes = form.notes;
      await api.post('/api/prescriptions', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to add prescription');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title="Add Prescription" icon={<Pill className="w-5 h-5 text-teal-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Drug *"><input type="text" value={form.drug} onChange={(e) => set('drug', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required /></Field>
          <Field label="Strength"><input type="text" value={form.strength} onChange={(e) => set('strength', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Form"><input type="text" value={form.form} onChange={(e) => set('form', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="tablet, liquid..." /></Field>
          <Field label="Quantity"><input type="number" step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Refills"><input type="number" value={form.refills} onChange={(e) => set('refills', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
        </div>
        <Field label="Sig (directions)"><input type="text" value={form.sig} onChange={(e) => set('sig', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="1 tablet PO q12h" /></Field>
        <div className="flex items-center gap-2">
          <input id="isControlled" type="checkbox" checked={form.isControlled} onChange={(e) => set('isControlled', e.target.checked)} className="w-4 h-4" />
          <label htmlFor="isControlled" className="text-sm font-medium text-gray-700 dark:text-slate-200">Controlled substance</label>
        </div>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" /></Field>
        <FormButtons saving={saving} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

/* ---------------- Lab Modal ---------------- */

function LabModal({ patientId, onSave, onClose }: { patientId: string; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    testName: '', category: '', resultDate: new Date().toISOString().slice(0, 10),
    status: '', summary: '', fileUrl: '', notes: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.testName.trim()) { alert('Test name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { patientId, testName: form.testName.trim() };
      ['category', 'resultDate', 'status', 'summary', 'fileUrl', 'notes'].forEach((k) => {
        const v = (form as Record<string, string>)[k];
        if (v) payload[k] = v;
      });
      await api.post('/api/lab-results', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to add lab result');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title="Add Lab Result" icon={<FlaskConical className="w-5 h-5 text-teal-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Test Name *"><input type="text" value={form.testName} onChange={(e) => set('testName', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required /></Field>
          <Field label="Category"><input type="text" value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="CBC, chemistry..." /></Field>
          <Field label="Result Date"><input type="date" value={form.resultDate} onChange={(e) => set('resultDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
          <Field label="Status"><input type="text" value={form.status} onChange={(e) => set('status', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="normal, abnormal, pending" /></Field>
        </div>
        <Field label="Summary"><textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" /></Field>
        <Field label="File URL"><input type="text" value={form.fileUrl} onChange={(e) => set('fileUrl', e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></Field>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" /></Field>
        <FormButtons saving={saving} onClose={onClose} />
      </form>
    </ModalShell>
  );
}
