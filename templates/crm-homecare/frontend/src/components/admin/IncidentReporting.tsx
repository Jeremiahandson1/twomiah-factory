// src/components/admin/IncidentReporting.tsx — Clinical → Incidents: the list, the new-incident form,
// and the way into each incident's case file (IncidentDetail).
import React, { useState, useEffect, useCallback } from 'react';
import { confirm } from '../ConfirmModal';
import { formatDate } from '../../utils/date';
import { useAuth } from '../../contexts/AuthContext';
import { apiCall } from '../../config';
import IncidentDetail from './IncidentDetail';
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, incidentLabel, incidentsApi, localToday, localTimeHHMM,
  STATUS_CHIP, SEVERITY_CHIP, SEVERITY_BORDER, FIELD, LABEL, CARD, H3, MUTED, BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER,
} from '../../utils/incidentOptions';

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

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className={LABEL}>{label}</label>
    {children}
  </div>
);

const IncidentReporting = () => {
  const { token } = useAuth();
  const api = useCallback((path: string, options: RequestInit = {}) => incidentsApi(token)(path, options), [token]);
  const [clients, setClients] = useState<any[]>([]);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all'); // all, critical, severe, moderate, minor
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formData, setFormData] = useState(blankIncidentForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoadError('');
    try {
      const [clientList, caregiverList, incidentList] = await Promise.all([
        api('/my-clients'),
        apiCall('/api/users/caregivers', { method: 'GET' }, token).catch(() => []),
        api(''),
      ]);
      setClients(Array.isArray(clientList) ? clientList : []);
      setCaregivers(Array.isArray(caregiverList) ? caregiverList : []);
      setIncidents(Array.isArray(incidentList) ? incidentList : []);
    } catch (error: any) {
      setLoadError(error.message || 'Could not load incidents');
    } finally {
      setLoading(false);
    }
  }, [api, token]);

  useEffect(() => { loadData(); }, [loadData]);

  const set = (k: string, v: any) => setFormData((f) => ({ ...f, [k]: v }));

  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!formData.clientId || !formData.incidentType) { setMessage({ text: 'Client and incident type are required', error: true }); return; }
    if (!formData.description.trim()) { setMessage({ text: 'Description is required', error: true }); return; }
    setSaving(true);
    try {
      const created = await api('', { method: 'POST', body: JSON.stringify(formData) });
      setMessage({ text: 'Incident reported successfully!' });
      setFormData(blankIncidentForm());
      setShowForm(false);
      // Straight into the case file so the investigation can start.
      if (created?.id) setDetailId(created.id);
      else loadData();
    } catch (error: any) {
      setMessage({ text: 'Error: ' + error.message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteIncident = async (incidentId: string) => {
    if (!(await confirm('Delete this incident report? This cannot be undone.', { danger: true }))) return;
    try {
      await api(`/${incidentId}`, { method: 'DELETE' });
      setMessage({ text: 'Incident deleted' });
      setTimeout(() => setMessage(null), 2000);
      loadData();
    } catch (error: any) {
      setMessage({ text: 'Error: ' + error.message, error: true });
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
          (incident.client_name || '').toLowerCase().includes(term) ||
          (incident.description || '').toLowerCase().includes(term) ||
          (incident.incident_type || '').toLowerCase().includes(term) ||
          (incident.incident_number || '').toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => String(b.incident_date_ymd || '').localeCompare(String(a.incident_date_ymd || '')));

  if (detailId) {
    return <IncidentDetail incidentId={detailId} onBack={() => { setDetailId(null); loadData(); }} />;
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-600 dark:text-slate-400">Loading incidents…</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Incident &amp; Accident Reporting</h2>
        <button className={BTN_PRIMARY} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Report Incident'}
        </button>
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

      {showForm && (
        <div className={CARD}>
          <h3 className={H3}>Report New Incident</h3>
          <form onSubmit={handleSubmitIncident} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Client *">
                <select className={FIELD} value={formData.clientId} onChange={(e) => set('clientId', e.target.value)} required>
                  <option value="">Select client...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </Field>
              <Field label="Caregiver Involved">
                <select className={FIELD} value={formData.caregiverId} onChange={(e) => set('caregiverId', e.target.value)}>
                  <option value="">Select caregiver (if applicable)...</option>
                  {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
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
                ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white'
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
            const dueOpen = incident.response_due_date_ymd && !incident.response_sent_date_ymd && status !== 'closed';
            return (
              <div key={incident.id} className={`rounded-xl border-2 bg-white p-4 dark:bg-slate-800 ${SEVERITY_BORDER[incident.severity] || 'border-gray-300 dark:border-slate-600'}`}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">
                      {incident.incident_number && <span className="font-semibold text-gray-600 dark:text-slate-400">{incident.incident_number} · </span>}
                      {incident.client_name || 'Unknown Client'} - {incidentLabel('type', incident.incident_type)}
                    </h4>
                    <div className="text-xs text-gray-600 dark:text-slate-400">
                      {formatDate(incident.incident_date_ymd)} at {incident.incident_time_hhmm || 'Unknown time'}
                      {incident.reported_by_role === 'caregiver' && ' · Reported from the caregiver app'}
                    </div>
                    {dueOpen && (
                      <div className={`mt-1 text-sm font-bold ${incident.response_due_date_ymd <= today ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        Response due {formatDate(incident.response_due_date_ymd)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${STATUS_CHIP[status] || STATUS_CHIP.open}`}>{incidentLabel('status', status)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${SEVERITY_CHIP[incident.severity] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100'}`}>{incidentLabel('severity', incident.severity) || 'Unknown'}</span>
                    <button className={BTN_PRIMARY} onClick={() => setDetailId(incident.id)}>Open</button>
                    <button className={BTN_DANGER} onClick={() => handleDeleteIncident(incident.id)}>Delete</button>
                  </div>
                </div>

                <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                  <strong>Description:</strong>
                  <p className="mt-1 whitespace-pre-wrap">{incident.description}</p>
                </div>
                {incident.caregiver_name && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200"><strong>Caregiver:</strong> {incident.caregiver_name}</div>
                )}
                {incident.witnesses && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                    <strong>Witnesses:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.witnesses}</p>
                  </div>
                )}
                {incident.injuries_or_damage && (
                  <div className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/30 dark:text-red-100">
                    <strong>Injuries/Damage:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.injuries_or_damage}</p>
                  </div>
                )}
                {incident.action_taken && (
                  <div className="mb-2 text-sm text-gray-800 dark:text-slate-200">
                    <strong>Actions Taken:</strong>
                    <p className="mt-1 whitespace-pre-wrap">{incident.action_taken}</p>
                  </div>
                )}
                {incident.follow_up_required && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                    <strong>Follow-up Required</strong>
                    {incident.follow_up_notes && <p className="mt-1 whitespace-pre-wrap">{incident.follow_up_notes}</p>}
                  </div>
                )}
                <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-400">
                  Reported by {incident.reported_by || incident.entered_by_name || 'Unknown'}{incident.reported_date_ymd ? ` on ${formatDate(incident.reported_date_ymd)}` : ''}
                  {(incident.note_count > 0 || incident.attachment_count > 0) && ` · ${incident.note_count} timeline entr${incident.note_count === 1 ? 'y' : 'ies'} · ${incident.attachment_count} attachment${incident.attachment_count === 1 ? '' : 's'}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IncidentReporting;
