import { useState, useEffect, useRef } from 'react';
import { Clock, Play, Square, Coffee, Briefcase, Loader2 } from 'lucide-react';
import api from '../../services/api';

interface TimeEntry { startTime: string; job?: { title: string } | null; project?: { name: string } | null; [key: string]: unknown; }
interface TimeJob { id: string; number: string; title: string; [key: string]: unknown; }
interface TimeProject { id: string; number: string; name: string; [key: string]: unknown; }
interface TimeClockProps { onUpdate?: () => void; }
interface TimeClockCompactProps { onUpdate?: () => void; }

/**
 * Time Clock Widget
 * 
 * Shows current status and allows clock in/out
 */
export default function TimeClock({ onUpdate }: TimeClockProps) {
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [elapsed, setElapsed] = useState<number>(0);
  const [showJobSelect, setShowJobSelect] = useState<boolean>(false);
  const [jobs, setJobs] = useState<TimeJob[]>([]);
  const [projects, setProjects] = useState<TimeProject[]>([]);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    loadActiveEntry();
    loadJobsAndProjects();
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (activeEntry) {
      // Start timer
      updateElapsed();
      timerRef.current = setInterval(updateElapsed, 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [activeEntry]);

  const updateElapsed = () => {
    if (activeEntry?.startTime) {
      const start = new Date(activeEntry.startTime);
      const now = new Date();
      setElapsed(Math.floor((now.getTime() - start.getTime()) / 1000));
    }
  };

  const loadActiveEntry = async () => {
    try {
      const entry = await api.get('/time/active');
      setActiveEntry(entry as TimeEntry | null);
    } catch (error: unknown) {
      console.error('Failed to load active entry:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadJobsAndProjects = async () => {
    try {
      const [jobsRes, projectsRes] = await Promise.all([
        api.get('/jobs?status=scheduled&status=in_progress&limit=50'),
        api.get('/projects?status=active&limit=50'),
      ]);
      setJobs((jobsRes as Record<string, unknown>).data as TimeJob[] || []);
      setProjects((projectsRes as Record<string, unknown>).data as TimeProject[] || []);
    } catch (error: unknown) {
      console.error('Failed to load jobs/projects:', error);
    }
  };

  const handleClockIn = async () => {
    if (!showJobSelect) {
      setShowJobSelect(true);
      return;
    }

    setProcessing(true);
    try {
      const entry = await api.post('/time/clock-in', {
        jobId: selectedJob || null,
        projectId: selectedProject || null,
        notes,
      });
      setActiveEntry(entry as TimeEntry);
      setShowJobSelect(false);
      setSelectedJob('');
      setSelectedProject('');
      setNotes('');
      onUpdate?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clock in';
      alert(message);
    } finally {
      setProcessing(false);
    }
  };

  const handleClockOut = async () => {
    setProcessing(true);
    try {
      await api.post('/time/clock-out', { notes });
      setActiveEntry(null);
      setNotes('');
      onUpdate?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      alert(message);
    } finally {
      setProcessing(false);
    }
  };

  const formatElapsed = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div className={`p-4 ${activeEntry ? 'bg-green-500' : 'bg-gray-100'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className={`w-6 h-6 ${activeEntry ? 'text-white' : 'text-gray-500'}`} />
            <span className={`font-medium ${activeEntry ? 'text-white' : 'text-gray-700'}`}>
              {activeEntry ? 'Clocked In' : 'Clocked Out'}
            </span>
          </div>
          {activeEntry && (
            <span className="text-2xl font-mono text-white font-bold">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>
      </div>

      {/* Active entry info */}
      {activeEntry && (
        <div className="p-4 bg-green-50 border-b">
          <div className="flex items-center gap-2 text-sm text-green-800">
            <Briefcase className="w-4 h-4" />
            <span>
              {activeEntry.job?.title || activeEntry.project?.name || 'General'}
            </span>
          </div>
          <p className="text-xs text-green-600 mt-1">
            Started at {new Date(activeEntry.startTime).toLocaleTimeString()}
          </p>
        </div>
      )}

      {/* Job selection */}
      {showJobSelect && !activeEntry && (
        <div className="p-4 space-y-3 bg-gray-50">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job (optional)</label>
            <select
              value={selectedJob}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedJob(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">No specific job</option>
              {jobs.map(job => (
                <option key={job.id} value={job.id}>
                  {job.number} - {job.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project (optional)</label>
            <select
              value={selectedProject}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedProject(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">No specific project</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.number} - {project.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)}
              placeholder="What are you working on?"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4">
        {activeEntry ? (
          <button
            onClick={handleClockOut}
            disabled={processing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            {processing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Square className="w-5 h-5" />
            )}
            Clock Out
          </button>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleClockIn}
              disabled={processing}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
            >
              {processing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5" />
              )}
              {showJobSelect ? 'Start Timer' : 'Clock In'}
            </button>
            {showJobSelect && (
              <button
                onClick={() => setShowJobSelect(false)}
                className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact clock widget for header/sidebar
 */
export function TimeClockCompact({ onUpdate }: TimeClockCompactProps) {
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    loadActiveEntry();
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (activeEntry) {
      updateElapsed();
      timerRef.current = setInterval(updateElapsed, 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [activeEntry]);

  const updateElapsed = () => {
    if (activeEntry?.startTime) {
      const start = new Date(activeEntry.startTime);
      const now = new Date();
      setElapsed(Math.floor((now.getTime() - start.getTime()) / 1000));
    }
  };

  const loadActiveEntry = async () => {
    try {
      const entry = await api.get('/time/active');
      setActiveEntry(entry as TimeEntry | null);
    } catch (error: unknown) {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleQuickClockIn = async () => {
    try {
      const entry = await api.post('/time/clock-in', {});
      setActiveEntry(entry as TimeEntry);
      onUpdate?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clock in';
      alert(message);
    }
  };

  const handleQuickClockOut = async () => {
    try {
      await api.post('/time/clock-out', {});
      setActiveEntry(null);
      onUpdate?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      alert(message);
    }
  };

  const formatElapsed = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div className="w-8 h-8" />;
  }

  if (activeEntry) {
    return (
      <button
        onClick={handleQuickClockOut}
        className="flex items-center gap-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
        title="Click to clock out"
      >
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="font-mono text-sm font-medium">{formatElapsed(elapsed)}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleQuickClockIn}
      className="flex items-center gap-2 px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
      title="Click to clock in"
    >
      <Clock className="w-4 h-4" />
      <span className="text-sm">Clock In</span>
    </button>
  );
}
