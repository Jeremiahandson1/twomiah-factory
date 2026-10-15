// CareTaskChecklist — during a shift, the client's care tasks: tap Done / Skip / Refused, add a
// note. Daily tasks are done every shift; weekly tasks show "done earlier this week" once any
// shift this week has completed them. Used on the caregiver's active shift and by the office.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_LABELS: Record<string, string> = {
  adl: 'ADL', iadl: 'IADL', medication: 'Med', companion: 'Companion', safety: 'Safety', other: 'Other',
};

// Each status is a complete pair: ground + ink, in both themes.
const STATUS: Record<string, { card: string; chip: string; label: string }> = {
  pending: { card: 'bg-white border-gray-300 dark:bg-slate-800 dark:border-slate-600', chip: 'text-gray-600 dark:text-slate-300', label: '⬜ Pending' },
  completed: { card: 'bg-emerald-50 border-emerald-500 dark:bg-emerald-950 dark:border-emerald-600', chip: 'text-emerald-800 dark:text-emerald-200', label: '✅ Done' },
  skipped: { card: 'bg-amber-50 border-amber-500 dark:bg-amber-950 dark:border-amber-600', chip: 'text-amber-800 dark:text-amber-200', label: '↪️ Skipped' },
  refused: { card: 'bg-red-50 border-red-500 dark:bg-red-950 dark:border-red-600', chip: 'text-red-800 dark:text-red-200', label: '🚫 Refused' },
};

type Item = {
  task_id: string; task_name: string; description?: string | null; category: string; allotted_minutes: number;
  cadence?: string; status: string; notes?: string | null; done_this_week?: boolean;
};

export default function CareTaskChecklist({ timeEntryId, compact = false, onChange }: { timeEntryId: string; compact?: boolean; onChange?: () => void }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notesFor, setNotesFor] = useState<Item | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/time-entry/${timeEntryId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setItems(await r.json());
      else setError((await r.json().catch(() => ({}))).error || 'Could not load the care tasks');
    } catch { setError('Could not load the care tasks'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (timeEntryId) load(); }, [timeEntryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (taskId: string, status: string, notes?: string | null) => {
    setError('');
    try {
      const r = await fetch(`${API_BASE_URL}/api/care-tasks/time-entry/${timeEntryId}/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, notes: notes ?? null }),
      });
      if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Not saved — try again'); return; }
      setItems(prev => prev.map(it => it.task_id === taskId ? { ...it, status, notes: notes ?? it.notes } : it));
      onChange?.();
    } catch { setError('Not saved — check your connection and try again'); }
  };

  const saveNotes = async () => {
    if (!notesFor) return;
    await setStatus(notesFor.task_id, notesFor.status, notesDraft);
    setNotesFor(null);
    setNotesDraft('');
  };

  if (loading) return <div className="p-3 text-center text-sm text-gray-500 dark:text-slate-400">Loading tasks…</div>;
  if (!items.length) {
    return compact ? null : (
      <div className="p-3 text-center text-sm rounded-lg bg-gray-50 text-gray-500 dark:bg-slate-800 dark:text-slate-400">
        {error || 'No care tasks set up for this client.'}
      </div>
    );
  }

  const done = items.filter(i => i.status === 'completed').length;
  const pct = Math.round((done / items.length) * 100);
  const daily = items.filter(t => (t.cadence || 'daily') !== 'weekly');
  const weekly = items.filter(t => (t.cadence || 'daily') === 'weekly');

  const btn = 'px-2.5 py-1.5 rounded-md text-xs font-semibold border';
  const renderItem = (t: Item) => {
    const sc = STATUS[t.status] || STATUS.pending;
    const weeklyDone = t.cadence === 'weekly' && t.done_this_week;
    return (
      <div key={t.task_id} className={`rounded-xl border-2 px-3 py-2.5 ${sc.card} ${weeklyDone && t.status !== 'completed' ? 'opacity-70' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1">
            <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">{t.task_name}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">
              {CATEGORY_LABELS[t.category] || t.category}
              {t.allotted_minutes > 0 && ` · ${t.allotted_minutes} min`}
              {weeklyDone && ' · ✅ done earlier this week'}
            </div>
          </div>
          <span className={`text-xs font-bold ${sc.chip}`}>{sc.label}</span>
        </div>
        {t.description && <div className="text-xs mb-1.5 text-gray-600 dark:text-slate-300">{t.description}</div>}
        {t.notes && <div className="text-xs mb-1.5 px-2 py-1 rounded-md bg-black/5 text-gray-700 dark:bg-white/10 dark:text-slate-200">📝 {t.notes}</div>}
        <div className="flex flex-wrap gap-1.5">
          {t.status !== 'completed' && (
            <button type="button" onClick={() => setStatus(t.task_id, 'completed', t.notes)}
              className={`${btn} border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600 dark:text-white`}>✓ Done</button>
          )}
          {t.status !== 'skipped' && (
            <button type="button" onClick={() => setStatus(t.task_id, 'skipped', t.notes)}
              className={`${btn} border-amber-500 bg-white text-amber-800 dark:border-amber-500 dark:bg-slate-900 dark:text-amber-200`}>Skip</button>
          )}
          {t.status !== 'refused' && (
            <button type="button" onClick={() => setStatus(t.task_id, 'refused', t.notes)}
              className={`${btn} border-red-500 bg-white text-red-800 dark:border-red-500 dark:bg-slate-900 dark:text-red-200`}>Refused</button>
          )}
          {t.status !== 'pending' && (
            <button type="button" onClick={() => setStatus(t.task_id, 'pending', t.notes)}
              className={`${btn} border-gray-300 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300`}>Reset</button>
          )}
          <button type="button" onClick={() => { setNotesFor(t); setNotesDraft(t.notes || ''); }}
            className={`${btn} ml-auto border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200`}>
            {t.notes ? '📝 Edit Note' : '📝 Add Note'}
          </button>
        </div>
      </div>
    );
  };

  const header = 'text-xs font-bold uppercase tracking-wide mt-1 mb-1.5 text-gray-500 dark:text-slate-400';
  return (
    <div className={compact ? 'py-2' : 'p-3'}>
      <div className="flex items-center justify-between mb-2">
        <strong className="text-sm text-gray-900 dark:text-slate-100">📋 Care Tasks</strong>
        <span className="text-xs text-gray-500 dark:text-slate-400">{done} of {items.length} done ({pct}%)</span>
      </div>
      <div className="h-1.5 rounded mb-2.5 overflow-hidden bg-gray-200 dark:bg-slate-700">
        <div className={`h-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {error && <div className="mb-2 px-3 py-2 rounded-md text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {daily.length > 0 && (
        <div className={weekly.length ? 'mb-3' : ''}>
          <div className={header}>📅 Daily</div>
          <div className="flex flex-col gap-1.5">{daily.map(renderItem)}</div>
        </div>
      )}
      {weekly.length > 0 && (
        <div>
          <div className={header}>🗓️ This Week</div>
          <div className="flex flex-col gap-1.5">{weekly.map(renderItem)}</div>
        </div>
      )}

      {notesFor && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setNotesFor(null); }}>
          <div className="w-full max-w-md rounded-xl p-5 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
            <h4 className="m-0 mb-2 text-base font-semibold">Note for: {notesFor.task_name}</h4>
            <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={4}
              placeholder="e.g. Client refused — said she'd shower tomorrow"
              className="w-full p-2 mb-3 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNotesFor(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button type="button" onClick={saveNotes} className="btn btn-primary btn-sm">Save Note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
