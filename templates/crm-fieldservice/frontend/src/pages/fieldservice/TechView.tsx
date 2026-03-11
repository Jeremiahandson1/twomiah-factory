import { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Phone, Clock, ChevronRight, ChevronLeft,
  Navigation, CheckCircle, AlertTriangle, Wrench, Zap,
  Shield, Settings2, Camera, ClipboardList, Loader2,
  Thermometer, Wind, Droplets, Gauge, Plug, ArrowRight,
  Truck, Flag, X, FileText, Package, Trash2,
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type Job = {
  id: string;
  number: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  jobType: string;
  scheduledDate: string;
  scheduledTime?: string;
  estimatedHours?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  internalNotes?: string;
  contact?: { id: string; name: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string } | null;
  equipment?: { id: string; name: string; manufacturer?: string; model?: string; serialNumber?: string; location?: string; warrantyExpiry?: string; purchaseDate?: string } | null;
};

type ChecklistItem = {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'attention';
  notes: string;
};

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const PRIORITY_COLORS: Record<string, string> = {
  emergency: 'bg-red-100 text-red-800 border-red-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  normal: 'bg-blue-100 text-blue-800 border-blue-300',
  low: 'bg-gray-100 text-gray-700 border-gray-300',
};

const JOB_TYPE_ICONS: Record<string, any> = {
  install: Settings2,
  repair: Wrench,
  maintenance: Shield,
  emergency: Zap,
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  dispatched: 'En Route',
  in_progress: 'On Site',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  dispatched: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'notes' | 'status'>[] = [
  { id: 'refrigerant', label: 'Refrigerant Levels' },
  { id: 'coil_condition', label: 'Coil Condition' },
  { id: 'filter_status', label: 'Filter Status' },
  { id: 'thermostat', label: 'Thermostat Calibration' },
  { id: 'drain_line', label: 'Drain Line' },
  { id: 'electrical', label: 'Electrical Connections' },
  { id: 'airflow', label: 'Airflow Reading' },
];

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

type Screen = 'list' | 'detail' | 'checklist';

export default function TechView() {
  const { hasFeature } = useAuth();
  const toast = useToast();
  const [screen, setScreen] = useState<Screen>('list');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Bottom nav tab for list view
  const [listTab, setListTab] = useState<'today' | 'upcoming' | 'completed'>('today');

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/tech/my-jobs');
      setJobs(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error('Failed to load jobs:', err);
      toast.error('Failed to load your jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const openJob = (job: Job) => {
    setSelectedJob(job);
    setScreen('detail');
  };

  const goBack = () => {
    if (screen === 'checklist') {
      setScreen('detail');
    } else {
      setScreen('list');
      setSelectedJob(null);
    }
  };

  // Refresh selected job data after status change
  const refreshSelectedJob = (updated: Job) => {
    setSelectedJob(prev => prev ? { ...prev, ...updated } : null);
    setJobs(prev => prev.map(j => j.id === updated.id ? { ...j, ...updated } : j));
  };

  // ─── Status Actions ──────────────────────────────────────────

  const handleOnMyWay = async () => {
    if (!selectedJob) return;
    setActionLoading(true);
    try {
      const updated = await api.post(`/api/tech/${selectedJob.id}/on-my-way`, {});
      refreshSelectedJob(updated);
      toast.success('Status updated — On My Way');
    } catch (err) {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOnSite = async () => {
    if (!selectedJob) return;
    setActionLoading(true);
    try {
      const updated = await api.post(`/api/tech/${selectedJob.id}/on-site`, {});
      refreshSelectedJob(updated);
      toast.success('Status updated — On Site');
    } catch (err) {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteJob = async (notes?: string) => {
    if (!selectedJob) return;
    setActionLoading(true);
    try {
      const updated = await api.post(`/api/tech/${selectedJob.id}/complete-job`, { notes: notes || undefined });
      refreshSelectedJob(updated);
      toast.success('Job completed!');
    } catch (err) {
      toast.error('Failed to complete job');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Navigate to address ─────────────────────────────────────

  const navigateToAddress = (job: Job) => {
    const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
    if (addr) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`, '_blank');
    }
  };

  // ─── Filter jobs by tab ──────────────────────────────────────

  const today = new Date().toISOString().split('T')[0];

  const todayJobs = jobs.filter(j =>
    j.scheduledDate?.startsWith(today) && j.status !== 'completed' && j.status !== 'cancelled'
  );
  const upcomingJobs = jobs.filter(j =>
    j.scheduledDate > today && j.status !== 'completed' && j.status !== 'cancelled'
  );
  const completedJobs = jobs.filter(j => j.status === 'completed');

  const filteredJobs = listTab === 'today' ? todayJobs : listTab === 'upcoming' ? upcomingJobs : completedJobs;

  // ─── Render ──────────────────────────────────────────────────

  if (!hasFeature('tech_mobile_view')) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center p-8">
          <Wrench className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Tech View Not Available</h2>
          <p className="text-gray-500">Upgrade to the Small Shop plan or higher to access the mobile technician view.</p>
        </div>
      </div>
    );
  }

  if (screen === 'checklist' && selectedJob) {
    return <ChecklistScreen job={selectedJob} onBack={goBack} onComplete={() => { goBack(); loadJobs(); }} />;
  }

  if (screen === 'detail' && selectedJob) {
    return (
      <JobDetailScreen
        job={selectedJob}
        onBack={goBack}
        onNavigate={() => navigateToAddress(selectedJob)}
        onMyWay={handleOnMyWay}
        onSite={handleOnSite}
        onComplete={handleCompleteJob}
        onChecklist={() => setScreen('checklist')}
        actionLoading={actionLoading}
      />
    );
  }

  // ─── Job List Screen ─────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <h1 className="text-xl font-bold text-gray-900">My Jobs</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Job List */}
      <div className="flex-1 overflow-y-auto pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">
              {listTab === 'today' ? 'No jobs scheduled today' : listTab === 'upcoming' ? 'No upcoming jobs' : 'No completed jobs'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredJobs.map(job => (
              <JobCard key={job.id} job={job} onTap={() => openJob(job)} onNavigate={() => navigateToAddress(job)} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Tab Nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t flex z-50">
        <TabButton active={listTab === 'today'} label="Today" count={todayJobs.length} icon={Clock} onClick={() => setListTab('today')} />
        <TabButton active={listTab === 'upcoming'} label="Upcoming" count={upcomingJobs.length} icon={Calendar} onClick={() => setListTab('upcoming')} />
        <TabButton active={listTab === 'completed'} label="Done" count={completedJobs.length} icon={CheckCircle} onClick={() => setListTab('completed')} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

function Calendar(props: any) {
  return <Clock {...props} />;
}

function TabButton({ active, label, count, icon: Icon, onClick }: { active: boolean; label: string; count: number; icon: any; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${active ? 'text-blue-600 bg-blue-50' : 'text-gray-500'}`}
    >
      <Icon className="w-5 h-5 mb-0.5" />
      {label}
      {count > 0 && (
        <span className={`mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function JobCard({ job, onTap, onNavigate }: { job: Job; onTap: () => void; onNavigate: () => void }) {
  const TypeIcon = JOB_TYPE_ICONS[job.jobType] || Wrench;
  const addr = [job.address, job.city].filter(Boolean).join(', ');

  return (
    <div className="bg-white px-4 py-4 active:bg-gray-50 transition-colors">
      <div className="flex items-start gap-3" onClick={onTap}>
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
          <TypeIcon className="w-5 h-5 text-blue-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-400">{job.number}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_COLORS[job.priority] || PRIORITY_COLORS.normal}`}>
              {job.priority}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_COLORS[job.status] || ''}`}>
              {STATUS_LABELS[job.status] || job.status}
            </span>
          </div>
          <h3 className="font-semibold text-gray-900 text-[15px] truncate">{job.title}</h3>
          {job.contact && (
            <p className="text-sm text-gray-600 mt-0.5">{job.contact.name}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            {job.scheduledTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {job.scheduledTime}
              </span>
            )}
            {addr && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="w-3.5 h-3.5" />
                {addr}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0 mt-2" />
      </div>

      {/* Navigate button */}
      {job.address && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm active:bg-blue-700 transition-colors"
        >
          <Navigation className="w-4 h-4" />
          Navigate
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Job Detail Screen
// ═══════════════════════════════════════════════════════════════

function JobDetailScreen({
  job, onBack, onNavigate, onMyWay, onSite, onComplete, onChecklist, actionLoading,
}: {
  job: Job;
  onBack: () => void;
  onNavigate: () => void;
  onMyWay: () => void;
  onSite: () => void;
  onComplete: (notes?: string) => void;
  onChecklist: () => void;
  actionLoading: boolean;
}) {
  const toast = useToast();
  const [completionNotes, setCompletionNotes] = useState('');
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');

  const [photos, setPhotos] = useState<any[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoCaption, setPhotoCaption] = useState('');
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [fullscreenPhoto, setFullscreenPhoto] = useState<any>(null);

  useEffect(() => {
    loadPhotos();
  }, [job.id]);

  const loadPhotos = async () => {
    setPhotosLoading(true);
    try {
      const data = await api.get(`/api/jobs/${job.id}/photos`);
      setPhotos(Array.isArray(data) ? data : []);
    } catch {} finally {
      setPhotosLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Photo must be under 10MB');
      return;
    }
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPhotoCaption('');
  };

  const handleUpload = async () => {
    if (!previewFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', previewFile);
      if (photoCaption) formData.append('caption', photoCaption);
      await api.request(`/api/jobs/${job.id}/photos`, { method: 'POST', body: formData });
      toast.success('Photo uploaded');
      setPreviewFile(null);
      setPreviewUrl('');
      loadPhotos();
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await api.request(`/api/jobs/${job.id}/photos/${photoId}`, { method: 'DELETE' });
      toast.success('Photo deleted');
      setFullscreenPhoto(null);
      loadPhotos();
    } catch {
      toast.error('Failed to delete photo');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg active:bg-gray-100">
          <ChevronLeft className="w-6 h-6 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 font-mono">{job.number}</p>
          <h2 className="text-lg font-bold text-gray-900 truncate">{job.title}</h2>
        </div>
        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_COLORS[job.status] || ''}`}>
          {STATUS_LABELS[job.status] || job.status}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-32 px-4 py-4 space-y-4">
        {/* Customer Card */}
        {job.contact && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Customer</h3>
            <p className="font-semibold text-gray-900 text-lg">{job.contact.name}</p>
            {job.contact.phone && (
              <a href={`tel:${job.contact.phone}`} className="flex items-center gap-2 mt-2 py-2.5 px-4 bg-green-50 text-green-700 rounded-lg font-medium text-sm active:bg-green-100">
                <Phone className="w-4 h-4" />
                {job.contact.phone}
              </a>
            )}
          </div>
        )}

        {/* Address + Navigate */}
        {addr && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Location</h3>
            <p className="text-gray-700">{addr}</p>
            <button
              onClick={onNavigate}
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-lg font-semibold text-sm active:bg-blue-700"
            >
              <Navigation className="w-5 h-5" />
              Navigate to Job Site
            </button>
          </div>
        )}

        {/* Job Details */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Job Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="font-medium text-gray-900 capitalize">{job.jobType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Priority</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLORS[job.priority] || ''}`}>{job.priority}</span>
            </div>
            {job.scheduledTime && (
              <div className="flex justify-between">
                <span className="text-gray-500">Scheduled</span>
                <span className="font-medium text-gray-900">{job.scheduledTime}</span>
              </div>
            )}
            {job.estimatedHours && (
              <div className="flex justify-between">
                <span className="text-gray-500">Est. Duration</span>
                <span className="font-medium text-gray-900">{job.estimatedHours}h</span>
              </div>
            )}
          </div>
          {job.description && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-sm text-gray-600">{job.description}</p>
            </div>
          )}
        </div>

        {/* Equipment */}
        {job.equipment && (
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-orange-400">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Equipment</h3>
            <p className="font-semibold text-gray-900">{job.equipment.name}</p>
            {(job.equipment.manufacturer || job.equipment.model) && (
              <p className="text-sm text-gray-600 mt-0.5">
                {[job.equipment.manufacturer, job.equipment.model].filter(Boolean).join(' ')}
              </p>
            )}
            {job.equipment.serialNumber && (
              <p className="text-xs text-gray-400 font-mono mt-1">S/N: {job.equipment.serialNumber}</p>
            )}
            {job.equipment.location && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {job.equipment.location}
              </p>
            )}
          </div>
        )}

        {/* Inspection Checklist Button */}
        {(job.jobType === 'maintenance' || job.jobType === 'repair') && job.status !== 'completed' && (
          <button
            onClick={onChecklist}
            className="w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 border-l-4 border-l-purple-400"
          >
            <ClipboardList className="w-6 h-6 text-purple-600" />
            <div className="flex-1 text-left">
              <p className="font-semibold text-gray-900">HVAC Inspection Checklist</p>
              <p className="text-xs text-gray-500 mt-0.5">Refrigerant, coils, filter, thermostat, drain, electrical, airflow</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </button>
        )}

        {/* Notes */}
        {job.internalNotes && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes</h3>
            <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans">{job.internalNotes}</pre>
          </div>
        )}

        {/* Photos */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Photos</h3>
            <span className="text-xs text-gray-400">{photos.length}</span>
          </div>

          {/* Thumbnail Grid */}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map(p => (
                <button key={p.id} onClick={() => setFullscreenPhoto(p)} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                  <img src={p.thumbnailUrl || p.url} alt={p.caption || 'Job photo'} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Upload Preview */}
          {previewUrl && (
            <div className="mb-3 space-y-2">
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-48 object-cover" />
              <input
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                placeholder="Add caption (optional)"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button onClick={() => { setPreviewFile(null); setPreviewUrl(''); }} className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleUpload} disabled={uploading} className="flex-1 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {/* Add Photo Button */}
          {!previewUrl && (
            <label className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 rounded-lg text-sm font-medium text-gray-600 active:bg-gray-200 cursor-pointer">
              <Camera className="w-5 h-5" />
              Take / Add Photo
              <input type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />
            </label>
          )}
        </div>

        {/* Fullscreen Photo */}
        {fullscreenPhoto && (
          <div className="fixed inset-0 bg-black z-50 flex flex-col">
            <div className="flex items-center justify-between p-4">
              <button onClick={() => setFullscreenPhoto(null)} className="p-2 text-white">
                <X className="w-6 h-6" />
              </button>
              <button onClick={() => handleDeletePhoto(fullscreenPhoto.id)} className="p-2 text-red-400">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4">
              <img src={fullscreenPhoto.url} alt={fullscreenPhoto.caption || ''} className="max-w-full max-h-full object-contain" />
            </div>
            {fullscreenPhoto.caption && (
              <p className="text-white text-center p-4 text-sm">{fullscreenPhoto.caption}</p>
            )}
          </div>
        )}
      </div>

      {/* Complete confirmation overlay */}
      {showCompleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Complete Job</h3>
              <button onClick={() => setShowCompleteConfirm(false)} className="p-2 rounded-lg active:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <textarea
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Completion notes (optional)..."
              rows={3}
              className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
            <button
              onClick={() => { onComplete(completionNotes); setShowCompleteConfirm(false); }}
              disabled={actionLoading}
              className="w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg active:bg-green-700 disabled:opacity-50"
            >
              {actionLoading ? 'Completing...' : 'Confirm Complete'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-40">
        {job.status === 'scheduled' && (
          <button
            onClick={onMyWay}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 py-4 bg-yellow-500 text-white rounded-xl font-bold text-lg active:bg-yellow-600 disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5" />}
            On My Way
          </button>
        )}
        {job.status === 'dispatched' && (
          <button
            onClick={onSite}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg active:bg-blue-700 disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Flag className="w-5 h-5" />}
            Arrived — On Site
          </button>
        )}
        {job.status === 'in_progress' && (
          <button
            onClick={() => setShowCompleteConfirm(true)}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 py-4 bg-green-600 text-white rounded-xl font-bold text-lg active:bg-green-700 disabled:opacity-50"
          >
            <CheckCircle className="w-5 h-5" />
            Complete Job
          </button>
        )}
        {job.status === 'completed' && (
          <div className="text-center py-3 text-green-600 font-semibold flex items-center justify-center gap-2">
            <CheckCircle className="w-5 h-5" />
            Job Completed
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Inspection Checklist Screen
// ═══════════════════════════════════════════════════════════════

function ChecklistScreen({ job, onBack, onComplete }: { job: Job; onBack: () => void; onComplete: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ChecklistItem[]>(
    DEFAULT_CHECKLIST.map(item => ({ ...item, status: 'pass' as const, notes: '' }))
  );
  const [overallNotes, setOverallNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const updateItem = (id: string, field: keyof ChecklistItem, value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/tech/${job.id}/checklist`, {
        items,
        overallNotes: overallNotes || undefined,
      });
      toast.success('Inspection checklist saved');
      onComplete();
    } catch (err) {
      toast.error('Failed to save checklist');
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'pass') return <CheckCircle className="w-6 h-6 text-green-600" />;
    if (status === 'fail') return <X className="w-6 h-6 text-red-600" />;
    return <AlertTriangle className="w-6 h-6 text-yellow-600" />;
  };

  const statusButtonClass = (current: string, target: string) => {
    const base = 'flex-1 py-3 rounded-lg font-semibold text-sm transition-colors';
    if (current === target) {
      if (target === 'pass') return `${base} bg-green-600 text-white`;
      if (target === 'fail') return `${base} bg-red-600 text-white`;
      return `${base} bg-yellow-500 text-white`;
    }
    return `${base} bg-gray-100 text-gray-600 active:bg-gray-200`;
  };

  const CHECKLIST_ICONS: Record<string, any> = {
    refrigerant: Thermometer,
    coil_condition: Wind,
    filter_status: Wind,
    thermostat: Gauge,
    drain_line: Droplets,
    electrical: Plug,
    airflow: Wind,
  };

  const failCount = items.filter(i => i.status === 'fail').length;
  const attentionCount = items.filter(i => i.status === 'attention').length;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg active:bg-gray-100">
          <ChevronLeft className="w-6 h-6 text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">HVAC Inspection</h2>
          <p className="text-xs text-gray-500">{job.number} — {job.title}</p>
        </div>
      </div>

      {/* Summary bar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4 text-xs font-semibold">
        <span className="text-green-600">{items.filter(i => i.status === 'pass').length} Pass</span>
        <span className="text-yellow-600">{attentionCount} Attention</span>
        <span className="text-red-600">{failCount} Fail</span>
      </div>

      {/* Checklist Items */}
      <div className="flex-1 overflow-y-auto pb-28 px-4 py-4 space-y-3">
        {items.map(item => {
          const Icon = CHECKLIST_ICONS[item.id] || ClipboardList;
          const isExpanded = expandedItem === item.id;

          return (
            <div key={item.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                className="w-full flex items-center gap-3 p-4 active:bg-gray-50"
              >
                <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <span className="flex-1 text-left font-medium text-gray-900">{item.label}</span>
                {statusIcon(item.status)}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t space-y-3">
                  {/* Status buttons */}
                  <div className="flex gap-2 pt-3">
                    <button onClick={() => updateItem(item.id, 'status', 'pass')} className={statusButtonClass(item.status, 'pass')}>
                      Pass
                    </button>
                    <button onClick={() => updateItem(item.id, 'status', 'attention')} className={statusButtonClass(item.status, 'attention')}>
                      Attention
                    </button>
                    <button onClick={() => updateItem(item.id, 'status', 'fail')} className={statusButtonClass(item.status, 'fail')}>
                      Fail
                    </button>
                  </div>
                  {/* Notes */}
                  <textarea
                    value={item.notes}
                    onChange={(e) => updateItem(item.id, 'notes', e.target.value)}
                    placeholder="Notes for this item..."
                    rows={2}
                    className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Overall Notes */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Overall Notes</h3>
          <textarea
            value={overallNotes}
            onChange={(e) => setOverallNotes(e.target.value)}
            placeholder="General inspection notes..."
            rows={3}
            className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Submit Button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-40">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 bg-purple-600 text-white rounded-xl font-bold text-lg active:bg-purple-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardList className="w-5 h-5" />}
          Submit Inspection
        </button>
      </div>
    </div>
  );
}
