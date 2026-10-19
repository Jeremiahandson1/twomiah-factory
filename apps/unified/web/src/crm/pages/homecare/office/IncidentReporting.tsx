// Moved from templates/crm-homecare/frontend/src/components/admin/IncidentReporting.tsx.
// Clinical → Incidents: the list, the new-incident form, and the way into each incident's case file.
// Changes in the move:
//   · the case file is its own page (/crm/incidents/:id, ./IncidentDetail.tsx): "Open" and a new report navigate there
//     instead of swapping the list for it in place;
//   · replies are read as the unified server answers (server/crm/homecare/office/incidents.ts): lists are
//     { data, pagination } and rows camelCase (clientName, incidentDateYmd, responseDueDateYmd, noteCount …);
//   · "Report Incident" shows only for whoever holds care-compliance:create and "Delete" for care-compliance:delete
//     (the server's checks on POST / and DELETE /:id); the template showed both to every office seat it let in.
import { useState, useEffect, useCallback, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm, usePermissions } from '../../../../shared';
import { api, rows, errorMessage } from '../lib/http';
import { formatDate } from '../lib/date';
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, incidentLabel, incidentsApi, localToday, localTimeHHMM,
  STATUS_CHIP, SEVERITY_CHIP, SEVERITY_BORDER, FIELD, LABEL, CARD, H3, MUTED, BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER,
} from '../lib/incidentOptions';

/** A row of GET /api/incidents (data/homecareOffice.ts listIncidents, camelCase; the signature stripped). */
export interface IncidentListRow {
  id: string;
  incidentNumber?: string | null;
  clientName?: string | null;
  caregiverName?: string | null;
  enteredByName?: string | null;
  reportedByRole?: string | null;
  incidentType?: string | null;
  severity?: string | null;
  status?: string | null;
  description?: string | null;
  witnesses?: string | null;
  injuriesOrDamage?: string | null;
  actionTaken?: string | null;
  followUpRequired?: boolean | null;
  followUpNotes?: string | null;
  reportedBy?: string | null;
  incidentDateYmd?: string | null;
  incidentTimeHhmm?: string | null;
  reportedDateYmd?: string | null;
  responseDueDateYmd?: string | null;
  responseSentDateYmd?: string | null;
  noteCount?: number;
  attachmentCount?: number;
}

/** A person in a picker: GET /api/incidents/my-clients and GET /api/users/caregivers rows. */
export interface PersonOption { id: string; firstName?: string | null; lastName?: string | null }

// Form defaults: the date is the browser's calendar day and the time its local clock (a UTC
// default gave evening reports tomorrow's date and a time hours ahead).
const blankIncidentForm = () => ({
  clientId: '',
  caregiverId: '',
  incidentType: 'accident',
  severity: 'moderate',
  incidentDate: localToday(),
  incidentTime: localTimeHHMM(),
  description: '',
  witnesses: '',
  injuriesOrDamage: '',
  actionsTaken: '',
  followUpRequired: false,
  followUpNotes: '',
  reportedBy: '',
  reportedDate: localToday(),
  reporterContactName: '',
  reporterPhone: '',
  reporterEmail: '',
  responseDueDate: '',
});
type IncidentForm = ReturnType<typeof blankIncidentForm>;

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <label className={LABEL}>{label}</label>
    {children}
  </div>
);

export default function IncidentReporting() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  // Hidden only once the seat's permissions are known (PermissionsContext: gate on `!known || can(…)`).
  const { can, known } = usePermissions();
  const mayCreate = !known || can('care-compliance:create');
  const mayDelete = !known || can('care-compliance:delete');
  const [clients, setClients] = useState<PersonOption[]>([]);
  const [caregivers, setCaregivers] = useState<PersonOption[]>([]);
  const [incidents, setIncidents] = useState<IncidentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all'); // all, critical, severe, moderate, minor
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [formData, setFormData] = useState<IncidentForm>(blankIncidentForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoadError('');
    try {
      const [clientList, caregiverList, incidentList] = await Promise.all([
        incidentsApi('/my-clients'),
        api.get('/api/users/caregivers').catch(() => null),
        incidentsApi(''),
      ]);
      setClients(rows<PersonOption>(clientList));
      setCaregivers(rows<PersonOption>(caregiverList));
      setIncidents(rows<IncidentListRow>(incidentList));
    } catch (error) {
      setLoadError(errorMessage(error, 'Could not load incidents'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const set = <K extends keyof IncidentForm>(k: K, v: IncidentForm[K]) => setFormData((f) => ({ ...f, [k]: v }));

  const handleSubmitIncident = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!formData.clientId || !formData.incidentType) { setMessage({ text: 'Client and incident type are required', error: true }); return; }
    if (!formData.description.trim()) { setMessage({ text: 'Description is required', error: true }); return; }
    setSaving(true);
    try {
      const created: { id?: string } | null = await incidentsApi('', { method: 'POST', body: JSON.stringify(formData) });
      setMessage({ text: 'Incident reported successfully!' });
      setFormData(blankIncidentForm());
      setShowForm(false);
      // Straight into the case file so the investigation can start.
      if (created?.id) navigate(`/crm/incidents/${created.id}`);
      else loadData();
    } catch (error) {
      setMessage({ text: 'Error: ' + errorMessage(error), error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteIncident = async (incidentId: string) => {
    if (!(await confirm('Delete this incident report? This cannot be undone.', { danger: true }))) return;
    try {
      await incidentsApi(`/${incidentId}`, { method: 'DELETE' });
      setMessage({ text: 'Incident deleted' });
      setTimeout(() => setMessage(null), 2000);
      loadData();
    } catch (error) {
      setMessage({ text: 'Error: ' + errorMessage(error), error: true });
    }
  };

  const today = localToday();
  const filteredIncidents = incidents
    .filter((incident) => {
      if (filter !== 'all' && incident.severity !== filter) return false;
      if (statusFilter !== 'all' && (incident.status || 'open') !== statusFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          (incident.clientName || '').toLowerCase().includes(term) ||
          (incident.description || '').toLowerCase().includes(term) ||
          (incident.incidentType || '').toLowerCase().includes(term) ||
          (incident.incidentNumber || '').toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => String(b.incidentDateYmd || '').localeCompare(String(a.incidentDateYmd || '')));

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-600 dark:text-slate-400">Loading incidents…</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Incident &amp; Accident Reporting</h2>
        {mayCreate && (
          <button className={BTN_PRIMARY} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Report Incident'}
          </button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">{loadError}</div>
      )}
      {message && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${message.error
          ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
          : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
          {message.text}
        </div>
      )}

      {showForm && mayCreate && (
        <div className={CARD}>
          <h3 className={H3}>Report New Incident</h3>
          <form onSubmit={handleSubmitIncident} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Client *">
                <select className={FIELD} value={formData.clientId} onChange={(e) => set('clientId', e.target.value)} required>
                  <option value="">Select client...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </Field>
              <Field label="Caregiver Involved">
                <select className={FIELD} value={formData.caregiverId} onChange={(e) => set('caregiverId', e.target.value)}>
                  <option value="">Select caregiver (if applicable)...</option>
                  {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
                </select>
              </Field>
              <Field label="Incident Type *">
                <select className={FIELD} value={formData.incidentType} onChange={(e) => set('incidentType', e.target.value)}>
                  {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Severity *">
                <select className={FIELD} value={formData.severity} onChange={(e) => set('severity', e.target.value)}>
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Incident Date *">
                <input className={FIELD} type="date" value={formData.incidentDate} onChange={(e) => set('incidentDate', e.target.value)} required />
              </Field>
              <Field label="Incident Time">
                <input className={FIELD} type="time" value={formData.incidentTime} onChange={(e) => set('incidentTime', e.target.value)} />
              </Field>
              <Field label="Reported By">
                <input className={FIELD} type="text" value={formData.reportedBy} onChange={(e) => set('reportedBy', e.target.value)} placeholder="Name of person reporting" />
              </Field>
              <Field label="Report Date">
                <input className={FIELD} type="date" value={formData.reportedDate} onChange={(e) => set('reportedDate', e.target.value)} />
              </Field>
              <Field label="Reporter Contact Name">
                <input className={FIELD} type="text" value={formData.reporterContactName} onChange={(e) => set('reporterContactName', e.target.value)} placeholder="e.g. the care manager's name" />
              </Field>
              <Field label="Response Due Date">
                <input className={FIELD} type="date" value={formData.responseDueDate} onChange={(e) => set('responseDueDate', e.target.value)} />
              </Field>
              <Field label="Reporter Phone">
                <input className={FIELD} type="tel" value={formData.reporterPhone} onChange={(e) => set('reporterPhone', e.target.value)} />
              </Field>
              <Field label="Reporter Email">
                <input className={FIELD} type="email" value={formData.reporterEmail} onChange={(e) => set('reporterEmail', e.target.value)} />
              </Field>
            </div>
            <Field label="Incident Description *">
              <textarea className={FIELD} value={formData.description} onChange={(e) => set('description', e.target.value)} placeholder="Detailed description of what happened..." rows={4} required />
            </Field>
            <Field label="Witnesses">
              <textarea className={FIELD} value={formData.witnesses} onChange={(e) => set('witnesses', e.target.value)} placeholder="Names and contact info of witnesses..." rows={2} />
            </Field>
            <Field label="Injuries or Damage">
              <textarea className={FIELD} value={formData.injuriesOrDamage} onChange={(e) => set('injuriesOrDamage', e.target.value)} placeholder="Description of any injuries or property damage..." rows={2} />
            </Field>
            <Field label="Actions Taken">
              <textarea className={FIELD} value={formData.actionsTaken} onChange={(e) => set('actionsTaken', e.target.value)} placeholder="What actions were taken in response to the incident..." rows={2} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
              <input type="checkbox" checked={formData.followUpRequired} onChange={(e) => set('followUpRequired', e.target.checked)} />
              <span>Follow-up Required</span>
            </label>
            {formData.followUpRequired && (
              <Field label="Follow-up Notes">
                <textarea className={FIELD} value={formData.followUpNotes} onChange={(e) => set('followUpNotes', e.target.value)} placeholder="What follow-up actions are needed..." rows={2} />
              </Field>
            )}
            <div className="flex gap-2">
              <button type="submit" className={BTN_PRIMARY} disabled={saving}>{saving ? 'Saving…' : 'Report Incident'}</button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            aria-label="Search incidents"
            placeholder="Search incidents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${FIELD} min-w-[200px] flex-1`}
          />
          <select aria-label="Filter by status" className={`${FIELD} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} ({incidents.filter((i) => (i.status || 'open') === s.value).length})
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {['all', 'critical', 'severe', 'moderate', 'minor'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === f
                ? 'bg-teal-700 text-white dark:bg-teal-700 dark:text-white'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && ` (${incidents.filter((i) => i.severity === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Incidents List */}
      {filteredIncidents.length === 0 ? (
        <div className={`${CARD} text-center`}><p className={MUTED}>No incidents reported.</p></div>
      ) : (
        <div className="grid gap-4">
          {filteredIncidents.map((incident) => {
            const status = incident.status || 'open';
            const severity = incident.severity || '';
            const dueOpen = !!incident.responseDueDateYmd && !incident.responseSentDateYmd && status !== 'closed';
            const noteCount = incident.noteCount || 0;
            const attachmentCount = incident.attachmentCount || 0;
            return (
              <div key={incident.id} className={`rounded-xl border-2 bg-white p-4 dark:bg-slate-800 ${SEVERITY_BORDER[severity] || 'border-gray-300 dark:border-slate-600'}`}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">
                      {incident.incidentNumber && <span className="font-semibold text-gray-600 dark:text-slate-400">{incident.incidentNumber} · </span>}
                      {incident.clientName || 'Unknown Client'} - {incidentLabel('type', incident.incidentType)}
                    </h4>
                    <div className="text-xs text-gray-600 dark:text-slate-400">
                      {formatDate(incident.incidentDateYmd)} at {incident.incidentTimeHhmm || 'Unknown time'}
                      {incident.reportedByRole === 'caregiver' && ' · Reported from the caregiver app'}
                    </div>
                    {dueOpen && (
                      <div className={`mt-1 text-sm font-bold ${String(incident.responseDueDateYmd) <= today ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        Response due {formatDate(incident.responseDueDateYmd)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${STATUS_CHIP[status] || STATUS_CHIP.open}`}>{incidentLabel('status', status)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${SEVERITY_CHIP[severity] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100'}`}>{incidentLabel('severity', severity) || 'Unknown'}</span>
                    <button className={BTN_PRIMARY} onClick={() => navigate(`/crm/incidents/${incident.id}`)}>Open</button>
                    {mayDelete && <button className={BTN_DANGER} onClick={() => handleDeleteIncident(incident.id)}>Delete</button>}
                  </div>
                </div>

                <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                  <strong>Description:</strong>
                  <p className="mt-1 whitespace-pre-wrap">{incident.description}</p>
                </div>
                {incident.caregiverName && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200"><strong>Caregiver:</strong> {incident.caregiverName}</div>
                )}
                {incident.witnesses && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                    <strong>Witnesses:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.witnesses}</p>
                  </div>
                )}
                {incident.injuriesOrDamage && (
                  <div className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/30 dark:text-red-100">
                    <strong>Injuries/Damage:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.injuriesOrDamage}</p>
                  </div>
                )}
                {incident.actionTaken && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                    <strong>Actions Taken:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.actionTaken}</p>
                  </div>
                )}
                {incident.followUpRequired && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                    <strong>Follow-up Required</strong>
                    {incident.followUpNotes && <p className="mt-1 whitespace-pre-wrap">{incident.followUpNotes}</p>}
                  </div>
                )}
                <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-400">
                  Reported by {incident.reportedBy || incident.enteredByName || 'Unknown'}{incident.reportedDateYmd ? ` on ${formatDate(incident.reportedDateYmd)}` : ''}
                  {(noteCount > 0 || attachmentCount > 0) && ` · ${noteCount} timeline entr${noteCount === 1 ? 'y' : 'ies'} · ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
