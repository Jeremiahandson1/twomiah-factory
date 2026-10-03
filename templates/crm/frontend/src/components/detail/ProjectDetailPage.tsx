import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
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
import { usePermissions } from '../../contexts/PermissionsContext';

interface RelatedItem {
  id: string;
  title?: string;
  name?: string;
  subject?: string;
  number: string;
  status: string;
  amount?: string | number;
  [key: string]: unknown;
}

interface ProjectDetailData {
  id: string;
  name: string;
  number: string;
  status: string;
  description?: string | null;
  type?: string | null;
  progress?: number | null;
  budget?: string | number | null;
  estimatedValue?: string | number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  contact?: { id: string; name: string } | null;
  jobs?: RelatedItem[];
  rfis?: RelatedItem[];
  changeOrders?: RelatedItem[];
  punchListItems?: RelatedItem[];
  /** Money, computed by the server over EVERY change order by status — never summed here. (T32 H4) */
  financials?: {
    budget: number | null;
    originalValue: number;
    approvedChangeOrders: number;
    approvedCount: number;
    pendingChangeOrders: number;
    pendingCount: number;
    revisedContractValue: number;
  };
  [key: string]: unknown;
}

interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export default function ProjectDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = rawId!;
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    loadProject();
    api.projects
      .activity(id)
      .then((data: ActivityEntry[]) => setActivity(Array.isArray(data) ? data : []))
      .catch(() => setActivity([]));
  }, [id]);

  const loadProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.projects.get(id);
      setProject(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast.error('Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  /**
   * EVERY WRITE CONTROL ASKS THE PERMISSION ITS OWN ENDPOINT ASKS. (T32 M17 / M8)
   *
   * A read-only viewer was offered Edit, Delete, Add Job, Create RFI, Create Change Order, Add Punch
   * List Item and Add Daily Log; a field technician was offered Edit and Delete. The server refuses
   * all of it — the report tried 17 writes as viewer and got 403 every time — so the only thing
   * these buttons did was waste somebody's click and make the product look broken.
   *
   * `can()` reads the same matrix the server does, so a button is offered exactly when the request
   * behind it would be served.
   */
  const { can } = usePermissions();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.projects.delete(id);
      toast.success('Project deleted');
      navigate('/crm/projects');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error loading project" description={error} onAction={loadProject} actionLabel="Retry" />;
  if (!project) return <EmptyState title="Project not found" />;

  const statusColors: Record<string, string> = {
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
            onClick={() => navigate('/crm/projects')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-gray-500 dark:text-slate-400">{project.number}</span>
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${statusColors[project.status] || ''}`}>
                {project.status?.replace('_', ' ')}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{project.name}</h1>
            {project.contact && (
              <Link to={`/crm/contacts/${project.contact.id}`} className="text-gray-500 hover:text-orange-700 dark:hover:text-orange-200 dark:text-slate-400">
                {project.contact.name}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {can('projects:update') && (
            <Link
              to={`/crm/projects?edit=${id}`}
              className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-2"
            >
              <Edit className="w-4 h-4" />
              Edit
            </Link>
          )}
          {can('projects:delete') && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-slate-200">Progress</span>
          <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{project.progress || 0}%</span>
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
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Project Details</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {(project.address || project.city) && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Location</p>
                    <p className="text-gray-900 dark:text-slate-100">
                      {project.address && <span>{project.address}<br /></span>}
                      {[[project.city, project.state].filter(Boolean).join(', '), project.zip].filter(Boolean).join(' ')}
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
                    <p className="text-sm text-gray-500 dark:text-slate-400">Timeline</p>
                    <p className="text-gray-900 dark:text-slate-100">
                      {project.startDate && formatDate(project.startDate)}
                      {project.startDate && project.endDate && ' - '}
                      {project.endDate && formatDate(project.endDate)}
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
                    <p className="text-sm text-gray-500 dark:text-slate-400">Budget</p>
                    <p className="text-gray-900 dark:text-slate-100">
                      {project.budget && <span className="font-medium">${Number(project.budget).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                      {project.estimatedValue && (
                        <span className="text-gray-500 dark:text-slate-400"> (Est: ${Number(project.estimatedValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {project.type && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">Type</p>
                  <p className="text-gray-900 capitalize dark:text-slate-100">{project.type.replace('_', ' ')}</p>
                </div>
              )}
            </div>
            {project.description && (
              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Description</p>
                <p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{project.description}</p>
              </div>
            )}
          </div>

          {/* Jobs */}
          {(project.jobs?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-slate-100">Jobs</h2>
                <Link to={`/crm/jobs?projectId=${id}`} className="text-sm text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">
                  View All
                </Link>
              </div>
              <div className="divide-y">
                {project.jobs!.slice(0, 5).map((job: RelatedItem) => (
                  <Link
                    key={job.id}
                    to={`/crm/jobs/${job.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">{job.title}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">{job.number}</p>
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* RFIs */}
          {(project.rfis?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-slate-100">RFIs</h2>
                <Link to={`/crm/rfis?projectId=${id}`} className="text-sm text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">
                  View All
                </Link>
              </div>
              <div className="divide-y">
                {project.rfis!.slice(0, 5).map((rfi: RelatedItem) => (
                  <div key={rfi.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileQuestion className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">{rfi.subject}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">{rfi.number}</p>
                      </div>
                    </div>
                    <StatusBadge status={rfi.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Change Orders */}
          {(project.changeOrders?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-slate-100">Change Orders</h2>
                {/*
                  * No link into a module this person cannot open. (T37 N8)
                  *
                  * The panel itself stays for everybody — a technician needs to know the scope
                  * changed (T37 N6) — but View All went to /crm/change-orders, which answers "You
                  * don't have access to Change Orders" for field. A link whose only outcome is a
                  * refusal page is the same fault as a button the server rejects.
                  */}
                {can('change-orders:read') && (
                  <Link to={`/crm/change-orders?projectId=${id}`} className="text-sm text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">
                    View All
                  </Link>
                )}
              </div>
              <div className="divide-y">
                {project.changeOrders!.slice(0, 5).map((co: RelatedItem) => (
                  <div key={co.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileDiff className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">{co.title}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">{co.number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {/*
                        * `$NaN` on every row, for a whole round. (T37 N7)
                        *
                        * The server stops sending `amount` to somebody who may not see money, and
                        * this printed `$${Number(undefined)}` — so the fix that withheld the figure
                        * replaced it with nonsense, which looks like a broken page rather than a
                        * boundary. The ABSENCE of the field is the signal, not a permission check:
                        * the screen renders what it was given.
                        */}
                      {co.amount === undefined || co.amount === null
                        ? null
                        : <p className="font-medium tabular-nums">${Number(co.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
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
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Summary</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Jobs</span>
                <span className="font-medium">{project.jobs?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">RFIs</span>
                <span className="font-medium">{project.rfis?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Change Orders</span>
                <span className="font-medium">{project.changeOrders?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Punch List Items</span>
                <span className="font-medium">{project.punchListItems?.length || 0}</span>
              </div>
            </div>
          </div>

          {/*
            * Financial summary — and nothing at all for somebody who may not see money. (T35-6 low)
            *
            * The server withholds `budget`, `estimatedValue` and the whole `financials` block from a
            * caller without invoices:read, so for a field technician every row inside this card was
            * false and the card rendered as a bare "Financials" heading over empty space. An empty
            * panel reads as a loading failure, not as a boundary.
            */}
          {(project.financials || project.budget) && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Financials</h2>
            <div className="space-y-4">
              {project.budget && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Budget</span>
                  <span className="font-medium">${Number(project.budget).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {/**
                * EVERY FIGURE HERE COMES FROM THE SERVER. (T32 H4)
                *
                * This panel used to add up `project.changeOrders` itself — a list that includes
                * drafts and pending change orders and is capped at ten rows. So it printed money
                * nobody had agreed to as contract money, and on a project with eleven change orders
                * it was wrong a second way. `financials` is computed over all of them, by status.
                *
                * Agreed and not-yet-agreed are shown on separate lines on purpose: putting them in
                * one number is what made the original wrong, and somebody reading the page needs to
                * know which part of it the client has signed.
                */}
              {project.financials && (
                <>
                  {project.financials.approvedChangeOrders !== 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-slate-400">
                        Approved change orders{project.financials.approvedCount ? ` (${project.financials.approvedCount})` : ''}
                      </span>
                      <span className={`font-medium tabular-nums ${project.financials.approvedChangeOrders < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                        {project.financials.approvedChangeOrders < 0 ? '−' : '+'}${Math.abs(project.financials.approvedChangeOrders).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {!!project.financials.revisedContractValue && (
                    <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-800 pt-3">
                      <span className="font-medium text-gray-900 dark:text-slate-100">Contract value</span>
                      <span className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                        ${project.financials.revisedContractValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {project.financials.pendingChangeOrders !== 0 && (
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {project.financials.pendingCount === 1 ? 'One change order' : `${project.financials.pendingCount} change orders`} worth{' '}
                      {project.financials.pendingChangeOrders < 0 ? '−' : ''}${Math.abs(project.financials.pendingChangeOrders).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} raised and not yet
                      approved — not in the contract value above.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          )}

          {/* Quick actions — the whole panel goes when a role is offered none of them, rather than
              leaving an empty card headed "Quick Actions". */}
          {(can('jobs:create') || can('rfis:create') || can('change-orders:create') || can('punch-lists:create') || can('daily-logs:create')) && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Quick Actions</h2>
            <div className="space-y-2">
              {can('jobs:create') && (
                <Link
                  to={`/crm/jobs?projectId=${id}&new=true`}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <Briefcase className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Add Job
                </Link>
              )}
              {can('rfis:create') && (
                <Link
                  to={`/crm/rfis?projectId=${id}&new=true`}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <FileQuestion className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Create RFI
                </Link>
              )}
              {can('change-orders:create') && (
                <Link
                  to={`/crm/change-orders?projectId=${id}&new=true`}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <FileDiff className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Create Change Order
                </Link>
              )}
              {can('punch-lists:create') && (
                <Link
                  to={`/crm/punch-lists?projectId=${id}&new=true`}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <ClipboardList className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Add Punch List Item
                </Link>
              )}
              {can('daily-logs:create') && (
                <Link
                  to={`/crm/daily-logs?projectId=${id}&new=true`}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <FileText className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Add Daily Log
                </Link>
              )}
            </div>
          </div>
          )}

          {/* Timeline */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Timeline</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500 dark:text-slate-400">Created</span>
                <span className="text-gray-900 dark:text-slate-100">{formatDate(project.createdAt)}</span>
              </div>
              {project.startDate && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500 dark:text-slate-400">Started</span>
                  <span className="text-gray-900 dark:text-slate-100">{formatDate(project.startDate)}</span>
                </div>
              )}
              {project.endDate && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-gray-500 dark:text-slate-400">End Date</span>
                  <span className="text-gray-900 dark:text-slate-100">{formatDate(project.endDate)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Activity feed */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Recent Activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activity.slice(0, 20).map((a) => {
                  const actor = (a.metadata?.actorName as string) || 'Someone';
                  const role = (a.metadata?.actorRole as string) || '';
                  return (
                    <li key={a.id} className="text-sm border-l-2 border-orange-300 pl-3">
                      <p className="text-gray-900 dark:text-slate-100">
                        <span className="font-medium">{actor}</span>
                        {role && <span className="text-gray-500 dark:text-slate-400"> ({role})</span>}{' '}
                        {a.description || `${a.action} ${a.entityType}`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
                    </li>
                  );
                })}
              </ul>
            )}
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
