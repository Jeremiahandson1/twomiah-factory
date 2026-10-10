/**
 * Gantt Charts Page — Construction tier
 * Timeline view of all projects. Pure derived projection of existing project
 * data — no new state, just a visualization.
 */
import { useState, useEffect } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import api from '../services/api';

interface GanttProject {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  percentComplete: number;
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
 * The legend swatches read these too, so the two cannot drift apart.
 */
const STATUS_COLORS: Record<string, string> = {
  planning: '#475569',
  active: '#1d4ed8',
  on_hold: '#b45309',
  completed: '#047857',
  cancelled: '#b91c1c',
};

export default function GanttChartsPage() {
  const [projects, setProjects] = useState<GanttProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/gantt-charts').then(({ data }) => { setProjects(data || []); setLoading(false); }).catch((e) => { console.error(e); setLoading(false); });
  }, []);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500 dark:text-orange-300" /></div>;

  if (projects.length === 0) {
    return <div className="p-12 text-center"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><div className="text-gray-500 dark:text-slate-400">No projects to display. Create a project to see it on the Gantt chart.</div></div>;
  }

  // Compute the overall timeline range
  const allDates = projects.flatMap((p) => [new Date(p.startDate).getTime(), new Date(p.endDate).getTime()]);
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const totalSpan = Math.max(maxDate - minDate, 86400000); // at least 1 day

  const msPerDay = 86400000;
  const totalDays = Math.ceil(totalSpan / msPerDay);
  const rowHeight = 44;

  // Generate month headers along the top
  const months: { label: string; offsetPct: number }[] = [];
  const start = new Date(minDate);
  start.setDate(1);
  for (let d = new Date(start); d.getTime() <= maxDate; d.setMonth(d.getMonth() + 1)) {
    const offsetPct = ((d.getTime() - minDate) / totalSpan) * 100;
    months.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), offsetPct });
  }

  return (
    <div className="p-6 max-w-full mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-orange-500 dark:text-orange-300" />Gantt Chart</h1>
        <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Timeline view of all projects — {projects.length} projects over {totalDays} days</p>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto dark:bg-slate-900">
        {/* Timeline header */}
        <div className="flex border-b bg-gray-50 dark:bg-slate-900">
          <div className="w-64 flex-shrink-0 px-4 py-3 border-r font-semibold text-xs uppercase text-gray-500 dark:text-slate-400">Project</div>
          <div className="flex-1 relative h-10" style={{ minWidth: '800px' }}>
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 h-full flex items-center text-xs text-gray-500 border-l border-gray-200 pl-2 dark:text-slate-400 dark:border-slate-700" style={{ left: `${m.offsetPct}%` }}>{m.label}</div>
            ))}
          </div>
        </div>

        {/* Project rows */}
        {projects.map((p) => {
          const pStart = new Date(p.startDate).getTime();
          const pEnd = new Date(p.endDate).getTime();
          const leftPct = ((pStart - minDate) / totalSpan) * 100;
          const widthPct = Math.max(((pEnd - pStart) / totalSpan) * 100, 1);
          const color = STATUS_COLORS[p.status] || '#94a3b8';

          return (
            // hover:bg-gray-50 dark:hover:bg-slate-800 had no dark partner, so hovering a row in dark mode painted a
            // near-white ground under light text and the row went blank under the cursor.
            <div key={p.id} className="flex border-b hover:bg-gray-50 dark:hover:bg-slate-800" style={{ height: rowHeight }}>
              <div className="w-64 flex-shrink-0 px-4 py-3 border-r">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{p.status.replace('_', ' ')} · {Math.round(p.percentComplete || 0)}%</div>
              </div>
              <div className="flex-1 relative" style={{ minWidth: '800px' }}>
                {/* Month grid lines */}
                {months.map((m, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: `${m.offsetPct}%` }} />)}
                {/* Bar */}
                <div className="absolute top-2 bottom-2 rounded-md flex items-center px-2 text-white text-xs font-medium overflow-hidden" style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, minWidth: '40px' }}>
                  {/*
                    Percent complete — DARKENS the bar rather than washing it out.
                    `bg-white/25` lightened the ground under the first part of the label, which is
                    the part anyone actually reads, and took amber down to 3.23:1 even on the new
                    palette. A translucent black deepens it instead (amber 6.41:1), and reads as
                    "this much is done" just as well.

                    The old rule also carried `dark:bg-slate-900` — OPAQUE — so in dark mode the
                    completed portion was a solid near-black block and the status colour vanished
                    from it entirely. One translucent layer now, the same in both themes, over a
                    ground this component paints itself.
                  */}
                  <div className="absolute top-0 bottom-0 left-0 bg-black/20" style={{ width: `${p.percentComplete || 0}%` }} />
                  <span className="relative z-10 truncate">{p.name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
        <span>Legend:</span>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ background: color }} /><span>{status.replace('_', ' ')}</span></div>
        ))}
      </div>
    </div>
  );
}
