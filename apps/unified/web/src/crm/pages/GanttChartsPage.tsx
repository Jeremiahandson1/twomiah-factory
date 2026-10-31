// Moved from templates/crm/frontend/src/pages/GanttChartsPage.tsx.
/**
 * Gantt Charts Page — Construction tier
 * Timeline of every project with its tasks. Whoever may change a project (projects:update, what the server asks)
 * adds tasks and drags a bar to move it, or its right edge to stretch it; everyone else reads it. It was a read-only
 * picture — no adding a task, no dragging (live test, 2026-10-22). Server: crm/projects/ganttCharts.ts.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { BarChart3, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { usePermissions, useToast, useConfirm, PageLoading } from '../../shared'

interface GanttTask {
  id: string;
  projectId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
}

interface GanttProject {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  percentComplete: number;
  tasks?: GanttTask[];
}

/**
 * THE BAR COLOUR IS THE GROUND UNDER A WHITE LABEL. (T51 contractor: "Gantt labels hard to read")
 *
 * The project name is drawn INSIDE the bar in `text-white text-xs` — 12px, so it needs 4.5:1, not
 * the 3:1 that large text gets. Against the old palette none of the five came close:
 *
 *   on_hold   #f59e0b  2.13:1      planning  #94a3b8  2.54:1      completed #10b981  2.54:1
 *   active    #3b82f6  3.68:1      cancelled #ef4444  3.75:1
 *
 * These are the same five hues two steps darker — Tailwind's 600/700 rather than 400/500 — so the
 * chart still reads at a glance as grey / blue / amber / green / red, and every label now clears
 * 4.5:1 against its own bar:
 *
 *   planning  #475569  7.47:1      active    #1d4ed8  6.64:1      on_hold   #b45309  4.99:1
 *   completed #047857  5.49:1      cancelled #b91c1c  6.48:1
 *
 * These are measured against the bar as composited, including the progress overlay below — which
 * used to be `bg-white/25` and lightened the ground under exactly the part of the label most likely
 * to be read. Lifting the colours alone would still have failed there (amber came out at 3.23:1).
 *
 * The legend swatches read these too, so the two cannot drift apart. A task's bar is slate-700
 * (#334155, 10.4:1 under white).
 */
const STATUS_COLORS: Record<string, string> = {
  planning: '#475569',
  active: '#1d4ed8',
  on_hold: '#b45309',
  completed: '#047857',
  cancelled: '#b91c1c',
};
const TASK_COLOR = '#334155';

const DAY = 86400000;
/** A stored instant as its calendar day (bars are whole days, stored at UTC midnight). */
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (v: string | null | undefined) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? NaN : Math.floor(t / DAY) * DAY; };

type Drag = { kind: 'project' | 'task'; id: string; mode: 'move' | 'end'; startX: number; start: number; end: number; days: number };

export default function GanttChartsPage() {
  const [projects, setProjects] = useState<GanttProject[]>([]);
  const [loading, setLoading] = useState(true);
  const { known, can } = usePermissions();
  const mayPlan = known && can('projects:update');
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', startDate: '', endDate: '' });
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    api.get('/api/gantt-charts').then(({ data }) => { setProjects(data || []); setLoading(false); }).catch((e) => { console.error(e); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // The timeline's range, from every project and task, fixed while a bar is being dragged so the scale holds still.
  const allDates = projects.flatMap((p) => [dayStart(p.startDate), dayStart(p.endDate), ...(p.tasks || []).flatMap((t) => [dayStart(t.startDate), dayStart(t.endDate)])]).filter((n) => !Number.isNaN(n));
  const minDate = allDates.length ? Math.min(...allDates) : Math.floor(Date.now() / DAY) * DAY;
  const maxDate = (allDates.length ? Math.max(...allDates) : minDate) + DAY;
  const totalSpan = Math.max(maxDate - minDate, DAY);
  const totalDays = Math.ceil(totalSpan / DAY);

  const daysFromPixels = (dx: number) => {
    const width = trackRef.current?.getBoundingClientRect().width || 800;
    return Math.round((dx / width) * totalDays);
  };

  const beginDrag = (e: React.PointerEvent, kind: Drag['kind'], id: string, mode: Drag['mode'], start: number, end: number) => {
    if (!mayPlan) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ kind, id, mode, startX: e.clientX, start, end, days: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const days = daysFromPixels(e.clientX - drag.startX);
    if (days !== drag.days) setDrag({ ...drag, days });
  };
  const endDrag = async () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.days) return;
    const start = d.mode === 'move' ? d.start + d.days * DAY : d.start;
    const end = Math.max(start, d.end + d.days * DAY);
    const body = { startDate: ymd(start), endDate: ymd(end) };
    try {
      if (d.kind === 'project') await api.patch(`/api/gantt-charts/${d.id}/dates`, body);
      else await api.patch(`/api/gantt-charts/tasks/${d.id}`, body);
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not move it'); load(); }
  };
  /** Where a bar is drawn: its own dates, shifted by the drag in progress when it is the one being dragged. */
  const placed = (kind: Drag['kind'], id: string, start: number, end: number) => {
    if (drag && drag.kind === kind && drag.id === id) {
      const s = drag.mode === 'move' ? start + drag.days * DAY : start;
      return { s, e: Math.max(s, end + drag.days * DAY) };
    }
    return { s: start, e: end };
  };

  const openAdd = (p: GanttProject) => {
    const s = Number.isNaN(dayStart(p.startDate)) ? Math.floor(Date.now() / DAY) * DAY : dayStart(p.startDate);
    setDraft({ name: '', startDate: ymd(s), endDate: ymd(s + 6 * DAY) });
    setAdding(p.id);
  };
  const addTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adding) return;
    if (!draft.name.trim()) { toast.error('Give the task a name.'); return; }
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) { toast.error('The end date cannot be before the start date.'); return; }
    setSaving(true);
    try {
      await api.post(`/api/gantt-charts/${adding}/tasks`, { name: draft.name.trim(), startDate: draft.startDate, endDate: draft.endDate });
      setAdding(null);
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add the task'); } finally { setSaving(false); }
  };
  const removeTask = async (t: GanttTask) => {
    if (!(await confirm(`Remove the task "${t.name}"?`, { title: 'Remove task', confirmText: 'Remove' }))) return;
    try { await api.delete(`/api/gantt-charts/tasks/${t.id}`); load(); } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not remove the task'); }
  };

  if (loading) return <PageLoading what="the schedules for your projects" />;

  if (projects.length === 0) {
    return <div className="p-12 text-center"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><div className="text-gray-500 dark:text-slate-400">No projects to display. Create a project to see it on the Gantt chart.</div></div>;
  }

  const rowHeight = 44;

  // Month headers along the top. The full year, never two digits: "Oct 26 / Nov 26" read as days of the month
  // (contractor re-test 2026-10-22). "Oct 2026" cannot be a date.
  const months: { label: string; offsetPct: number }[] = [];
  const first = new Date(minDate);
  first.setUTCDate(1);
  for (let d = new Date(first); d.getTime() <= maxDate; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const offsetPct = Math.max(0, ((d.getTime() - minDate) / totalSpan) * 100);
    months.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), offsetPct });
  }
  const pct = (t: number) => ((t - minDate) / totalSpan) * 100;
  const grid = months.map((m, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-slate-800" style={{ left: `${m.offsetPct}%` }} />);

  const barBox = (kind: Drag['kind'], id: string, start: number, end: number, color: string, label: string, done: number) => {
    const { s, e } = placed(kind, id, start, end);
    const leftPct = pct(s);
    const widthPct = Math.max(((e + DAY - s) / totalSpan) * 100, 1);
    return (
      <div
        className={`absolute top-2 bottom-2 rounded-md flex items-center px-2 text-white text-xs font-medium overflow-hidden select-none ${mayPlan ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, minWidth: '40px' }}
        onPointerDown={(ev) => beginDrag(ev, kind, id, 'move', start, end)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        title={mayPlan ? `${label}: drag to move, drag the right edge to change the end date` : label}
      >
        {/* Percent complete — DARKENS the bar rather than washing it out (see the colour note above). */}
        <div className="absolute top-0 bottom-0 left-0 bg-black/20" style={{ width: `${done || 0}%` }} />
        <span className="relative z-10 truncate">{label}</span>
        {mayPlan && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize bg-black/30"
            onPointerDown={(ev) => beginDrag(ev, kind, id, 'end', start, end)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          />
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-full mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-orange-500 dark:text-orange-200" />Gantt Chart</h1>
        <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
          Timeline view of all projects — {projects.length} projects over {totalDays} days
          {mayPlan ? '. Drag a bar to move it; drag its right edge to change when it ends.' : ''}
        </p>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
        {/* Timeline header */}
        <div className="flex border-b bg-gray-50 dark:bg-slate-900 dark:border-slate-700">
          <div className="w-64 flex-shrink-0 px-4 py-3 border-r font-semibold text-xs uppercase text-gray-500 dark:text-slate-400 dark:border-slate-700">Project / task</div>
          <div ref={trackRef} className="flex-1 relative h-10" style={{ minWidth: '800px' }}>
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 h-full flex items-center text-xs text-gray-500 border-l border-gray-200 pl-2 dark:text-slate-400 dark:border-slate-700" style={{ left: `${m.offsetPct}%` }}>{m.label}</div>
            ))}
          </div>
        </div>

        {projects.map((p) => {
          const pStart = dayStart(p.startDate);
          const pEnd = dayStart(p.endDate);
          return (
            <div key={p.id}>
              <div className="flex border-b hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700" style={{ height: rowHeight }}>
                <div className="w-64 flex-shrink-0 px-4 py-2 border-r flex items-center justify-between gap-2 dark:border-slate-700">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{p.status.replace('_', ' ')} · {Math.round(p.percentComplete || 0)}%</div>
                  </div>
                  {mayPlan && (
                    <button type="button" onClick={() => openAdd(p)} className="shrink-0 inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700" aria-label={`Add a task to ${p.name}`}>
                      <Plus className="w-3 h-3" />Task
                    </button>
                  )}
                </div>
                <div className="flex-1 relative" style={{ minWidth: '800px' }}>
                  {grid}
                  {!Number.isNaN(pStart) && !Number.isNaN(pEnd) && barBox('project', p.id, pStart, pEnd, STATUS_COLORS[p.status] || '#475569', p.name, p.percentComplete)}
                </div>
              </div>

              {(p.tasks || []).map((t) => {
                const tStart = dayStart(t.startDate);
                const tEnd = dayStart(t.endDate);
                return (
                  <div key={t.id} className="flex border-b hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700" style={{ height: rowHeight - 6 }}>
                    <div className="w-64 flex-shrink-0 pl-8 pr-4 py-2 border-r flex items-center justify-between gap-2 dark:border-slate-700">
                      <div className="text-sm truncate text-gray-700 dark:text-slate-200">{t.name}</div>
                      {mayPlan && (
                        <button type="button" onClick={() => removeTask(t)} className="shrink-0 p-1 rounded text-gray-500 hover:text-red-700 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-300 dark:hover:bg-red-950/40" aria-label={`Remove ${t.name}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex-1 relative" style={{ minWidth: '800px' }}>
                      {grid}
                      {!Number.isNaN(tStart) && !Number.isNaN(tEnd) && barBox('task', t.id, tStart, tEnd, TASK_COLOR, t.name, t.progress)}
                    </div>
                  </div>
                );
              })}

              {adding === p.id && (
                <form onSubmit={addTask} className="flex flex-wrap items-end gap-3 border-b bg-gray-50 px-4 py-3 dark:bg-slate-800 dark:border-slate-700">
                  <div>
                    <label htmlFor={`task-name-${p.id}`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-slate-200">Task</label>
                    <input id={`task-name-${p.id}`} autoFocus required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="px-3 py-1.5 border rounded-lg text-sm bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600" placeholder="e.g., Framing" />
                  </div>
                  <div>
                    <label htmlFor={`task-start-${p.id}`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-slate-200">Starts</label>
                    <input id={`task-start-${p.id}`} type="date" required value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="px-3 py-1.5 border rounded-lg text-sm bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600" />
                  </div>
                  <div>
                    <label htmlFor={`task-end-${p.id}`} className="block text-xs font-medium text-gray-700 mb-1 dark:text-slate-200">Ends</label>
                    <input id={`task-end-${p.id}`} type="date" required value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="px-3 py-1.5 border rounded-lg text-sm bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600" />
                  </div>
                  <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-lg text-sm bg-orange-700 text-white hover:bg-orange-800 disabled:opacity-50">{saving ? 'Adding…' : 'Add task'}</button>
                  <button type="button" onClick={() => setAdding(null)} className="px-4 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Cancel</button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
        <span>Legend:</span>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ background: color }} /><span>{status.replace('_', ' ')}</span></div>
        ))}
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ background: TASK_COLOR }} /><span>task</span></div>
      </div>
    </div>
  );
}
