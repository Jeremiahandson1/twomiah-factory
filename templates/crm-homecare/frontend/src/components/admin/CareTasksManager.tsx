// CareTasksManager — the office's modal for a client's recurring care tasks (the checklist a
// caregiver works through each shift). Tasks can be imported from an insurer's assessment PDF
// (the formats this agency's state uses), or pasted as JSON; "What's getting done" shows each
// task's completions over the last 7/30/90 days.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { confirm } from '../ConfirmModal';
import { parseLocalDate } from '../../utils/date';

const CATEGORIES = [
  { value: 'adl', label: 'ADL (bathing, dressing…)' },
  { value: 'iadl', label: 'IADL (meals, housekeeping…)' },
  { value: 'medication', label: 'Medication Reminder' },
  { value: 'companion', label: 'Companion / Social' },
  { value: 'safety', label: 'Safety Check' },
  { value: 'other', label: 'Other' },
];

// Number inputs hold what was typed; they are checked when the task is saved.
const emptyForm = { taskName: '', description: '', category: 'iadl', allottedMinutes: '15', weeklyFrequency: '1', daysOfWeek: '', timeOfDay: 'any', cadence: 'daily' };

const inp = 'px-2 py-2 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export default function CareTasksManager({ client, onClose }: { client: any; onClose: () => void }) {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [formats, setFormats] = useState<any[]>([]);
  const [format, setFormat] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [parsed, setParsed] = useState<any>(null);
  const [parseError, setParseError] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [pdfReading, setPdfReading] = useState(false);
  const [nameMismatchOk, setNameMismatchOk] = useState(false);

  const [showAdherence, setShowAdherence] = useState(false);
  const [adherence, setAdherence] = useState<any>(null);
  const [adherenceDays, setAdherenceDays] = useState(30);
  const [adherenceLoading, setAdherenceLoading] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };
  const hdr = { 'Content-Type': 'application/json', ...auth };
  const first = client.first_name || client.firstName;
  const last = client.last_name || client.lastName;

  const load = async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/client/${client.id}`, { headers: auth });
      if (!r.ok) throw new Error('Failed to load tasks');
      setTasks(await r.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadFormats = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/assessment-formats`, { headers: auth });
      if (r.ok) { const f = await r.json(); setFormats(f); setFormat(f[0]?.id || ''); }
    } catch { /* the JSON paste still works */ }
  };

  const loadAdherence = async (days?: number) => {
    const d = days ?? adherenceDays;
    setAdherenceLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/client/${client.id}/adherence?days=${d}`, { headers: auth });
      if (r.ok) setAdherence(await r.json());
    } catch { /* non-fatal */ }
    finally { setAdherenceLoading(false); }
  };

  useEffect(() => { if (client?.id) { load(); loadFormats(); } }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setForm(emptyForm); setEditingId(null); setError(''); };

  const save = async () => {
    if (!String(form.taskName).trim()) { setError('Task name required'); return; }
    if (!/^\d+$/.test(String(form.allottedMinutes).trim())) { setError('Minutes per task must be a whole number of minutes'); return; }
    if (!/^[1-9]\d*$/.test(String(form.weeklyFrequency).trim())) { setError('Times per week must be a whole number, 1 or more'); return; }
    setError('');
    const body = { ...form, allottedMinutes: parseInt(form.allottedMinutes, 10), weeklyFrequency: parseInt(form.weeklyFrequency, 10) };
    try {
      const r = await fetch(editingId ? `${API_BASE_URL}/api/care-tasks/${editingId}` : `${API_BASE_URL}/api/care-tasks/client/${client.id}`, {
        method: editingId ? 'PUT' : 'POST', headers: hdr, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || (editingId ? 'Update failed' : 'Create failed'));
      reset();
      load();
    } catch (e: any) { setError(e.message); }
  };

  const edit = (t: any) => {
    setEditingId(t.id);
    setForm({
      taskName: t.task_name, description: t.description || '', category: t.category || 'other',
      allottedMinutes: String(t.allotted_minutes ?? 0), weeklyFrequency: String(t.weekly_frequency || 1),
      daysOfWeek: t.days_of_week || '', timeOfDay: t.time_of_day || 'any', cadence: t.cadence || 'daily',
    });
  };

  const remove = async (t: any) => {
    if (!(await confirm(`Remove "${t.task_name}" from this client's task list?`, { danger: true }))) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/${t.id}`, { method: 'DELETE', headers: hdr });
      if (!r.ok) throw new Error('Delete failed');
      if (editingId === t.id) reset();
      load();
    } catch (e: any) { setError(e.message); }
  };

  // ── assessment import ──
  const readPdf = async (file?: File) => {
    if (!file) return;
    setParseError(''); setImportResult(null); setParsed(null); setNameMismatchOk(false);
    setPdfReading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (format) fd.append('format', format);
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/client/${client.id}/parse-assessment-pdf`, { method: 'POST', headers: auth, body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Could not read the PDF (HTTP ${r.status})`);
      setParsed(data);
    } catch (e: any) { setParseError(e.message); }
    finally { setPdfReading(false); }
  };

  const parseJson = () => {
    setParseError(''); setImportResult(null); setNameMismatchOk(false);
    try {
      const obj = JSON.parse(rawJson);
      if (!obj || !Array.isArray(obj.tasks) || obj.tasks.length === 0) throw new Error('JSON must have a non-empty "tasks" array');
      setParsed(obj);
    } catch (e: any) { setParsed(null); setParseError(e.message); }
  };

  const previewMinsPerWeek = parsed
    ? parsed.tasks.reduce((s: number, t: any) => s + (parseInt(t.weeklyFrequency, 10) || 1) * (parseInt(t.allottedMinutes, 10) || 0), 0)
    : 0;
  const expectedMins = parsed?.assessmentTotals?.minsPerWeek;
  const reconcileOk = expectedMins == null ? null : Number(expectedMins) === previewMinsPerWeek;

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true); setParseError(''); setImportResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/client/${client.id}/import`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({ tasks: parsed.tasks, replaceExisting, source: parsed.source || 'midas_shc_homemaking', assessmentTotals: parsed.assessmentTotals || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Import failed');
      setImportResult(data);
      setRawJson(''); setParsed(null);
      load();
    } catch (e: any) { setParseError(e.message); }
    finally { setImporting(false); }
  };

  // The server's minutes per week (services/careTaskMinutes.ts): a daily task counts once per scheduled visit.
  const weeklyMinutes = tasks.reduce((sum, t) => sum + (Number(t.minutes_per_week) || 0), 0);
  const activeFormat = formats.find(f => f.id === format);

  return (
    <div className="fixed inset-0 z-[2300] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col rounded-xl bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-200 dark:border-slate-700">
          <div>
            <h3 className="m-0 text-lg font-semibold">📋 Care Tasks — {first} {last}</h3>
            <p className="mt-1 mb-0 text-sm text-gray-500 dark:text-slate-400">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {weeklyMinutes} min/week · {(weeklyMinutes / 15).toFixed(2)} units/week
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close care tasks" className="text-2xl leading-none text-gray-400 dark:text-slate-400">×</button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <button type="button" onClick={() => setShowImport(v => !v)} className="btn btn-sm btn-secondary">
              {showImport ? '▾ Hide assessment import' : '▸ Import from an assessment'}
            </button>
            <button type="button" onClick={() => { const next = !showAdherence; setShowAdherence(next); if (next && !adherence) loadAdherence(); }} className="btn btn-sm btn-secondary">
              {showAdherence ? "▾ Hide what's getting done" : "📊 What's getting done"}
            </button>
          </div>

          {showAdherence && (
            <div className="rounded-xl p-3 mb-4 border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="font-bold text-sm">📊 Task completion — last {adherence?.days || adherenceDays} days</div>
                <select value={adherenceDays} onChange={(e) => { const d = parseInt(e.target.value); setAdherenceDays(d); loadAdherence(d); }} className={inp}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </div>
              {adherenceLoading ? (
                <div className="text-sm">Loading…</div>
              ) : !adherence || adherence.tasks.length === 0 ? (
                <div className="text-sm">No active tasks to report on.</div>
              ) : (
                <>
                  <div className="text-xs mb-2">
                    {adherence.totalShifts} shift{adherence.totalShifts !== 1 ? 's' : ''} in this period · "Not addressed" = daily tasks with no entry on a shift. Rows where misses outweigh completions are highlighted.
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left">
                          <th className="px-1.5 py-1">Task</th><th>When</th>
                          <th className="text-right">Done</th><th className="text-right">Skipped</th><th className="text-right">Refused</th>
                          <th className="text-right">Not addressed</th><th className="pl-2">Last done</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adherence.tasks.map((t: any) => {
                          const completed = t.completed || 0, skipped = t.skipped || 0, refused = t.refused || 0;
                          const notAddressed = t.cadence === 'weekly' ? null : Math.max(0, (adherence.totalShifts || 0) - completed - skipped - refused);
                          const flag = (skipped + refused) > completed || (notAddressed != null && notAddressed > completed);
                          return (
                            <tr key={t.task_id} className={`border-t border-amber-200 dark:border-amber-800 ${flag ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100' : ''}`}>
                              <td className="px-1.5 py-1 font-semibold">{t.task_name}</td>
                              <td>{t.cadence === 'weekly' ? '🗓️ Weekly' : '📅 Daily'}</td>
                              <td className="text-right font-bold">{completed}</td>
                              <td className="text-right">{skipped}</td>
                              <td className="text-right">{refused}</td>
                              <td className="text-right font-bold">{notAddressed == null ? '—' : notAddressed}</td>
                              <td className="pl-2">{t.last_completed ? parseLocalDate(t.last_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {showImport && (
            <div className="rounded-xl p-3 mb-4 border border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
              <div className="font-bold text-sm mb-1">📥 Import from an insurer assessment</div>
              {formats.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
                    <label htmlFor="assessment-format">Assessment:</label>
                    <select id="assessment-format" value={format} onChange={(e) => setFormat(e.target.value)} className={inp}>
                      {formats.map(f => <option key={f.id} value={f.id}>{f.insurer} — {f.label} ({f.portal})</option>)}
                    </select>
                  </div>
                  <div className="text-xs mb-2">
                    Upload the <b>{activeFormat?.label}</b> PDF → review the tasks and totals → Import.
                  </div>
                  <label className="btn btn-sm btn-primary inline-block mb-2" style={{ cursor: pdfReading ? 'wait' : 'pointer' }}>
                    {pdfReading ? 'Reading PDF…' : '📄 Upload assessment PDF'}
                    <input type="file" accept="application/pdf,.pdf" disabled={pdfReading} className="hidden"
                      onChange={(e) => { readPdf(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  <div className="text-xs mb-1 opacity-80">Or paste JSON:</div>
                </>
              ) : (
                <div className="text-xs mb-2">No insurer assessment PDF is set up for your state. Paste the tasks as JSON instead:</div>
              )}
              <textarea placeholder='{ "source": "assessment", "assessmentTotals": { "minsPerWeek": 291 }, "tasks": [ … ] }'
                value={rawJson} onChange={(e) => setRawJson(e.target.value)} rows={5}
                className={`w-full font-mono text-xs mb-2 ${inp}`} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={parseJson} className="btn btn-sm btn-secondary" disabled={!rawJson.trim()}>Parse &amp; preview</button>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                  Replace existing tasks (re-import of updated assessment)
                </label>
              </div>
              {parseError && <div className="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">{parseError}</div>}

              {parsed && (
                <div className="mt-2">
                  {parsed.member && (
                    <div className="text-sm mb-2">
                      Assessment for <b>{parsed.member.firstName} {parsed.member.lastName}</b>
                      {parsed.member.memberId && ` · Member ID ${parsed.member.memberId}`}
                      {parsed.member.assessDate && ` · assessed ${parsed.member.assessDate}`}
                      {parsed.member.assessor && ` by ${parsed.member.assessor}`}
                      {parsed.sections?.map((s: any) => (
                        <div key={s.name} className="opacity-80">{s.name}: {s.tasks} task(s), {s.minsPerWeek} min/week</div>
                      ))}
                    </div>
                  )}
                  {parsed.clientNameMatch === false && (
                    <div className="px-3 py-2 rounded-md text-sm mb-2 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
                      ⚠️ The name on this assessment does not match {first} {last}.
                      <label className="flex items-center gap-1 mt-1">
                        <input type="checkbox" checked={nameMismatchOk} onChange={(e) => setNameMismatchOk(e.target.checked)} />
                        I checked — this assessment belongs to this client
                      </label>
                    </div>
                  )}
                  <div className={`px-3 py-2 rounded-md text-sm mb-2 ${reconcileOk === false ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : reconcileOk === true ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                    {parsed.tasks.length} task(s) · computed <b>{previewMinsPerWeek} min/week</b> ({(previewMinsPerWeek / 15).toFixed(2)} units)
                    {expectedMins != null && (reconcileOk ? ` · ✅ matches assessment total (${expectedMins})` : ` · ⚠️ assessment says ${expectedMins} — mismatch, recheck the read`)}
                  </div>
                  <div className="max-h-44 overflow-auto rounded-md border border-blue-200 bg-white text-gray-900 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-100">
                    <table className="w-full text-xs border-collapse">
                      <thead><tr className="text-left bg-blue-100 text-blue-950 dark:bg-blue-900 dark:text-blue-50">
                        <th className="px-2 py-1">Task</th><th>Cat</th><th>x/wk</th><th>min</th><th>Days</th><th>Time</th>
                      </tr></thead>
                      <tbody>
                        {parsed.tasks.map((t: any, i: number) => (
                          <tr key={i} className="border-t border-blue-50 dark:border-slate-700">
                            <td className="px-2 py-1">{t.taskName}</td><td>{t.category || 'iadl'}</td><td>{t.weeklyFrequency || 1}</td>
                            <td>{t.allottedMinutes || 0}</td><td>{t.daysOfWeek || '—'}</td><td>{t.timeOfDay || 'any'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={runImport} className="btn btn-sm btn-primary mt-2" disabled={importing || (parsed.clientNameMatch === false && !nameMismatchOk)}>
                    {importing ? 'Importing…' : `Import ${parsed.tasks.length} task(s)${replaceExisting ? ' (replace current)' : ''}`}
                  </button>
                </div>
              )}
              {importResult && (
                <div className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
                  ✅ Imported {importResult.imported} task(s){importResult.replacedExisting ? ', replaced previous list' : ''}.
                  {importResult.reconciliation?.match === false && ' (⚠️ totals did not reconcile — review tasks below.)'}
                </div>
              )}
            </div>
          )}

          <div className={`rounded-xl p-3 mb-4 ${editingId ? 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50' : 'bg-gray-50 text-gray-900 dark:bg-slate-900 dark:text-slate-100'}`}>
            <div className="font-bold text-sm mb-2">{editingId ? '✏️ Edit Task' : '+ Add Task'}</div>
            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
              <input aria-label="Task name" placeholder="Task name (e.g. Dust/Vacuum)" value={form.taskName} onChange={(e) => setForm({ ...form, taskName: e.target.value })} className={inp} />
              <select aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inp}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input aria-label="Minutes per task" inputMode="numeric" placeholder="Min/task" value={form.allottedMinutes} onChange={(e) => setForm({ ...form, allottedMinutes: e.target.value })} className={inp} />
            </div>
            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr' }}>
              <select aria-label="Cadence" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} className={inp} title="Daily = every shift; Weekly = once per week">
                <option value="daily">📅 Daily</option>
                <option value="weekly">🗓️ Weekly</option>
              </select>
              <input aria-label="Times per week" inputMode="numeric" placeholder="x / week" value={form.weeklyFrequency} onChange={(e) => setForm({ ...form, weeklyFrequency: e.target.value })} className={inp} />
              <input aria-label="Days" placeholder="Days (e.g. Mon,Wed,Fri or Daily)" value={form.daysOfWeek} onChange={(e) => setForm({ ...form, daysOfWeek: e.target.value })} className={inp} />
              <select aria-label="Time of day" value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} className={inp}>
                <option value="any">Any time</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
            {form.cadence === 'daily' && (
              <div className="mb-2 text-xs text-gray-600 dark:text-slate-300">
                A daily task is done on every visit, so it counts once per scheduled visit in the minutes per week. "Times per week" is used only while the client has no visits scheduled.
              </div>
            )}
            <textarea aria-label="Description" placeholder="Optional description / instructions" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={`w-full mb-2 ${inp}`} />
            <div className="flex gap-2">
              <button type="button" onClick={save} className="btn btn-primary btn-sm">{editingId ? 'Save Changes' : 'Add Task'}</button>
              {editingId && <button type="button" onClick={reset} className="btn btn-secondary btn-sm">Cancel</button>}
            </div>
            {error && <div className="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">{error}</div>}
          </div>

          {loading ? (
            <div className="text-center p-8 text-gray-400 dark:text-slate-500">Loading…</div>
          ) : tasks.length === 0 ? (
            <div className="text-center p-8 rounded-xl bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400">
              No care tasks yet. Add tasks above, or import an assessment, and caregivers will see them as a checklist during the shift.
            </div>
          ) : (
            <div>
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 mb-1.5 rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{t.task_name}</div>
                    {t.description && <div className="text-xs mt-0.5 text-gray-500 dark:text-slate-400">{t.description}</div>}
                    <div className="text-xs mt-1 text-gray-500 dark:text-slate-400">
                      <b className={t.cadence === 'weekly' ? 'text-violet-700 dark:text-violet-300' : 'text-blue-700 dark:text-blue-300'}>{t.cadence === 'weekly' ? '🗓️ Weekly' : '📅 Daily'}</b>
                      {' · '}{CATEGORIES.find(c => c.value === t.category)?.label || t.category}
                      {' · '}{t.times_per_week}×/wk{t.every_visit ? ' (every visit)' : ''} × {t.allotted_minutes} min = <b>{t.minutes_per_week} min/wk</b>
                      {t.days_of_week ? ` · ${t.days_of_week}` : ''}
                      {t.time_of_day && t.time_of_day !== 'any' ? ` · ${t.time_of_day}` : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => edit(t)} className="btn btn-sm btn-secondary">Edit</button>
                  <button type="button" onClick={() => remove(t)} className="px-2.5 py-1 rounded-md text-xs border border-red-300 bg-white text-red-700 dark:border-red-700 dark:bg-slate-900 dark:text-red-300">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end border-t border-gray-200 dark:border-slate-700">
          <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
