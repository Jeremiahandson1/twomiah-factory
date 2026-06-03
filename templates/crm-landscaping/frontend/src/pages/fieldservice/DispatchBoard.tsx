import { useState, useEffect } from 'react';
import {
  ClipboardList, Calendar, Clock, MapPin, User, Users,
  AlertTriangle, Play, CheckCircle, Loader2, ChevronLeft,
  ChevronRight, Phone, Wrench, Zap, Shield, Settings2, RefreshCw
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const SERVICE_TYPES = ['install', 'repair', 'maintenance', 'emergency'] as const;
const PRIORITIES = ['emergency', 'high', 'normal', 'low'] as const;

const PRIORITY_COLORS = {
  emergency: 'border-l-4 border-l-red-500 bg-red-50',
  high: 'border-l-4 border-l-orange-500 bg-orange-50',
  normal: 'border-l-4 border-l-blue-500 bg-blue-50',
  low: 'border-l-4 border-l-gray-400 bg-gray-50',
};

const PRIORITY_BADGES = {
  emergency: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-700',
};

const SERVICE_ICONS = {
  install: Settings2,
  repair: Wrench,
  maintenance: Shield,
  emergency: Zap,
};

/**
 * Dispatch Board — Today's service call scheduling and assignment
 */
export default function DispatchBoard() {
  const toast = useToast();
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [jobsRes, techsRes] = await Promise.all([
        api.get(`/api/jobs?date=${selectedDate}&limit=200`),
        api.get('/api/team?role=technician&limit=100'),
      ]);
      setJobs(jobsRes.data || jobsRes || []);
      setTechs(techsRes.data || techsRes || []);
    } catch (error) {
      console.error('Failed to load dispatch data:', error);
      toast.error('Failed to load dispatch board');
    } finally {
      setLoading(false);
    }
  };

  const unassigned = jobs.filter(j => !j.assignedTo && j.status !== 'completed');
  const inProgress = jobs.filter(j => j.status === 'in_progress');
  const completed = jobs.filter(j => j.status === 'completed');

  const handleAssign = async (jobId, techId) => {
    try {
      await api.put(`/api/jobs/${jobId}`, { assignedTo: techId, status: 'scheduled' });
      toast.success('Technician assigned');
      loadData();
    } catch (error) {
      toast.error('Failed to assign technician');
    }
  };

  const handleStatusChange = async (jobId, status) => {
    try {
      await api.put(`/api/jobs/${jobId}`, { status });
      toast.success(`Service call ${status === 'in_progress' ? 'started' : 'completed'}`);
      loadData();
    } catch (error) {
      toast.error('Failed to update job status');
    }
  };

  const navigateDate = (direction) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + direction);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  const dateDisplay = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dispatch Board</h1>
          <p className="text-gray-500 dark:text-slate-400">{dateDisplay}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
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
          <button
            onClick={() => navigateDate(1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isToday && (
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              className="px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 rounded-lg"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={ClipboardList} label="Total Jobs" value={jobs.length} />
        <StatCard icon={AlertTriangle} label="Unassigned" value={unassigned.length} color="orange" />
        <StatCard icon={Play} label="In Progress" value={inProgress.length} color="blue" />
        <StatCard icon={CheckCircle} label="Completed" value={completed.length} color="green" />
      </div>

      {/* Board Columns */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {/* Unassigned Column */}
          <div>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Unassigned</h2>
              <span className="ml-auto text-sm text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
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
                <div className="text-center py-8 text-gray-400 text-sm">
                  No unassigned jobs
                </div>
              )}
            </div>
          </div>

          {/* In Progress Column */}
          <div>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">In Progress</h2>
              <span className="ml-auto text-sm text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
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
                <div className="text-center py-8 text-gray-400 text-sm">
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
              <span className="ml-auto text-sm text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
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
                <div className="text-center py-8 text-gray-400 text-sm">
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

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function DispatchCard({ job, techs, onAssign, onStatusChange }) {
  const [assigning, setAssigning] = useState(false);

  const priority = job.priority || 'normal';
  const serviceType = job.serviceType || job.type || 'repair';
  const ServiceIcon = SERVICE_ICONS[serviceType] || Wrench;

  return (
    <div className={`rounded-xl p-4 ${PRIORITY_COLORS[priority]} dark:bg-slate-800 dark:border-l-4`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <ServiceIcon className="w-4 h-4 text-gray-600 dark:text-slate-300" />
          <span className="text-xs font-medium uppercase text-gray-500 dark:text-slate-400">
            {serviceType}
          </span>
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
        {job.contact?.name || job.customerName || job.title || 'Unnamed Service Call'}
      </p>

      {/* Address */}
      {(job.address || job.contact?.address) && (
        <div className="flex items-start gap-1 mt-1">
          <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2">
            {job.address || job.contact?.address}
          </p>
        </div>
      )}

      {/* Time Window */}
      {(job.scheduledTime || job.timeWindow) && (
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {job.scheduledTime || job.timeWindow}
          </p>
        </div>
      )}

      {/* Phone */}
      {(job.contact?.phone) && (
        <div className="flex items-center gap-1 mt-1">
          <Phone className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs text-gray-500 dark:text-slate-400">{job.contact.phone}</p>
        </div>
      )}

      {/* Assigned Tech */}
      {job.assignedTo && (
        <div className="flex items-center gap-1 mt-2">
          <User className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
            {job.assignedUser?.firstName || job.assignedUser?.name || 'Assigned'}
            {job.assignedUser?.lastName ? ` ${job.assignedUser.lastName}` : ''}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
        {/* Assign Dropdown */}
        {job.status !== 'completed' && (
          <select
            value={job.assignedTo || ''}
            onChange={(e) => {
              if (e.target.value) onAssign(job.id, e.target.value);
            }}
            className="w-full text-xs px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
          >
            <option value="">Assign technician...</option>
            {techs.map(tech => (
              <option key={tech.id} value={tech.id}>
                {tech.firstName || tech.name} {tech.lastName || ''}
              </option>
            ))}
          </select>
        )}

        {/* Status Buttons */}
        <div className="flex gap-2">
          {job.status !== 'in_progress' && job.status !== 'completed' && job.assignedTo && (
            <button
              onClick={() => onStatusChange(job.id, 'in_progress')}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={() => onStatusChange(job.id, 'completed')}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
