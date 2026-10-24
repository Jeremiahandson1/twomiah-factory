// Moved from templates/crm-fieldservice/frontend/src/pages/fieldservice/DispatchBoard.tsx.
//
// THE DISPATCH BOARD, BY PERSON (2026-10-24 — the way Jobber, Housecall Pro and ServiceTitan lay a day out):
//   · a lane per technician, and "Unassigned" first: a job sits in the lane of everyone on it (its lead and the others);
//   · drag a job from one lane to another — or, on a phone, tap Move and then a lane — to change who is on it
//     (PUT /api/jobs/:id; the server's double-booking and travel-time checks answer, and a travel warning may be booked
//     past, never with a browser pop-up);
//   · the board refreshes itself when any job changes (the live-updates channel, live.ts), and every minute while that
//     channel is down;
//   · a map of the day's jobs, pinned in each lane's colour, on Google's licensed tiles (tenant-ui maps/tiles.ts);
//   · "Optimise route" on a lane: that person's day in the best order (tenant-ui schedule/crew.tsx RouteOptimiser).
// The status tiles still add up to the day's total (T48), and a cancelled job is off the board.
import { useState, useEffect, useRef, useCallback, type DragEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ClipboardList, Calendar, Clock, MapPin, User, Users,
  AlertTriangle, Play, CheckCircle, Loader2, ChevronLeft,
  ChevronRight, Wrench, Zap, Shield, Settings2, RefreshCw, Move, X, Route, Map as MapIcon,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../../api'
// The day on the wall behind the dispatcher, not the day in UTC. (Evergreen BUG-28)
import { todayKey, dayKeyPlus, useKnownPermission, useMayWrite } from '../../../shared'
import { useToast, useAuth } from '../../../shared'
import { useLiveEvent, useLiveConnected } from '../../../live'
import { verticalScreens } from '../../vertical'
import { ConfirmModal } from '@twomiah/tenant-ui/src/invoicing/ui'
import { addMapTiles } from '@twomiah/tenant-ui/src/maps/tiles'
import { useMapCenter, US_VIEW, HOME_ZOOM } from '@twomiah/tenant-ui/src/maps/center'
import { UNASSIGNED, crewOf, crewIdsOf, lanesFor, laneMoveBody, isTravelWarning, personName, RouteOptimiser, type Lane } from '@twomiah/tenant-ui/src/schedule/crew'

// What this vertical calls a job (VerticalSettings.screens.jobs.labels): 'Service Call' in field service, 'Job' in
// landscaping (its copy of this board said "Job started", "Unnamed job" — T41).
const JOB_WORD: string = verticalScreens().jobs.labels?.singular || 'Service Call'

// The job's priorities are the server's (tenant-backend jobs.ts JOB_PRIORITIES): low, normal, high, urgent. The
// template keyed the red card on 'emergency', which the server never stores — an urgent call got no colour at all.
type Priority = 'urgent' | 'high' | 'normal' | 'low';
const isPriority = (p: unknown): p is Priority => p === 'urgent' || p === 'high' || p === 'normal' || p === 'low';

const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: 'border-l-4 border-l-red-500 bg-red-50',
  high: 'border-l-4 border-l-amber-500 bg-amber-50',
  normal: 'border-l-4 border-l-blue-500 bg-blue-50',
  low: 'border-l-4 border-l-gray-400 bg-gray-50',
};

const PRIORITY_BADGES: Record<Priority, string> = {
  urgent: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
  high: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  normal: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  low: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  install: Settings2,
  repair: Wrench,
  maintenance: Shield,
  emergency: Zap,
};

/** A lane's colour, on its header dot and its map pins. Unassigned is grey. */
const LANE_COLOURS = ['#2563eb', '#16a34a', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#0d9488', '#c2410c']
const UNASSIGNED_COLOUR = '#6b7280'

/** The person on a job, as GET /api/jobs joins it: a login user or a roster member, one shape (jobs.ts withRelations). */
interface JobAssignee {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  kind?: 'user' | 'member';
  lead?: boolean;
}

/** A row of GET /api/jobs?date= — the fields this board reads. */
interface DispatchJob {
  id: string;
  number?: string | null;
  title?: string | null;
  status: string;
  priority?: string | null;
  type?: string | null;
  serviceAgreementId?: string | null;
  address?: string | null;
  scheduledTime?: string | null;
  lat?: number | null;
  lng?: number | null;
  assignedToId?: string | null;
  assignedToMemberId?: string | null;
  assignedTo?: JobAssignee | null;
  assignees?: JobAssignee[];
  // The list joins the contact as { id, name } only.
  contact?: { id: string; name?: string | null } | null;
}

/** A row of GET /api/team/assignable. */
interface Tech {
  id: string;
  name: string;
  role?: string | null;
  kind: 'user' | 'member';
}

const minutesOf = (t?: string | null) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER }
const byTime = (a: DispatchJob, b: DispatchJob) => minutesOf(a.scheduledTime) - minutesOf(b.scheduledTime)

/**
 * Dispatch Board — a day of jobs by technician
 */
export default function DispatchBoard() {
  const toast = useToast();
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  // The technician list is team:read. A seat without it is not asked for it — it would only be refused. (T63)
  // null until the permission list arrives — the request waits for a real yes (T64)
  const maySeeRoster = useKnownPermission('team:read');
  // Moving work between people, starting and completing it are all PUT /api/jobs/:id — jobs:update (T43, T68).
  const mayUpdate = useMayWrite('jobs:update');
  // Routing someone else's day reads their jobs: jobs:read-all (server/crm/field/dayRoute.ts).
  const mayReadAll = useMayWrite('jobs:read-all');
  const { user } = useAuth();
  const meId = (user as any)?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  // The job being dragged, in a ref: the drop reads it in the same tick the drag began, before any re-render.
  const dragging = useRef<{ job: DispatchJob; from: string } | null>(null);
  const [moving, setMoving] = useState<{ job: DispatchJob; from: string } | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [override, setOverride] = useState<{ job: DispatchJob; body: Record<string, unknown>; said: string; message: string } | null>(null);
  const [routeFor, setRouteFor] = useState<Lane | null>(null);
  const [showMap, setShowMap] = useState(true);

  // The spinner is for a new day only: a reload of the day showing (the roster arriving once the permissions are known,
  // a live update) swaps the data in place, so a card being dragged is never pulled out from under the pointer.
  const shownDate = useRef<string | null>(null);
  const loadData = useCallback(async (quietAsked = false) => {
    const quiet = quietAsked || shownDate.current === selectedDate;
    shownDate.current = selectedDate;
    if (!quiet) setLoading(true);
    try {
      // SETTLED, not all: the technician list is team:read, which a technician does not hold, and one refused
      // request emptied the whole board — staff opened Dispatch to a blank day. The day's work is the board; the
      // roster is the dispatcher's. (T62: "the Dispatch board is empty for staff, because one 403 breaks the page")
      const [jobsOut, techsOut] = await Promise.allSettled([
        api.get(`/api/jobs?date=${selectedDate}&limit=200`),
        // /assignable, NOT /api/team: GET /api/team ignores ?role, and roster-only crew are only on /assignable. (T42)
        maySeeRoster ? api.get('/api/team/assignable') : Promise.resolve({ data: [] }),
      ]);
      if (jobsOut.status === 'rejected') throw jobsOut.reason;
      const jobsRes = jobsOut.value as { data?: DispatchJob[] };
      const techsRes = (techsOut.status === 'fulfilled' ? techsOut.value : { data: [] }) as { data?: Tech[] };
      setJobs(Array.isArray(jobsRes?.data) ? jobsRes.data : []);
      setTechs(Array.isArray(techsRes?.data) ? techsRes.data : []);
    } catch (error) {
      console.error('Failed to load dispatch data:', error);
      if (!quiet) toast.error('Failed to load dispatch board');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [selectedDate, maySeeRoster]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadData(); }, [loadData]);

  // LIVE: any job made, changed or removed anywhere (another dispatcher, a tech's phone, the Schedule) reloads the board,
  // quietly. While the live channel is down, every minute instead.
  const live = useLiveConnected();
  const reloadSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onJobEvent = () => {
    if (reloadSoon.current) clearTimeout(reloadSoon.current);
    reloadSoon.current = setTimeout(() => { void loadData(true); }, 400);
  };
  useLiveEvent('job:created', onJobEvent);
  useLiveEvent('job:updated', onJobEvent);
  useLiveEvent('job:deleted', onJobEvent);
  useLiveEvent('job:statusChanged', onJobEvent);
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => { void loadData(true); }, 60_000);
    return () => clearInterval(t);
  }, [live, loadData]);
  useEffect(() => () => { if (reloadSoon.current) clearTimeout(reloadSoon.current); }, []);

  /**
   * THE TILES MUST ACCOUNT FOR EVERY JOB ON THE DAY. (T48: "one job missing, no Scheduled column")
   * A PARTITION: completed, else in progress, else assigned (Scheduled), else not (Unassigned) — whatever the status.
   * A CANCELLED job is not work on the day — it is off the board altogether, so the tiles add up to the total.
   */
  const onBoard = jobs.filter(j => j.status !== 'cancelled');
  const completed = onBoard.filter(j => j.status === 'completed');
  const inProgress = onBoard.filter(j => j.status === 'in_progress');
  const scheduled = onBoard.filter(j => j.status !== 'completed' && j.status !== 'in_progress' && crewIdsOf(j).length > 0);
  const unassigned = onBoard.filter(j => j.status !== 'completed' && j.status !== 'in_progress' && crewIdsOf(j).length === 0);

  // The lanes: Unassigned, then the roster (its order), then anyone a job names who is not on it (a seat without
  // team:read sees the people its own jobs name).
  const lanes: Lane[] = [{ id: UNASSIGNED, name: 'Unassigned' }, ...lanesFor(techs.map(t => ({ id: t.id, name: t.name })), onBoard)];
  const colourOf = (laneId: string) => laneId === UNASSIGNED ? UNASSIGNED_COLOUR : LANE_COLOURS[(lanes.findIndex(l => l.id === laneId) - 1 + LANE_COLOURS.length) % LANE_COLOURS.length];
  const jobsIn = (laneId: string) => onBoard.filter(j => laneId === UNASSIGNED ? crewIdsOf(j).length === 0 : crewIdsOf(j).includes(laneId)).sort(byTime);
  const laneName = (laneId: string) => lanes.find(l => l.id === laneId)?.name || 'Unassigned';

  const put = async (job: DispatchJob, body: Record<string, unknown>, said: string) => {
    try {
      await api.put(`/api/jobs/${job.id}`, body);
      toast.success(said);
    } catch (error) {
      if (isTravelWarning(error)) setOverride({ job, body, said, message: error instanceof Error ? error.message : 'There is not enough time to get there.' });
      else toast.error(error instanceof Error && error.message ? error.message : 'Failed to update the job');
    }
    void loadData(true);
  };
  const bookAnyway = async () => {
    const o = override; setOverride(null);
    if (!o) return;
    try { await api.put(`/api/jobs/${o.job.id}`, { ...o.body, bookAnyway: true }); toast.success(o.said); }
    catch (error) { toast.error(error instanceof Error && error.message ? error.message : 'Failed to update the job'); }
    void loadData(true);
  };

  /**
   * A job moved to another lane: the person it left comes off, the person it reached goes on (crew.tsx laneMoveBody).
   * A job nobody had that was still `pending` becomes `scheduled` once someone is on it; work already dispatched, in
   * progress, confirmed or on hold keeps where it stands — only who changes.
   */
  const moveTo = async (to: string) => {
    const picked = dragging.current || moving;
    dragging.current = null; setMoving(null); setOverLane(null);
    if (!picked) return;
    const body: Record<string, unknown> | null = laneMoveBody(picked.job, picked.from, to);
    if (!body) return;
    if (crewIdsOf(picked.job).length === 0 && picked.job.status === 'pending') body.status = 'scheduled';
    setJobs(prev => prev.map(j => j.id === picked.job.id ? { ...j, assignees: (body.assignedToId ? [String(body.assignedToId), ...(body.otherAssigneeIds as string[])] : []).map((id, i) => ({ id, name: laneName(id), lead: i === 0 })) } : j));
    await put(picked.job, body, to === UNASSIGNED ? `Taken off ${laneName(picked.from)}'s day` : `Moved to ${laneName(to)}`);
  };
  const laneDrop = (laneId: string) => mayUpdate ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverLane(laneId); },
    onDragLeave: () => { if (overLane === laneId) setOverLane(null); },
    onDrop: (e: DragEvent) => { e.preventDefault(); void moveTo(laneId); },
    ...(moving ? { onClick: () => { void moveTo(laneId); }, 'data-move-target': laneId } : {}),
  } : {};

  const handleStatusChange = async (job: DispatchJob, status: 'in_progress' | 'completed') => {
    await put(job, { status }, `${JOB_WORD} ${status === 'in_progress' ? 'started' : 'completed'}`);
  };

  const navigateDate = (direction: number) => {
    // Stepped on the calendar from noon (dayKeyPlus), so a spring-forward day cannot land in the missing hour.
    setSelectedDate(dayKeyPlus(selectedDate, direction));
  };

  const isToday = selectedDate === todayKey();

  const dateDisplay = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const mayRoute = (laneId: string) => laneId !== UNASSIGNED && (mayReadAll || (!!meId && laneId === meId));
  const unmapped = onBoard.filter(j => j.lat == null || j.lng == null);

  return (
    <div className="space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dispatch Board</h1>
          <p className="text-gray-600 dark:text-slate-400">{dateDisplay}</p>
          {mayUpdate && <p className="text-sm text-gray-600 dark:text-slate-400">Drag a {JOB_WORD.toLowerCase()} to a person's lane — or tap Move, then a lane — to change who is on it.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button aria-label="Previous day"
            onClick={() => navigateDate(-1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input
            type="date"
            aria-label="Day"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
          />
          <button aria-label="Next day"
            onClick={() => navigateDate(1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isToday && (
            <button
              onClick={() => setSelectedDate(todayKey())}
              className="px-3 py-2 text-sm text-orange-700 dark:text-orange-200 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-lg"
            >
              Today
            </button>
          )}
          <button type="button" aria-pressed={showMap} onClick={() => setShowMap(v => !v)} data-testid="toggle-map"
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border ${showMap ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
            <MapIcon className="w-4 h-4" />Map
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard icon={ClipboardList} label="Total Jobs" value={onBoard.length} />
        <StatCard icon={AlertTriangle} label="Unassigned" value={unassigned.length} color="orange" />
        <StatCard icon={Calendar} label="Scheduled" value={scheduled.length} color="indigo" />
        <StatCard icon={Play} label="In Progress" value={inProgress.length} color="blue" />
        <StatCard icon={CheckCircle} label="Completed" value={completed.length} color="green" />
      </div>

      {moving && (
        <div role="status" data-testid="move-banner" className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900 shadow-sm dark:border-orange-500/50 dark:bg-orange-950/60 dark:text-orange-100">
          <span className="min-w-0"><span className="font-semibold">Moving “{moving.job.contact?.name || moving.job.title}”</span> — tap a person's lane to put it there.</span>
          <button type="button" onClick={() => setMoving(null)} className="shrink-0 inline-flex items-center gap-1 rounded border border-orange-300 px-2 py-1 text-orange-900 hover:bg-orange-100 dark:border-orange-500/50 dark:text-orange-100 dark:hover:bg-orange-900/40"><X className="w-3.5 h-3.5" />Cancel</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className={`grid gap-6 ${showMap ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
          {/* Lanes: one per person, wrapping onto as many rows as they need, so every lane is a place to drop on
              without scrolling sideways (a phone stacks them). */}
          <div className="min-w-0" data-testid="dispatch-lanes">
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
              {lanes.map(lane => {
                const here = jobsIn(lane.id);
                return (
                  <section key={lane.id || 'unassigned'} data-lane={lane.id} aria-label={lane.name} {...laneDrop(lane.id)}
                    className={`min-w-0 rounded-xl border p-3 transition ${overLane === lane.id ? 'border-orange-400 ring-2 ring-orange-400 bg-orange-50/50 dark:bg-orange-950/30' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'} ${moving ? 'cursor-pointer' : ''}`}>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-slate-700">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colourOf(lane.id) }} />
                      {lane.id === UNASSIGNED ? <AlertTriangle className="w-4 h-4 text-orange-700 dark:text-orange-300" /> : <User className="w-4 h-4 text-gray-600 dark:text-slate-300" />}
                      <h2 className="font-semibold text-gray-900 dark:text-white truncate">{lane.name}</h2>
                      <span className="ml-auto text-sm text-gray-600 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full dark:text-slate-300">{here.length}</span>
                    </div>
                    {mayRoute(lane.id) && here.filter(j => j.status !== 'completed').length > 1 && (
                      <button type="button" data-route-lane={lane.id} onClick={(e) => { e.stopPropagation(); setRouteFor(lane); }}
                        className="mb-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Route className="w-3.5 h-3.5" />Optimise route
                      </button>
                    )}
                    <div className="space-y-3 min-h-[80px]">
                      {here.map(job => (
                        <DispatchCard
                          key={job.id}
                          job={job}
                          lane={lane.id}
                          mayUpdate={mayUpdate}
                          moving={moving?.job.id === job.id}
                          picking={!!moving}
                          onDragStart={() => { dragging.current = { job, from: lane.id }; }}
                          onDragEnd={() => { dragging.current = null; setOverLane(null); }}
                          onMove={() => setMoving({ job, from: lane.id })}
                          onStatusChange={handleStatusChange}
                        />
                      ))}
                      {here.length === 0 && (
                        <div className="text-center py-6 text-gray-600 dark:text-slate-400 text-sm">
                          {lane.id === UNASSIGNED ? 'Nothing waiting for a person' : mayUpdate ? 'Drop work here' : 'Nothing on this day'}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          {showMap && (
            <div className="min-w-0 space-y-2">
              <DispatchMap jobs={onBoard} colourOf={(j) => colourOf(crewIdsOf(j)[0] ?? UNASSIGNED)} laneOf={(j) => crewOf(j).map(p => personName(p)).join(', ') || 'Unassigned'} />
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700 dark:text-slate-300">
                {lanes.map(l => <span key={l.id || 'unassigned'} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: colourOf(l.id) }} />{l.name}</span>)}
              </div>
              {unmapped.length > 0 && (
                <p className="text-xs text-gray-600 dark:text-slate-400">
                  {unmapped.length} {unmapped.length === 1 ? 'job is' : 'jobs are'} not on the map yet.{' '}
                  {mayUpdate && <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-300" onClick={async () => {
                    try { const r: any = await api.post('/api/day-route/locate', { date: selectedDate }); toast.success(`${r?.located?.length || 0} put on the map`); void loadData(true); }
                    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not put the jobs on the map'); }
                  }}>Put them on the map</button>}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal isOpen={!!override} onClose={() => setOverride(null)} onConfirm={bookAnyway} danger={false}
        title="Not enough time to get there" message={override?.message || ''} confirmText="Book anyway" />
      {routeFor && <RouteOptimiser api={api as any} toast={toast as any} date={selectedDate} person={routeFor} mayRetime={mayUpdate} mayLocate={mayUpdate}
        onClose={() => setRouteFor(null)} onApplied={() => { setRouteFor(null); void loadData(true); }} />}
    </div>
  );
}

type StatColor = 'gray' | 'orange' | 'blue' | 'green' | 'indigo';

function StatCard({ icon: Icon, label, value, color = 'gray' }: { icon: LucideIcon; label: string; value: number; color?: StatColor }) {
  const colors: Record<StatColor, string> = {
    gray: 'bg-gray-50 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-200',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
    // Added with the Scheduled tile (T48). A colour missing from this map resolves to `undefined`
    // and lands in the className as the literal word, so the tile loses its ground entirely.
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

function DispatchCard({ job, lane, mayUpdate, moving, picking, onDragStart, onDragEnd, onMove, onStatusChange }: {
  job: DispatchJob;
  lane: string;
  mayUpdate: boolean;
  moving: boolean;
  picking: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
  onStatusChange: (job: DispatchJob, status: 'in_progress' | 'completed') => void;
}) {
  const priority: Priority = isPriority(job.priority) ? job.priority : 'normal';
  // A job with no type is not a repair — nobody said it was. (T58)
  const serviceType = job.type || '';
  const ServiceIcon = SERVICE_ICONS[serviceType] || Wrench;
  const crew = crewOf(job);
  const draggable = mayUpdate && job.status !== 'completed';

  return (
    <div data-job-id={job.id} data-lane={lane} draggable={draggable}
      onDragStart={draggable ? (e) => { onDragStart(); try { e.dataTransfer.setData('text/plain', job.id); } catch { /* older engines */ } e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={`rounded-xl p-4 ${PRIORITY_COLORS[priority]} dark:bg-slate-800 dark:border-l-4 ${draggable ? 'cursor-move' : ''} ${moving ? 'ring-2 ring-orange-500' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ServiceIcon className="w-4 h-4 text-gray-600 dark:text-slate-300" />
          {serviceType ? (
            <span className="text-xs font-medium uppercase text-gray-600 dark:text-slate-400">
              {serviceType}
            </span>
          ) : null}
          {job.serviceAgreementId && (
            <span className="flex items-center gap-0.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400 px-1.5 py-0.5 rounded-full" title="Recurring maintenance">
              <RefreshCw className="w-3 h-3" /> Recurring
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGES[priority]}`}>
            {priority}
          </span>
          {draggable && !picking && (
            <button type="button" aria-label={`Move ${job.contact?.name || job.title || JOB_WORD}`} title="Move — then tap a lane" data-move-job={job.id}
              onClick={(e) => { e.stopPropagation(); onMove(); }}
              className="rounded p-1 text-gray-700 hover:bg-white/70 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white">
              <Move className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Customer */}
      <p className="font-semibold text-gray-900 dark:text-white truncate">
        {job.contact?.name || job.title || `Unnamed ${JOB_WORD}`}
      </p>
      {job.status === 'completed' || job.status === 'in_progress' ? (
        <p className="text-xs font-medium text-gray-700 dark:text-slate-300">{job.status === 'completed' ? 'Completed' : 'In progress'}</p>
      ) : null}

      {/* Address */}
      {job.address && (
        <div className="flex items-start gap-1 mt-1">
          <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-600 dark:text-slate-400 line-clamp-2">
            {job.address}
          </p>
        </div>
      )}

      {/* Time — the company's wall clock, as stored */}
      {job.scheduledTime && (
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs text-gray-600 dark:text-slate-400">
            {job.scheduledTime}
          </p>
        </div>
      )}

      {/* Everyone on it, when it is more than one person */}
      {crew.length > 1 && (
        <div className="flex items-start gap-1 mt-2">
          <Users className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300">{crew.map(p => `${personName(p)}${p.lead ? ' (lead)' : ''}`).join(', ')}</p>
        </div>
      )}

      {/* Status buttons */}
      {mayUpdate && job.status !== 'completed' && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700 flex gap-2">
          {job.status !== 'in_progress' && crew.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange(job, 'in_progress'); }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange(job, 'completed'); }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-green-700 text-white rounded-lg hover:bg-green-800"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Complete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The day's jobs as pins in their lane's colour, on Google's licensed tiles (tenant-ui maps/tiles.ts). */
function DispatchMap({ jobs, colourOf, laneOf }: { jobs: DispatchJob[]; colourOf: (j: DispatchJob) => string; laneOf: (j: DispatchJob) => string }) {
  // With no pin to frame, the map opens on the business's town, not the whole country (maps/center.ts).
  const home = useMapCenter((p: string) => api.get(p));
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const pinned = jobs.filter(j => j.lat != null && j.lng != null && Number.isFinite(Number(j.lat)) && Number.isFinite(Number(j.lng)));

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true }).setView(US_VIEW.center, US_VIEW.zoom);
    addMapTiles(L, map, 'roadmap');
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const j of pinned) {
      const at: [number, number] = [Number(j.lat), Number(j.lng)];
      pts.push(at);
      const tip = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = j.contact?.name || j.title || JOB_WORD; tip.appendChild(title);
      const line = document.createElement('div'); line.textContent = [j.scheduledTime, laneOf(j)].filter(Boolean).join(' · '); tip.appendChild(line);
      if (j.address) { const a = document.createElement('div'); a.textContent = j.address; tip.appendChild(a); }
      L.circleMarker(at, { radius: 9, color: '#ffffff', weight: 2, fillColor: colourOf(j), fillOpacity: 0.95 }).bindPopup(tip).addTo(layer);
    }
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
    else if (home) map.setView([home.lat, home.lng], HOME_ZOOM);
  }, [jobs, home]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} data-testid="dispatch-map" className="h-80 xl:h-[32rem] w-full rounded-xl border border-gray-200 dark:border-slate-700 z-0" />;
}
