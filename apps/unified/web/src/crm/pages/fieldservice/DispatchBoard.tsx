// Moved from templates/crm-fieldservice/frontend/src/pages/fieldservice/DispatchBoard.tsx.
import { useState, useEffect } from 'react'
import {
  ClipboardList, Calendar, Clock, MapPin, User, Users,
  AlertTriangle, Play, CheckCircle, Loader2, ChevronLeft,
  ChevronRight, Wrench, Zap, Shield, Settings2, RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../../api'
// The day on the wall behind the dispatcher, not the day in UTC. (Evergreen BUG-28)
import { todayKey, dayKeyPlus, useKnownPermission, useMayWrite } from '../../../shared'
import { useToast } from '../../../shared'
import { verticalScreens } from '../../vertical'

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

/** The person on a job, as GET /api/jobs joins it: a login user or a roster member, one shape (jobs.ts withRelations). */
interface JobAssignee {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  kind?: 'user' | 'member';
}

/** A row of GET /api/jobs?date= — the fields this board reads. */
interface DispatchJob {
  id: string;
  title?: string | null;
  status: string;
  priority?: string | null;
  type?: string | null;
  serviceAgreementId?: string | null;
  address?: string | null;
  scheduledTime?: string | null;
  assignedToId?: string | null;
  assignedToMemberId?: string | null;
  assignedTo?: JobAssignee | null;
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

/** The id of whoever is on the job, whichever kind they are. */
const assigneeOf = (j: DispatchJob): string | null => j.assignedToId || j.assignedToMemberId || j.assignedTo?.id || null;

/**
 * Dispatch Board — Today's service call scheduling and assignment
 */
export default function DispatchBoard() {
  const toast = useToast();
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  // The technician list is team:read. A seat without it is not asked for it — it would only be refused. (T63)
  // null until the permission list arrives — the request waits for a real yes (T64)
  const maySeeRoster = useKnownPermission('team:read');
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayKey());

  useEffect(() => {
    loadData();
  }, [selectedDate, maySeeRoster]);

  const loadData = async () => {
    setLoading(true);
    try {
      // SETTLED, not all: the technician list is team:read, which a technician does not hold, and one refused
      // request emptied the whole board — staff opened Dispatch to a blank day. The day's work is the board; the
      // picker is the dispatcher's. (T62: "the Dispatch board is empty for staff, because one 403 breaks the page")
      const [jobsOut, techsOut] = await Promise.allSettled([
        api.get(`/api/jobs?date=${selectedDate}&limit=200`),
        // /assignable, NOT /api/team — team.ts says so three lines above that endpoint: "Pickers
        // must read this, never GET /." GET /api/team ignores ?role entirely (it honours page,
        // limit, active, department and search), so this board listed everybody including the
        // read-only viewer, while roster-only crew — whom /assignable has included since T21 M12 —
        // were being looked for in the wrong place. One line, both halves of the finding. (T42)
        maySeeRoster ? api.get('/api/team/assignable') : Promise.resolve({ data: [] }),
      ]);
      if (jobsOut.status === 'rejected') throw jobsOut.reason;
      // Both answer { data } — the jobs list with its pagination, /assignable without.
      const jobsRes = jobsOut.value as { data?: DispatchJob[] };
      const techsRes = (techsOut.status === 'fulfilled' ? techsOut.value : { data: [] }) as { data?: Tech[] };
      setJobs(Array.isArray(jobsRes?.data) ? jobsRes.data : []);
      setTechs(Array.isArray(techsRes?.data) ? techsRes.data : []);
    } catch (error) {
      console.error('Failed to load dispatch data:', error);
      toast.error('Failed to load dispatch board');
    } finally {
      setLoading(false);
    }
  };

  /**
   * THE FOUR COLUMNS MUST ACCOUNT FOR EVERY JOB ON THE DAY. (T48: "one job missing, no Scheduled column")
   *
   * There were three buckets — unassigned, in_progress, completed — and a job that had been ASSIGNED
   * and was still `scheduled` matched none of them. It was on the board's data and off its screen.
   * Measured on fstest: 1 job invisible on 05/10 and 3 on 06/10, every one of them dispatched work
   * sitting in the normal state dispatched work sits in. The owner's two findings are one hole.
   *
   * So `scheduled` is now its own column, and the rule is a PARTITION rather than three guesses:
   * completed, else in progress, else assigned, else not. Anything with a status nobody here
   * anticipated — on_hold, dispatched, a status a later round adds — lands in Scheduled if it has an
   * assignee and in Unassigned if it does not, instead of disappearing. A board that silently drops
   * work is worse than one with an ugly column.
   *
   * `assignedTo` is the joined USER OBJECT and `assignedToId` is the id; the API returns both. Read
   * through one helper (assigneeOf, above) so the two can never drift — testing the object happened
   * to work and reads like a mistake.
   */
  // A CANCELLED job is not work on the day — it is off the board altogether. The partition above left it to the
  // catch-all, so a cancelled call sat in Scheduled or Unassigned waiting for a tech. Every column and the Total
  // tile read `onBoard`, so the tiles still add up to the total.
  const onBoard = jobs.filter(j => j.status !== 'cancelled');
  const completed = onBoard.filter(j => j.status === 'completed');
  const inProgress = onBoard.filter(j => j.status === 'in_progress');
  const scheduled = onBoard.filter(j => j.status !== 'completed' && j.status !== 'in_progress' && !!assigneeOf(j));
  const unassigned = onBoard.filter(j => j.status !== 'completed' && j.status !== 'in_progress' && !assigneeOf(j));

  const handleAssign = async (jobId: string, techId: string) => {
    try {
      // assignedToId — the job schema has no `assignedTo` and drops it, so the old body changed the status and
      // assigned nobody. The server takes a login user's or a roster member's id in this field (jobs.ts resolveAssignee).
      // The status moves to `scheduled` only for a job nobody had and that was still `pending` (not yet scheduled).
      // Reassigning work that is dispatched, in progress, confirmed or on hold changes who, not where it stands —
      // this used to send `status: 'scheduled'` every time and knocked a running job back to the start.
      const job = jobs.find(j => j.id === jobId);
      const body: { assignedToId: string; status?: 'scheduled' } = { assignedToId: techId };
      if (job && !assigneeOf(job) && job.status === 'pending') body.status = 'scheduled';
      await api.put(`/api/jobs/${jobId}`, body);
      toast.success('Technician assigned');
      loadData();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Failed to assign technician');
    }
  };

  const handleStatusChange = async (jobId: string, status: 'in_progress' | 'completed') => {
    try {
      await api.put(`/api/jobs/${jobId}`, { status });
      toast.success(`${JOB_WORD} ${status === 'in_progress' ? 'started' : 'completed'}`);
      loadData();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Failed to update job status');
    }
  };

  const navigateDate = (direction: number) => {
    // Stepped on the local calendar. The old version parsed the key as midnight UTC, moved it in local
    // time and read it back in UTC — three clocks, which cancel out on an ordinary day and land in the
    // deleted hour on a spring-forward one. dayKeyPlus steps from local noon instead.
    setSelectedDate(dayKeyPlus(selectedDate, direction));
  };

  const isToday = selectedDate === todayKey();

  const dateDisplay = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dispatch Board</h1>
          <p className="text-gray-600 dark:text-slate-400">{dateDisplay}</p>
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
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard icon={ClipboardList} label="Total Jobs" value={onBoard.length} />
        <StatCard icon={AlertTriangle} label="Unassigned" value={unassigned.length} color="orange" />
        {/* Scheduled is counted too, so the four tiles add up to Total Jobs. They did not before:
            unassigned + in progress + completed left the assigned-but-not-started work out, which is
            how a missing job stayed unnoticed on a page that was showing its own numbers. (T48) */}
        <StatCard icon={Calendar} label="Scheduled" value={scheduled.length} color="indigo" />
        <StatCard icon={Play} label="In Progress" value={inProgress.length} color="blue" />
        <StatCard icon={CheckCircle} label="Completed" value={completed.length} color="green" />
      </div>

      {/* Board Columns */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* Unassigned Column */}
          <div>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Unassigned</h2>
              <span className="ml-auto text-sm text-gray-600 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full dark:text-slate-300">
                {unassigned.length}
              </span>
            </div>
            <div className="space-y-3">
              {unassigned.map(job => (
                <DispatchCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  onAssign={handleAssign}
                  onStatusChange={handleStatusChange}
                />
              ))}
              {unassigned.length === 0 && (
                <div className="text-center py-8 text-gray-600 dark:text-slate-400 text-sm">
                  No unassigned jobs
                </div>
              )}
            </div>
          </div>

          {/* Scheduled Column — assigned work that has not started. Added T48: these jobs were on
              the board's data and on no column, so they were simply absent. */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-indigo-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Scheduled</h2>
              <span className="ml-auto text-sm text-gray-600 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full dark:text-slate-300">
                {scheduled.length}
              </span>
            </div>
            <div className="space-y-3">
              {scheduled.map(job => (
                <DispatchCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  onAssign={handleAssign}
                  onStatusChange={handleStatusChange}
                />
              ))}
              {scheduled.length === 0 && (
                <div className="text-center py-8 text-gray-600 dark:text-slate-400 text-sm">
                  Nothing scheduled yet
                </div>
              )}
            </div>
          </div>

          {/* In Progress Column */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">In Progress</h2>
              <span className="ml-auto text-sm text-gray-600 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full dark:text-slate-300">
                {inProgress.length}
              </span>
            </div>
            <div className="space-y-3">
              {inProgress.map(job => (
                <DispatchCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  onAssign={handleAssign}
                  onStatusChange={handleStatusChange}
                />
              ))}
              {inProgress.length === 0 && (
                <div className="text-center py-8 text-gray-600 dark:text-slate-400 text-sm">
                  No jobs in progress
                </div>
              )}
            </div>
          </div>

          {/* Completed Column */}
          <div>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Completed</h2>
              <span className="ml-auto text-sm text-gray-600 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full dark:text-slate-300">
                {completed.length}
              </span>
            </div>
            <div className="space-y-3">
              {completed.map(job => (
                <DispatchCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  onAssign={handleAssign}
                  onStatusChange={handleStatusChange}
                />
              ))}
              {completed.length === 0 && (
                <div className="text-center py-8 text-gray-600 dark:text-slate-400 text-sm">
                  No completed jobs
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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

function DispatchCard({ job, techs, onAssign, onStatusChange }: {
  job: DispatchJob;
  techs: Tech[];
  onAssign: (jobId: string, techId: string) => void;
  onStatusChange: (jobId: string, status: 'in_progress' | 'completed') => void;
}) {
  // Assigning, starting and completing are all PUT /api/jobs/:id — jobs:update. The picker was shown to anyone who
  // could read the team, which a read-only seat can: "Dispatch assign dropdowns and the job Start/Edit buttons".
  // (T43 viewer round, T68)
  const mayUpdate = useMayWrite('jobs:update');

  const priority: Priority = isPriority(job.priority) ? job.priority : 'normal';
  // A job with no type is not a repair — nobody said it was. The sibling of this line stamped every
  // untyped landscaping job REPAIR; it is the same invented fact here, just a likelier-looking one. (T58)
  const serviceType = job.type || '';
  const ServiceIcon = SERVICE_ICONS[serviceType] || Wrench;
  const assigneeId = assigneeOf(job);

  return (
    <div className={`rounded-xl p-4 ${PRIORITY_COLORS[priority]} dark:bg-slate-800 dark:border-l-4`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
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
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGES[priority]}`}>
          {priority}
        </span>
      </div>

      {/* Customer */}
      <p className="font-semibold text-gray-900 dark:text-white truncate">
        {job.contact?.name || job.title || `Unnamed ${JOB_WORD}`}
      </p>

      {/* Address */}
      {job.address && (
        <div className="flex items-start gap-1 mt-1">
          <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-600 dark:text-slate-400 line-clamp-2">
            {job.address}
          </p>
        </div>
      )}

      {/* Time */}
      {job.scheduledTime && (
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs text-gray-600 dark:text-slate-400">
            {job.scheduledTime}
          </p>
        </div>
      )}

      {/* Assigned Tech — `assignedTo` is the joined person (the template read an `assignedUser` the API never sent,
          so every card said only "Assigned"). */}
      {assigneeId && (
        <div className="flex items-center gap-1 mt-2">
          <User className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
            {job.assignedTo?.name || [job.assignedTo?.firstName, job.assignedTo?.lastName].filter(Boolean).join(' ') || 'Assigned'}
          </p>
        </div>
      )}

      {/* Actions */}
      {mayUpdate && <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
        {/* Assign Dropdown */}
        {/* No list to pick from (this seat may not read the team) → no picker, rather than an empty one. (T62) */}
        {job.status !== 'completed' && techs.length > 0 && (
          <select
            value={assigneeId || ''}
            onChange={(e) => {
              if (e.target.value) onAssign(job.id, e.target.value);
            }}
            className="w-full text-xs px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
          >
            <option value="">Assign technician...</option>
            {techs.map(tech => (
              <option key={tech.id} value={tech.id}>
                {tech.name}
              </option>
            ))}
          </select>
        )}

        {/* Status Buttons */}
        <div className="flex gap-2">
          {job.status !== 'in_progress' && job.status !== 'completed' && assigneeId && (
            <button
              onClick={() => onStatusChange(job.id, 'in_progress')}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={() => onStatusChange(job.id, 'completed')}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-green-700 text-white rounded-lg hover:bg-green-800"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Complete
            </button>
          )}
        </div>
      </div>}
    </div>
  );
}
