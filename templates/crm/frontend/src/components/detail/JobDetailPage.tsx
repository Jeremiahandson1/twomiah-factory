import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, MapPin, Calendar, Clock, User, Play, CheckCircle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { ConfirmModal } from '../ui/Modal';

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => { loadJob(); }, [id]);

  const loadJob = async () => {
    setLoading(true);
    try {
      const data = await api.jobs.get(id);
      setJob(data);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.jobs.delete(id);
      toast.success('Job deleted');
      navigate('/jobs');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleStart = async () => {
    try {
      await api.jobs.start(id);
      toast.success('Job started');
      loadJob();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleComplete = async () => {
    try {
      await api.jobs.complete(id);
      toast.success('Job completed');
      loadJob();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error" description={error} onAction={loadJob} actionLabel="Retry" />;
  if (!job) return <EmptyState title="Job not found" />;

  const priorityColors = { low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/jobs')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-sm font-mono text-gray-500">{job.number}</p>
            <h1 className="text-2xl font-bold text-gray-900">{job.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={job.status} />
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${priorityColors[job.priority]}`}>{job.priority}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.status === 'scheduled' && (
            <button onClick={handleStart} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2">
              <Play className="w-4 h-4" /> Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button onClick={handleComplete} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Complete
            </button>
          )}
          <Link to={`/jobs?edit=${id}`} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
            <Edit className="w-4 h-4" /> Edit
          </Link>
          <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Job Details</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {job.scheduledDate && (
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Scheduled</p>
                    <p>{new Date(job.scheduledDate).toLocaleDateString()} {job.scheduledTime}</p>
                  </div>
                </div>
              )}
              {job.estimatedHours && (
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Estimated</p>
                    <p>{job.estimatedHours} hours</p>
                  </div>
                </div>
              )}
              {(job.address || job.city) && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p>{job.address}{job.city && `, ${job.city}`}</p>
                  </div>
                </div>
              )}
              {job.assignedTo && (
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Assigned To</p>
                    <p>{job.assignedTo.firstName} {job.assignedTo.lastName}</p>
                  </div>
                </div>
              )}
            </div>
            {job.description && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-gray-500 mb-2">Description</p>
                <p className="text-gray-700 whitespace-pre-wrap">{job.description}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Related</h2>
            <div className="space-y-3">
              {job.project && (
                <Link to={`/projects/${job.project.id}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <p className="text-sm text-gray-500">Project</p>
                  <p className="font-medium">{job.project.name}</p>
                </Link>
              )}
              {job.contact && (
                <Link to={`/contacts/${job.contact.id}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <p className="text-sm text-gray-500">Contact</p>
                  <p className="font-medium">{job.contact.name}</p>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Job" message={`Delete "${job.title}"?`} confirmText="Delete" />
    </div>
  );
}
