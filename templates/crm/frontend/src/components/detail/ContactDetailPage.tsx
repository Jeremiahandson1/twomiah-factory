import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Edit, Trash2, Mail, Phone, MapPin, Building2,
  Calendar, Tag, FileText, Briefcase, Receipt, MessageSquare, FileBarChart,
  Globe, ToggleLeft, ToggleRight, Send, Loader2
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { ConfirmModal } from '../ui/Modal';

interface ContactDetailData {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  type: string;
  company?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
  projects?: Array<{ id: string; name: string; number: string; status: string }>;
  quotes?: Array<{ id: string; name: string; number: string; total: string | number; status: string }>;
  invoices?: Array<{ id: string; number: string; total: string | number; status: string }>;
  [key: string]: unknown;
}

interface RoofReport {
  id: string;
  totalSquares: number;
  imageryQuality: string;
  createdAt: string;
  [key: string]: unknown;
}

export default function ContactDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = rawId!;
  const navigate = useNavigate();
  const toast = useToast();
  const { hasFeature } = useAuth();
  const [contact, setContact] = useState<ContactDetailData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [roofReports, setRoofReports] = useState<RoofReport[]>([]);
  const [generatingReport, setGeneratingReport] = useState<boolean>(false);
  const [portalStatus, setPortalStatus] = useState<any>(null);
  const [portalLoading, setPortalLoading] = useState<boolean>(false);

  useEffect(() => {
    loadContact();
    if (hasFeature('instant_estimator')) loadRoofReports();
    if (hasFeature('client_portal')) loadPortalStatus();
  }, [id]);

  const loadPortalStatus = async () => {
    try {
      const data = await api.get(`/api/portal/contacts/${id}/status`);
      setPortalStatus(data);
    } catch { /* portal not configured */ }
  };

  const togglePortal = async () => {
    setPortalLoading(true);
    try {
      if (portalStatus?.enabled) {
        await api.post(`/api/portal/contacts/${id}/disable`);
        toast.success('Portal access disabled');
      } else {
        await api.post(`/api/portal/contacts/${id}/enable`);
        toast.success('Portal access enabled — invite sent');
      }
      await loadPortalStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update portal access');
    } finally {
      setPortalLoading(false);
    }
  };

  const resendPortalInvite = async () => {
    setPortalLoading(true);
    try {
      await api.post(`/api/portal/contacts/${id}/send-link`);
      toast.success('Portal invite sent');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invite');
    } finally {
      setPortalLoading(false);
    }
  };

  const loadContact = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.contacts.get(id);
      setContact(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast.error('Failed to load contact');
    } finally {
      setLoading(false);
    }
  };

  const loadRoofReports = async () => {
    try {
      const data = await api.request(`/api/roof-reports?contactId=${id}`);
      setRoofReports(data?.data || []);
    } catch {
      // silently ignore
    }
  };

  const purchaseRoofReport = async () => {
    setGeneratingReport(true);
    try {
      const result = await api.request(`/api/roof-reports/purchase-for-contact/${id}`, { method: 'POST' });
      if (result.free) {
        toast.success('Roof report generated');
        loadRoofReports();
      } else if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed — does this contact have an address?';
      toast.error(message);
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.contacts.delete(id);
      toast.success('Contact deleted');
      navigate('/crm/contacts');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = async () => {
    try {
      await api.contacts.convert(id);
      toast.success('Lead converted to client');
      loadContact();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error loading contact" description={error} onAction={loadContact} actionLabel="Retry" />;
  if (!contact) return <EmptyState title="Contact not found" />;

  const typeColors: Record<string, string> = {
    lead: 'bg-yellow-100 text-yellow-700',
    client: 'bg-green-100 text-green-700',
    subcontractor: 'bg-blue-100 text-blue-700',
    vendor: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/crm/contacts')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${typeColors[contact.type] || ''}`}>
                {contact.type}
              </span>
            </div>
            {contact.company && (
              <p className="text-gray-500 flex items-center gap-1 mt-1">
                <Building2 className="w-4 h-4" />
                {contact.company}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact.type === 'lead' && (
            <button
              onClick={handleConvert}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              Convert to Client
            </button>
          )}
          <Link
            to={`/crm/contacts?edit=${id}`}
            className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-2"
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

      {/* Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact info card */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Contact Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {contact.email && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">
                      {contact.email}
                    </a>
                  </div>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                    <Phone className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <a href={`tel:${contact.phone}`} className="text-gray-900 hover:underline">
                      {contact.phone}
                    </a>
                  </div>
                </div>
              )}
              {contact.mobile && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                    <Phone className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Mobile</p>
                    <a href={`tel:${contact.mobile}`} className="text-gray-900 hover:underline">
                      {contact.mobile as string}
                    </a>
                  </div>
                </div>
              )}
              {(contact.address || contact.city) && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="text-gray-900">
                      {contact.address && <span>{contact.address}<br /></span>}
                      {contact.city && `${contact.city}, `}{contact.state} {contact.zip}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {contact.notes && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Notes</h2>
              <p className="text-gray-600 whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}

          {/* Related Projects */}
          {(contact.projects?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Projects</h2>
                <span className="text-sm text-gray-500">{contact.projects!.length}</span>
              </div>
              <div className="divide-y">
                {contact.projects!.map((project) => (
                  <Link
                    key={project.id}
                    to={`/crm/projects/${project.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{project.name}</p>
                        <p className="text-sm text-gray-500">{project.number}</p>
                      </div>
                    </div>
                    <StatusBadge status={project.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Related Quotes */}
          {(contact.quotes?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Quotes</h2>
                <span className="text-sm text-gray-500">{contact.quotes!.length}</span>
              </div>
              <div className="divide-y">
                {contact.quotes!.map((quote) => (
                  <Link
                    key={quote.id}
                    to={`/crm/quotes/${quote.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{quote.name}</p>
                        <p className="text-sm text-gray-500">{quote.number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">${Number(quote.total).toLocaleString()}</p>
                      <StatusBadge status={quote.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick stats */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Summary</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Projects</span>
                <span className="font-medium">{contact.projects?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Quotes</span>
                <span className="font-medium">{contact.quotes?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Invoices</span>
                <span className="font-medium">{contact.invoices?.length || 0}</span>
              </div>
              {contact.source && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Source</span>
                  <span className="font-medium">{contact.source}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Activity</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">{new Date(contact.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-gray-500">Updated</span>
                <span className="text-gray-900">{new Date(contact.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to={`/crm/quotes?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <FileText className="w-4 h-4 text-gray-500" />
                Create Quote
              </Link>
              <Link
                to={`/crm/jobs?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <Briefcase className="w-4 h-4 text-gray-500" />
                Schedule Job
              </Link>
              <Link
                to={`/crm/invoices?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <Receipt className="w-4 h-4 text-gray-500" />
                Create Invoice
              </Link>
              {hasFeature('instant_estimator') && contact.address && (
                <button
                  onClick={purchaseRoofReport}
                  disabled={generatingReport}
                  className="w-full px-4 py-2 text-left bg-green-50 hover:bg-green-100 rounded-lg flex items-center gap-2 text-green-700 disabled:opacity-50"
                >
                  <FileBarChart className="w-4 h-4" />
                  {generatingReport ? 'Processing...' : 'Roof Report — $9.99'}
                </button>
              )}
            </div>
          </div>

          {/* Roof Reports */}
          {hasFeature('instant_estimator') && roofReports.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Roof Reports</h2>
                <span className="text-sm text-gray-500">{roofReports.length}</span>
              </div>
              <div className="divide-y">
                {roofReports.map((report: RoofReport) => (
                  <Link
                    key={report.id}
                    to={`/crm/roof-reports/${report.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <FileBarChart className="w-5 h-5 text-blue-500" />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{report.totalSquares} squares</p>
                        <p className="text-xs text-gray-500">{new Date(report.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      report.imageryQuality === 'HIGH' ? 'bg-green-100 text-green-700' :
                      report.imageryQuality === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>{report.imageryQuality}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Portal Access */}
          {hasFeature('client_portal') && contact.email && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-500" />
                Customer Portal
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Status</span>
                  <button onClick={togglePortal} disabled={portalLoading} className="flex items-center gap-1.5">
                    {portalStatus?.enabled ? (
                      <ToggleRight className="w-6 h-6 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-gray-400" />
                    )}
                    <span className={`text-sm font-medium ${portalStatus?.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                      {portalStatus?.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Email</span>
                  <span className="text-gray-900">{contact.email}</span>
                </div>
                {portalStatus?.lastVisit && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Last Login</span>
                    <span className="text-gray-900">{new Date(portalStatus.lastVisit).toLocaleDateString()}</span>
                  </div>
                )}
                {portalStatus?.enabled && (
                  <button onClick={resendPortalInvite} disabled={portalLoading}
                    className="w-full mt-2 px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2">
                    {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Resend Portal Invite
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Contact"
        message={`Are you sure you want to delete "${contact.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
