import { useEffect, useState } from 'react';
import { Hammer, Loader2, MapPin, CalendarDays, CheckCircle2 } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface SubJob {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  scheduledDate?: string | null;
  scheduledEndDate?: string | null;
  scheduledTime?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  estimatedHours?: string | number | null;
  estimatedValue?: string | number | null;
  completedAt?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

export default function PortalMyJobs() {
  const { fetch: portalFetch } = usePortal();
  const [jobs, setJobs] = useState<SubJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    portalFetch('/my-jobs')
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load jobs:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = async (id: string) => {
    if (!confirm('Mark this job as complete?')) return;
    setBusyId(id);
    try {
      await portalFetch(`/my-jobs/${id}/complete`, { method: 'POST', body: JSON.stringify({}) });
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const active = jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled');
  const done = jobs.filter((j) => j.status === 'completed');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Jobs</h1>
        <p className="text-gray-600">Jobs assigned to you.</p>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Hammer className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No jobs assigned yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <Section title={`Active (${active.length})`}>
              {active.map((j) => (
                <JobCard key={j.id} job={j} busy={busyId === j.id} onComplete={() => handleComplete(j.id)} />
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <Section title={`Completed (${done.length})`}>
              {done.map((j) => (
                <JobCard key={j.id} job={j} busy={false} onComplete={null} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function JobCard({ job, busy, onComplete }: { job: SubJob; busy: boolean; onComplete: (() => void) | null }) {
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-orange-100 rounded-lg shrink-0">
            <Hammer className="w-5 h-5 text-orange-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">
              {job.number} — {job.title}
            </p>
            {job.projectName && (
              <p className="text-sm text-gray-500">
                Project: {job.projectNumber ? `${job.projectNumber} · ` : ''}
                {job.projectName}
              </p>
            )}
            {job.description && <p className="text-sm text-gray-600 mt-1">{job.description}</p>}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
              {job.scheduledDate && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {new Date(job.scheduledDate).toLocaleDateString()}
                  {job.scheduledTime ? ` · ${job.scheduledTime}` : ''}
                </span>
              )}
              {addr && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {addr}
                </span>
              )}
            </div>
            {job.notes && <p className="text-xs text-gray-500 mt-2 italic">{job.notes}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[job.status] || 'bg-gray-100 text-gray-700'}`}>
            {job.status.replace('_', ' ')}
          </span>
          {onComplete && (
            <button
              onClick={onComplete}
              disabled={busy}
              className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {busy ? 'Saving…' : 'Mark Complete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
