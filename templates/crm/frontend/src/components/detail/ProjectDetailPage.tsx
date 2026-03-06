import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, Edit, Trash2, MapPin, Calendar, DollarSign,
  Briefcase, FileText, Receipt, FileQuestion, FileDiff, ClipboardList
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { ConfirmModal } from '../ui/Modal';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.projects.get(id);
      setProject(data);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.projects.delete(id);
      toast.success('Project deleted');
      navigate('/projects');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error loading project" description={error} onAction={loadProject} actionLabel="Retry" />;
  if (!project) return <EmptyState title="Project not found" />;

  const statusColors = {
    planning: 'bg-gray-100 text-gray-700',
    active: 'bg-blue-100 text-blue-700',
    on_hold: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/projects')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-gray-500">{project.number}</span>
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${statusColors[project.status]}`}>
                {project.status?.replace('_', ' ')}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            {project.contact && (
              <Link to={`/contacts/${project.contact.id}`} className="text-gray-500 hover:text-orange-500">
                {project.contact.name}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/projects?edit=${id}`}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Link>
          <button
            onClick={() => setDeleteOpen(true)}
            className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Progress</span>
          <span className="text-sm font-medium text-orange-600">{project.progress || 0}%</span>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-orange-500 rounded-full transition-all duration-300"
            style={{ width: `${project.progress || 0}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Project details */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Project Details</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {(project.address || project.city) && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="text-gray-900">
                      {project.address && <span>{project.address}<br /></span>}
                      {project.city && `${project.city}, `}{project.state} {project.zip}
                    </p>
                  </div>
                </div>
              )}
              {(project.startDate || project.endDate) && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Timeline</p>
                    <p className="text-gray-900">
                      {project.startDate && new Date(project.startDate).toLocaleDateString()}
                      {project.startDate && project.endDate && ' - '}
                      {project.endDate && new Date(project.endDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              )}
              {(project.estimatedValue || project.budget) && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Budget</p>
                    <p className="text-gray-900">
                      {project.budget && <span className="font-medium">${Number(project.budget).toLocaleString()}</span>}
                      {project.estimatedValue && (
                        <span className="text-gray-500"> (Est: ${Number(project.estimatedValue).toLocaleString()})</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {project.type && (
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <p className="text-gray-900 capitalize">{project.type.replace('_', ' ')}</p>
                </div>
              )}
            </div>
            {project.description && (
              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-gray-500 mb-2">Description</p>
                <p className="text-gray-700 whitespace-pre-wrap">{project.description}</p>
              </div>
            )}
          </div>

          {/* Jobs */}
          {project.jobs?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Jobs</h2>
                <Link to={`/jobs?projectId=${id}`} className="text-sm text-orange-500 hover:text-orange-600">
                  View All
                </Link>
              </div>
              <div className="divide-y">
                {project.jobs.slice(0, 5).map(job => (
                  <Link
                    key={job.id}
                    to={`/jobs/${job.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{job.title}</p>
                        <p className="text-sm text-gray-500">{job.number}</p>
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* RFIs */}
          {project.rfis?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">RFIs</h2>
                <Link to={`/rfis?projectId=${id}`} className="text-sm text-orange-500 hover:text-orange-600">
                  View All
                </Link>
              </div>
              <div className="divide-y">
                {project.rfis.slice(0, 5).map(rfi => (
                  <div key={rfi.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileQuestion className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{rfi.subject}</p>
                        <p className="text-sm text-gray-500">{rfi.number}</p>
                      </div>
                    </div>
                    <StatusBadge status={rfi.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Change Orders */}
          {project.changeOrders?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Change Orders</h2>
                <Link to={`/change-orders?projectId=${id}`} className="text-sm text-orange-500 hover:text-orange-600">
                  View All
                </Link>
              </div>
              <div className="divide-y">
                {project.changeOrders.slice(0, 5).map(co => (
                  <div key={co.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileDiff className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{co.title}</p>
                        <p className="text-sm text-gray-500">{co.number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">${Number(co.amount).toLocaleString()}</p>
                      <StatusBadge status={co.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Summary</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Jobs</span>
                <span className="font-medium">{project.jobs?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">RFIs</span>
                <span className="font-medium">{project.rfis?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Change Orders</span>
                <span className="font-medium">{project.changeOrders?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Punch List Items</span>
                <span className="font-medium">{project.punchListItems?.length || 0}</span>
              </div>
            </div>
          </div>

          {/* Financial summary */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Financials</h2>
            <div className="space-y-4">
              {project.budget && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Budget</span>
                  <span className="font-medium">${Number(project.budget).toLocaleString()}</span>
                </div>
              )}
              {project.changeOrders?.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Change Orders</span>
                  <span className="font-medium text-orange-600">
                    +${project.changeOrders.reduce((sum, co) => sum + Number(co.amount), 0).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to={`/jobs?projectId=${id}&new=true`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <Briefcase className="w-4 h-4 text-gray-500" />
                Add Job
              </Link>
              <Link
                to={`/rfis?projectId=${id}&new=true`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <FileQuestion className="w-4 h-4 text-gray-500" />
                Create RFI
              </Link>
              <Link
                to={`/change-orders?projectId=${id}&new=true`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <FileDiff className="w-4 h-4 text-gray-500" />
                Create Change Order
              </Link>
              <Link
                to={`/punch-lists?projectId=${id}&new=true`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <ClipboardList className="w-4 h-4 text-gray-500" />
                Add Punch List Item
              </Link>
              <Link
                to={`/daily-logs?projectId=${id}&new=true`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <FileText className="w-4 h-4 text-gray-500" />
                Add Daily Log
              </Link>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Timeline</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">{new Date(project.createdAt).toLocaleDateString()}</span>
              </div>
              {project.startDate && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500">Started</span>
                  <span className="text-gray-900">{new Date(project.startDate).toLocaleDateString()}</span>
                </div>
              )}
              {project.endDate && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-gray-500">End Date</span>
                  <span className="text-gray-900">{new Date(project.endDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Project"
        message={`Are you sure you want to delete "${project.name}"? This will also remove related data.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
