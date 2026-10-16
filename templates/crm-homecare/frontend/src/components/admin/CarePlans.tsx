// CarePlans — care plans & service agreements, per client.
//
// A plan carries the client's visit schedule as it stood when saved ("Fill from current
// schedule"); an active plan whose saved schedule no longer matches Scheduling is flagged.
// Every change is kept as a revision (History). Plans can start from a template, print as a PDF,
// generate recurring shifts (refused if the client is already scheduled), and show the client's
// care task checklist with its minutes per week.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { confirm } from '../ConfirmModal';
import { formatDate } from '../../utils/date';

// Same categories as the Care Tasks screen, in display order.
const TASK_GROUPS: [string, string][] = [
  ['adl', 'Personal Care (ADL)'], ['iadl', 'Homemaking (IADL)'], ['medication', 'Medication Reminders'],
  ['companion', 'Companion / Social'], ['safety', 'Safety Checks'], ['other', 'Other'],
];
const SERVICE_LABELS: Record<string, string> = {
  personal_care: 'Personal Care', medication_management: 'Medication Management', companionship: 'Companionship',
  respite_care: 'Respite Care', mobility_assistance: 'Mobility Assistance', meal_prep: 'Meal Preparation',
  transportation: 'Transportation', other: 'Other',
};
const serviceLabel = (s: string) => SERVICE_LABELS[s] || s;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const emptyForm = () => ({
  clientId: '', serviceType: 'personal_care', serviceDescription: '', frequency: '', careGoals: '',
  specialInstructions: '', precautions: '', medicationNotes: '', mobilityNotes: '', dietaryNotes: '',
  communicationNotes: '', startDate: today(), endDate: '', status: 'active',
});
// The plan's status as the office sets it. "Active" on the card is the SERVER's answer (isActive:
// status Active and inside its dates — services/carePlanStatus.ts), the same one the family portal
// and the caregiver app use; the screen never re-derives it.
const STATUS_OPTIONS: [string, string][] = [['active', 'Active'], ['draft', 'Draft'], ['inactive', 'Inactive'], ['completed', 'Completed']];
const isActivePlan = (plan: any) => plan.is_active === true || plan.isActive === true;
const planTag = (plan: any): [string, string] => {
  if (isActivePlan(plan)) return ['Active', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'];
  const grey = 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200';
  if (plan.status === 'draft') return ['Draft — not active', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'];
  if (plan.status === 'inactive') return ['Inactive', grey];
  if (plan.status === 'completed') return ['Completed', grey];
  const t = today();
  if (plan.start_date && String(plan.start_date).slice(0, 10) > t) return [`Starts ${formatDate(plan.start_date)}`, 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'];
  return ['Ended', grey];
};
const fmtAsOf = (d: any) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString() : '');

const inp = 'w-full px-3 py-2 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const label = 'block mb-1 text-sm font-semibold text-gray-700 dark:text-slate-200';
const panel = 'rounded-xl p-4 bg-white text-gray-900 shadow-sm dark:bg-slate-800 dark:text-slate-100';
const modalWrap = 'fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50';
const modalBox = 'w-full rounded-xl p-5 max-h-[90vh] overflow-auto bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100';

const NOTE_FIELDS: [string, string, string, number][] = [
  ['serviceDescription', 'Service Description', 'Detailed description of what this service entails...', 3],
  ['careGoals', 'Care Goals', 'What are the goals for this care plan? (e.g., improve mobility, maintain independence, manage pain...)', 3],
  ['specialInstructions', 'Special Instructions', 'Any special instructions caregivers should follow...', 3],
  ['precautions', 'Safety Precautions', 'Any safety concerns, fall risks, allergies, or precautions...', 3],
  ['medicationNotes', 'Medication Notes', 'Instructions for medication management, timing, side effects to watch for...', 2],
  ['mobilityNotes', 'Mobility Notes', 'Mobility assistance needed, equipment (walker, wheelchair), transfer techniques...', 2],
  ['dietaryNotes', 'Dietary Notes', 'Dietary restrictions, preferences, feeding assistance needed...', 2],
  ['communicationNotes', 'Communication Notes', 'Communication style, hearing/vision issues, cognitive considerations...', 2],
];

export default function CarePlans() {
  const { token } = useAuth();
  const auth = { Authorization: `Bearer ${token}` };
  const json = { 'Content-Type': 'application/json', ...auth };
  const [clients, setClients] = useState<any[]>([]);
  const [carePlans, setCarePlans] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  // Saved visit schedule shown in the form; action is what gets sent:
  // 'current' = server copies the live schedule, '' = clear, null = leave unchanged.
  const [visitSchedule, setVisitSchedule] = useState<{ text: string; asOf: any; action: string | null }>({ text: '', asOf: null, action: null });
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [currentSchedules, setCurrentSchedules] = useState<Record<string, any>>({});
  const [careTasks, setCareTasks] = useState<Record<string, any[]>>({});
  const [showGenModal, setShowGenModal] = useState<any>(null);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateClientId, setTemplateClientId] = useState('');
  const [revisionsFor, setRevisionsFor] = useState<any>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [genForm, setGenForm] = useState<any>({ caregiverId: '', startTime: '09:00', endTime: '13:00', daysOfWeek: [], startDate: '', endDate: '' });
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState<any>(emptyForm());

  useEffect(() => { loadData(); loadCaregivers(); loadTemplates(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCaregivers = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/caregivers?limit=500`, { headers: auth });
      if (r.ok) { const d = await r.json(); setCaregivers(Array.isArray(d) ? d : (d.caregivers || [])); }
    } catch { /* optional */ }
  };
  const loadTemplates = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plan-templates`, { headers: auth });
      if (r.ok) setTemplates(await r.json());
    } catch { /* optional */ }
  };

  const loadData = async () => {
    try {
      const [clientsRes, plansRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clients?limit=500`, { headers: auth }),
        fetch(`${API_BASE_URL}/api/care-plans`, { headers: auth }),
      ]);
      const clientsData = clientsRes.ok ? await clientsRes.json() : [];
      const plansData = plansRes.ok ? await plansRes.json() : [];
      const list = Array.isArray(clientsData) ? clientsData : (clientsData.clients || []);
      const plans = Array.isArray(plansData) ? plansData : [];
      setClients(list);
      const byClient: Record<string, any[]> = {};
      list.forEach((c: any) => { byClient[c.id] = []; });
      plans.forEach((p: any) => { if (byClient[p.client_id]) byClient[p.client_id].push(p); });
      setCarePlans(byClient);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyTemplate = async (templateId: string) => {
    if (!templateClientId) { setMessage('Pick a client first'); return; }
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/from-template/${templateId}`, {
        method: 'POST', headers: json, body: JSON.stringify({ clientId: templateClientId, startDate: today() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      setMessage(`Created a draft care plan from "${data.appliedTemplate}". It is not active yet — review it, then click ✓ Activate.`);
      setShowTemplateModal(false);
      setTemplateClientId('');
      loadData();
    } catch (err: any) { setMessage('Error: ' + err.message); }
  };

  const handleGenerateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genForm.caregiverId || !genForm.daysOfWeek.length) { setMessage('Error: select a caregiver and at least one day'); return; }
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/${showGenModal.id}/generate-schedule`, { method: 'POST', headers: json, body: JSON.stringify(genForm) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      setMessage(`Created ${data.created} recurring schedule(s)${data.warnings?.length ? '. Warnings: ' + data.warnings.join(', ') : ''}`);
      setShowGenModal(null);
      loadCurrentSchedule(showGenModal.client_id);
    } catch (err: any) { setMessage('Error: ' + err.message); }
  };
  const toggleGenDay = (day: number) => setGenForm((prev: any) => ({
    ...prev, daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter((d: number) => d !== day) : [...prev.daysOfWeek, day],
  }));

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!formData.clientId || !formData.serviceType) { setMessage('Error: client and service type are required'); return; }
    try {
      const response = await fetch(`${API_BASE_URL}/api/care-plans${editingPlanId ? `/${editingPlanId}` : ''}`, {
        method: editingPlanId ? 'PUT' : 'POST', headers: json,
        body: JSON.stringify(visitSchedule.action === null ? formData : { ...formData, visitSchedule: visitSchedule.action }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Failed to ${editingPlanId ? 'update' : 'create'} care plan`);
      }
      setMessage(editingPlanId ? 'Care plan updated successfully!' : 'Care plan created successfully!');
      const savedClientId = formData.clientId;
      closeForm();
      loadData();
      loadCurrentSchedule(savedClientId);
    } catch (error: any) { setMessage('Error: ' + error.message); }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPlanId(null);
    setFormData(emptyForm());
    setVisitSchedule({ text: '', asOf: null, action: null });
  };

  const fetchSchedule = async (clientId: string) => {
    const r = await fetch(`${API_BASE_URL}/api/care-plans/visit-schedule/${clientId}`, { headers: auth });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Could not load the schedule (HTTP ${r.status})`);
    return data;
  };
  const loadCurrentSchedule = async (clientId: string) => {
    if (!clientId) return;
    try {
      const data = await fetchSchedule(clientId);
      setCurrentSchedules(prev => ({ ...prev, [clientId]: data }));
    } catch (e: any) { setMessage('Error: ' + e.message); }
  };
  const loadCareTasks = async (clientId: string) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/client/${clientId}`, { headers: auth });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Could not load care tasks (HTTP ${r.status})`);
      setCareTasks(prev => ({ ...prev, [clientId]: data }));
    } catch (e: any) { setMessage('Error: ' + e.message); }
  };

  const fillFromSchedule = async () => {
    if (!formData.clientId) { setMessage('Error: pick a client first'); return; }
    setScheduleLoading(true);
    try {
      const data = await fetchSchedule(formData.clientId);
      if (!data.text) { setMessage('Error: this client has no recurring visits scheduled in the next 4 weeks.'); return; }
      setVisitSchedule({ text: data.text, asOf: data.asOf, action: 'current' });
    } catch (e: any) { setMessage('Error: ' + e.message); }
    finally { setScheduleLoading(false); }
  };

  const startEdit = (plan: any) => {
    setEditingPlanId(plan.id);
    setFormData({
      clientId: plan.client_id, serviceType: plan.service_type || 'personal_care',
      serviceDescription: plan.service_description || '', frequency: plan.frequency || '',
      careGoals: plan.care_goals || '', specialInstructions: plan.special_instructions || '',
      precautions: plan.precautions || '', medicationNotes: plan.medication_notes || '',
      mobilityNotes: plan.mobility_notes || '', dietaryNotes: plan.dietary_notes || '',
      communicationNotes: plan.communication_notes || '',
      startDate: plan.start_date ? String(plan.start_date).slice(0, 10) : '',
      endDate: plan.end_date ? String(plan.end_date).slice(0, 10) : '',
      status: plan.status || 'active',
    });
    setVisitSchedule({ text: plan.visit_schedule || '', asOf: plan.visit_schedule_as_of, action: null });
    setMessage('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const loadRevisions = async (plan: any) => {
    setRevisionsFor(plan);
    setRevisionsLoading(true); setRevisions([]);
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/${plan.id}/revisions`, { headers: auth });
      if (r.ok) setRevisions(await r.json());
    } catch { /* ignore */ }
    finally { setRevisionsLoading(false); }
  };

  const downloadPdf = async (plan: any) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/${plan.id}/pdf`, { headers: auth });
      if (!r.ok) throw new Error('PDF download failed');
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `care-plan-${String(plan.id).slice(0, 8)}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) { setMessage('Error: PDF failed: ' + err.message); }
  };

  const handleDeletePlan = async (planId: string) => {
    if (!(await confirm('Delete this care plan?', { danger: true }))) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/care-plans/${planId}`, { method: 'DELETE', headers: auth });
      if (!response.ok) throw new Error('Failed to delete');
      setMessage('Care plan deleted');
      loadData();
    } catch (error: any) { setMessage('Error: ' + error.message); }
  };

  // A draft (every plan made from a template starts as one) goes live only when the office says so.
  const activatePlan = async (plan: any) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-plans/${plan.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ status: 'active' }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Could not activate the plan (HTTP ${r.status})`);
      setMessage(data.isActive === false || (data.start_date && String(data.start_date).slice(0, 10) > today())
        ? 'Care plan set to Active — it shows as active from its start date.'
        : 'Care plan is now active.');
      loadData();
    } catch (e: any) { setMessage('Error: ' + e.message); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  const btnSm = 'px-2.5 py-1 rounded-md text-xs font-semibold border';
  const btnNeutral = `${btnSm} border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200`;

  return (
    <div>
      <div className="page-header">
        <h2>Care Plans & Service Agreements</h2>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setShowTemplateModal(true)} title="Start from a pre-built template">📋 Use Template ({templates.length})</button>
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>{showForm ? 'Cancel' : 'Add Care Plan'}</button>
        </div>
      </div>

      {message && (
        <div className={`mb-3 px-4 py-2 rounded-lg text-sm ${message.startsWith('Error') ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>{message}</div>
      )}

      {showTemplateModal && (
        <div className={modalWrap} onClick={() => setShowTemplateModal(false)}>
          <div className={`${modalBox} max-w-2xl`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="m-0 text-lg font-semibold">📋 Create from Template</h3>
              <button type="button" aria-label="Close" onClick={() => setShowTemplateModal(false)} className="text-2xl leading-none text-gray-500 dark:text-slate-400">×</button>
            </div>
            <div className="mb-3">
              <label className={label} htmlFor="tpl-client">Client *</label>
              <select id="tpl-client" value={templateClientId} onChange={(e) => setTemplateClientId(e.target.value)} className={inp}>
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className="grid gap-2 max-h-[60vh] overflow-auto">
              {templates.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No templates available.</p>}
              {templates.map(t => (
                <button key={t.id} type="button" disabled={!templateClientId} onClick={() => applyTemplate(t.id)}
                  className="text-left p-4 rounded-lg border border-gray-200 bg-white text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                  <div className="flex items-start justify-between mb-1">
                    <strong>{t.template_name}</strong>
                    {t.is_built_in && <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">built-in</span>}
                  </div>
                  {t.template_description && <div className="text-sm text-gray-500 dark:text-slate-400">{t.template_description}</div>}
                  <div className="text-xs mt-1 text-gray-400 dark:text-slate-500">{serviceLabel(t.service_type)} · {t.frequency}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className={`${panel} mb-6`}>
          <h3 className="mt-0">{editingPlanId ? 'Edit Care Plan' : 'Create New Care Plan'}</h3>
          <form onSubmit={handleSavePlan}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={label} htmlFor="cp-client">Client *</label>
                <select id="cp-client" value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} disabled={!!editingPlanId} required className={inp}>
                  <option value="">Select client...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="cp-service">Service Type *</label>
                <select id="cp-service" value={formData.serviceType} onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })} className={inp}>
                  {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="cp-frequency">Frequency</label>
                <input id="cp-frequency" type="text" value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: e.target.value })} placeholder="e.g., Daily, 3x per week, Monday-Friday" className={inp} />
              </div>
              <div>
                <label className={label} htmlFor="cp-start">Start Date</label>
                <input id="cp-start" type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} className={inp} />
              </div>
              <div>
                <label className={label} htmlFor="cp-end">End Date (if applicable)</label>
                <input id="cp-end" type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className={inp} />
              </div>
              <div>
                <label className={label} htmlFor="cp-status">Status</label>
                <select id="cp-status" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className={inp}>
                  {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <small className="text-gray-500 dark:text-slate-400">Only an Active plan inside its dates is the client's current plan — the one caregivers and family see.</small>
              </div>
            </div>

            <div className="mt-4">
              <span className={label}>Visit Schedule</span>
              {visitSchedule.text ? (
                <div className="whitespace-pre-wrap px-3 py-2 rounded-md border text-sm border-gray-200 bg-gray-50 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                  {visitSchedule.text}
                  <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">As of {fmtAsOf(visitSchedule.asOf)}{visitSchedule.action === 'current' && ' — saved when you click Save/Create'}</div>
                </div>
              ) : (
                <div className="text-sm text-gray-400 dark:text-slate-500">{visitSchedule.action === '' ? 'Schedule will be removed when you save.' : 'No visit schedule saved on this plan.'}</div>
              )}
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={fillFromSchedule} disabled={scheduleLoading || !formData.clientId}>{scheduleLoading ? 'Loading…' : '📅 Fill from current schedule'}</button>
                {visitSchedule.text && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setVisitSchedule({ text: '', asOf: null, action: '' })}>Clear</button>}
              </div>
              <small className="text-gray-500 dark:text-slate-400">Copied from the client's shifts in Scheduling. Change shifts there, then fill again.</small>
            </div>

            {NOTE_FIELDS.map(([key, title, placeholder, rows]) => (
              <div key={key} className="mt-4">
                <label className={label} htmlFor={`cp-${key}`}>{title}</label>
                <textarea id={`cp-${key}`} value={formData[key]} onChange={(e) => setFormData({ ...formData, [key]: e.target.value })} placeholder={placeholder} rows={rows} className={inp}></textarea>
              </div>
            ))}

            <div className="flex gap-2 mt-4">
              <button type="submit" className="btn btn-primary">{editingPlanId ? 'Save Changes' : 'Create Care Plan'}</button>
              <button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {clients.length === 0 ? (
        <div className={`${panel} text-center`}><p>No clients yet. Create a client to add care plans.</p></div>
      ) : (
        <div className="grid gap-4">
          {clients.map(client => {
            const clientPlans = carePlans[client.id] || [];
            const activePlans = clientPlans.filter(isActivePlan);
            const draftCount = clientPlans.filter((p: any) => p.status === 'draft').length;
            const isExpanded = expandedClient === client.id;
            return (
              <div key={client.id} className={panel}>
                <button type="button" className="w-full flex items-center justify-between pb-3 border-b text-left border-gray-200 dark:border-slate-700"
                  aria-expanded={isExpanded}
                  onClick={() => {
                    setExpandedClient(isExpanded ? null : client.id);
                    if (!isExpanded && clientPlans.length > 0) { loadCurrentSchedule(client.id); loadCareTasks(client.id); }
                  }}>
                  <div>
                    <h3 className="m-0 text-base font-semibold">{client.first_name} {client.last_name}</h3>
                    <small className="text-gray-500 dark:text-slate-400">
                      {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
                      {draftCount > 0 && ` • ${draftCount} draft${draftCount !== 1 ? 's' : ''}`}
                      {clientPlans.length - activePlans.length - draftCount > 0 && ` • ${clientPlans.length - activePlans.length - draftCount} not active`}
                    </small>
                  </div>
                  <span className="text-lg">{isExpanded ? '▼' : '▶'}</span>
                </button>

                {isExpanded && (
                  <div className="pt-4">
                    {clientPlans.length === 0 ? (
                      <p className="text-center p-4 text-gray-400 dark:text-slate-500">No care plans yet for this client.</p>
                    ) : (
                      <div className="grid gap-4">
                        {clientPlans.map(plan => {
                          const active = isActivePlan(plan);
                          const live = currentSchedules[client.id];
                          const tasks = careTasks[client.id];
                          // The server's minutes per week (services/careTaskMinutes.ts): a daily task counts once per scheduled visit.
                          const mins = (t: any) => Number(t.minutes_per_week) || 0;
                          return (
                            <div key={plan.id} className={`p-4 rounded-lg border ${active ? 'border-blue-400 bg-sky-50 text-gray-900 dark:border-blue-700 dark:bg-slate-900 dark:text-slate-100' : 'border-gray-200 bg-gray-50 text-gray-700 opacity-75 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                                <div>
                                  <strong>{serviceLabel(plan.service_type)}</strong>
                                  {plan.frequency && <div className="text-sm text-gray-500 dark:text-slate-400">{plan.frequency}</div>}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(() => { const [text, cls] = planTag(plan); return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{text}</span>; })()}
                                  {plan.status === 'draft' && (
                                    <button type="button" className={`${btnSm} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-600 dark:bg-emerald-700 dark:text-white`}
                                      title="Make this draft the client's current care plan" onClick={() => activatePlan(plan)}>✓ Activate</button>
                                  )}
                                  <button type="button" className={`${btnSm} border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-600 dark:text-white`}
                                    onClick={() => { setShowGenModal(plan); setGenForm({ caregiverId: '', startTime: '09:00', endTime: '13:00', daysOfWeek: [], startDate: plan.start_date ? String(plan.start_date).slice(0, 10) : '', endDate: plan.end_date ? String(plan.end_date).slice(0, 10) : '' }); }}>
                                    Generate Schedule
                                  </button>
                                  <button type="button" className={btnNeutral} title="Edit this care plan" onClick={() => startEdit(plan)}>✏️ Edit</button>
                                  <button type="button" className={btnNeutral} title="View previous versions of this care plan" onClick={() => loadRevisions(plan)}>📜 History</button>
                                  <button type="button" className={btnNeutral} title="Download a printable PDF" onClick={() => downloadPdf(plan)}>📄 PDF</button>
                                  <button type="button" className={`${btnSm} border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-700 dark:text-white`} onClick={() => handleDeletePlan(plan.id)}>Delete</button>
                                </div>
                              </div>

                              <div className="text-sm mb-3"><strong>Period:</strong> {formatDate(plan.start_date)}{plan.end_date && ` - ${formatDate(plan.end_date)}`}</div>

                              {active && live && (!plan.visit_schedule ? (
                                <div className="mb-3 px-3 py-2 rounded-md border text-sm border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                                  No visit schedule is saved on this plan. Click <b>✏️ Edit</b> → <b>Fill from current schedule</b>.
                                </div>
                              ) : plan.visit_schedule !== (live.text || '') ? (
                                <div className="mb-3 px-3 py-2 rounded-md border text-sm border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                                  ⚠️ <b>Schedule changed since this plan was saved ({fmtAsOf(plan.visit_schedule_as_of)}).</b> Update the plan: ✏️ Edit → Fill from current schedule.
                                  <div className="mt-1 whitespace-pre-wrap"><b>Current schedule:</b>{'\n'}{live.text || 'No recurring visits scheduled in the next 4 weeks.'}</div>
                                </div>
                              ) : null)}

                              {plan.visit_schedule && (
                                <div className="mb-3">
                                  <strong>Visit Schedule</strong> <small className="text-gray-500 dark:text-slate-400">(as of {fmtAsOf(plan.visit_schedule_as_of)})</small>
                                  <p className="my-1 whitespace-pre-wrap">{plan.visit_schedule}</p>
                                </div>
                              )}

                              {active && tasks && (tasks.length === 0 ? (
                                <div className="mb-3 text-sm text-gray-500 dark:text-slate-400"><strong>Care Tasks:</strong> none yet — add them in Clients → 📋 Tasks.</div>
                              ) : (
                                <div className="mb-3">
                                  <strong>Care Tasks</strong> <small className="text-gray-500 dark:text-slate-400">({tasks.length} · {tasks.reduce((a, t) => a + mins(t), 0)} min/week · from Clients → 📋 Tasks)</small>
                                  {TASK_GROUPS.map(([cat, groupLabel]) => {
                                    const group = tasks.filter(t => (TASK_GROUPS.some(([c]) => c === t.category) ? t.category : 'other') === cat);
                                    if (!group.length) return null;
                                    return (
                                      <div key={cat} className="mt-1.5 text-sm">
                                        <div className="font-semibold">{groupLabel} — {group.reduce((a, t) => a + mins(t), 0)} min/week</div>
                                        <ul className="mt-0.5 mb-0 pl-5 list-disc">
                                          {group.map(t => <li key={t.id}>{t.task_name}: {t.times_per_week}x/week{t.every_visit ? ' (every visit)' : ''} × {t.allotted_minutes || 0} min</li>)}
                                        </ul>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}

                              {plan.service_description && <div className="mb-3"><strong>Description:</strong><p className="my-1 whitespace-pre-wrap">{plan.service_description}</p></div>}
                              {plan.care_goals && <div className="mb-3"><strong>Care Goals:</strong><p className="my-1 whitespace-pre-wrap">{plan.care_goals}</p></div>}
                              {plan.special_instructions && <div className="mb-3"><strong>Special Instructions:</strong><p className="my-1 whitespace-pre-wrap">{plan.special_instructions}</p></div>}
                              {plan.precautions && (
                                <div className="mb-3 p-3 rounded bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100">
                                  <strong>Safety Precautions:</strong><p className="my-1 whitespace-pre-wrap">{plan.precautions}</p>
                                </div>
                              )}
                              {(plan.medication_notes || plan.mobility_notes || plan.dietary_notes || plan.communication_notes) && (
                                <div className="grid gap-3 mt-3 md:grid-cols-2">
                                  {[['Medication', plan.medication_notes], ['Mobility', plan.mobility_notes], ['Dietary', plan.dietary_notes], ['Communication', plan.communication_notes]]
                                    .filter(([, v]) => v).map(([t, v]) => (
                                      <div key={t} className="p-2 rounded text-sm bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200">
                                        <strong>{t}:</strong><p className="my-1 whitespace-pre-wrap">{v}</p>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showGenModal && (
        <div className={modalWrap}>
          <div className={`${modalBox} max-w-lg`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="m-0 text-lg font-semibold">Generate Schedule from Care Plan</h3>
              <button type="button" aria-label="Close" onClick={() => setShowGenModal(null)} className="text-2xl leading-none text-gray-500 dark:text-slate-400">×</button>
            </div>
            <div className="rounded-lg p-3 mb-4 text-sm bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <strong>{serviceLabel(showGenModal.service_type)}</strong>{showGenModal.frequency && <span> — {showGenModal.frequency}</span>}
            </div>
            <form onSubmit={handleGenerateSchedule}>
              <div className="mb-3">
                <label className={label} htmlFor="gen-cg">Caregiver *</label>
                <select id="gen-cg" value={genForm.caregiverId} onChange={e => setGenForm((p: any) => ({ ...p, caregiverId: e.target.value }))} required className={inp}>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <span className={label}>Days of Week *</span>
                <div className="flex flex-wrap gap-1.5">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                    <button key={i} type="button" onClick={() => toggleGenDay(i)} aria-pressed={genForm.daysOfWeek.includes(i)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${genForm.daysOfWeek.includes(i) ? 'border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-600 dark:text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'}`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 grid-cols-2 mb-3">
                <div><label className={label} htmlFor="gen-start">Start Time *</label><input id="gen-start" type="time" value={genForm.startTime} onChange={e => setGenForm((p: any) => ({ ...p, startTime: e.target.value }))} required className={inp} /></div>
                <div><label className={label} htmlFor="gen-end">End Time *</label><input id="gen-end" type="time" value={genForm.endTime} onChange={e => setGenForm((p: any) => ({ ...p, endTime: e.target.value }))} required className={inp} /></div>
                <div><label className={label} htmlFor="gen-eff">Effective Date</label><input id="gen-eff" type="date" value={genForm.startDate} onChange={e => setGenForm((p: any) => ({ ...p, startDate: e.target.value }))} className={inp} /></div>
                <div><label className={label} htmlFor="gen-endd">End Date</label><input id="gen-endd" type="date" value={genForm.endDate} onChange={e => setGenForm((p: any) => ({ ...p, endDate: e.target.value }))} className={inp} /></div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary">Generate {genForm.daysOfWeek.length} Schedule{genForm.daysOfWeek.length !== 1 ? 's' : ''}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowGenModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {revisionsFor && (() => {
        const FIELDS: [string, string][] = [
          ['service_type', 'Service Type'], ['service_description', 'Service Description'], ['frequency', 'Frequency'],
          ['visit_schedule', 'Visit Schedule'], ['visit_schedule_as_of', 'Visit Schedule As Of'], ['care_goals', 'Care Goals'],
          ['special_instructions', 'Special Instructions'], ['precautions', 'Precautions'], ['medication_notes', 'Medication Notes'],
          ['mobility_notes', 'Mobility Notes'], ['dietary_notes', 'Dietary Notes'], ['communication_notes', 'Communication Notes'],
          ['start_date', 'Start Date'], ['end_date', 'End Date'], ['status', 'Status'],
        ];
        // Each revision is the OLD snapshot; compare it with the next-newer one (or the plan as it
        // is now, for the latest revision).
        const sorted = [...revisions].sort((a, b) => b.revision_number - a.revision_number);
        const newerOf = (idx: number) => idx === 0 ? revisionsFor : sorted[idx - 1];
        const norm = (k: string, v: any) => (v == null ? '' : /date|as_of/.test(k) ? String(v).slice(0, 10) : String(v));
        return (
          <div className={modalWrap} onClick={() => setRevisionsFor(null)}>
            <div className={`${modalBox} max-w-3xl`} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="m-0 text-lg font-semibold">📜 Revision History</h3>
                <button type="button" aria-label="Close" onClick={() => setRevisionsFor(null)} className="text-2xl leading-none text-gray-500 dark:text-slate-400">×</button>
              </div>
              {revisionsLoading ? (
                <p className="text-gray-500 dark:text-slate-400">Loading…</p>
              ) : revisions.length === 0 ? (
                <p className="text-gray-400 dark:text-slate-500">No changes recorded yet for this care plan.</p>
              ) : (
                <div className="grid gap-3">
                  {sorted.map((rev, idx) => {
                    const newer = newerOf(idx);
                    const changes = FIELDS.map(([k, l]) => ({ k, l, old: norm(k, rev[k]), next: norm(k, newer[k]) })).filter(c => c.old !== c.next);
                    return (
                      <div key={rev.id} className="p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-1.5">
                          <strong>Revision #{rev.revision_number}</strong>
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            {new Date(rev.changed_at).toLocaleString()}{rev.changed_by_first && ` · by ${rev.changed_by_first} ${rev.changed_by_last?.[0] || ''}.`}
                          </span>
                        </div>
                        {changes.length === 0 ? (
                          <p className="m-0 text-sm text-gray-400 dark:text-slate-500">(snapshot; no field changes captured)</p>
                        ) : (
                          <div className="grid gap-1.5">
                            {changes.map(c => (
                              <div key={c.k} className="px-3 py-2 rounded-md text-sm bg-gray-50 dark:bg-slate-900">
                                <div className="font-bold mb-0.5 text-gray-700 dark:text-slate-200">{c.l}</div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="p-1.5 rounded whitespace-pre-wrap bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100">− {c.old === '' ? <em className="opacity-70">(empty)</em> : c.old}</div>
                                  <div className="p-1.5 rounded whitespace-pre-wrap bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">+ {c.next === '' ? <em className="opacity-70">(empty)</em> : c.next}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
