import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, Edit, Trash2, Mail, Phone, MapPin, Building2, 
  Calendar, Tag, FileText, Briefcase, Receipt, MessageSquare
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { ConfirmModal } from '../ui/Modal';

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadContact();
  }, [id]);

  const loadContact = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.contacts.get(id);
      setContact(data);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load contact');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.contacts.delete(id);
      toast.success('Contact deleted');
      navigate('/contacts');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = async () => {
    try {
      await api.contacts.convert(id);
      toast.success('Lead converted to client');
      loadContact();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error loading contact" description={error} onAction={loadContact} actionLabel="Retry" />;
  if (!contact) return <EmptyState title="Contact not found" />;

  const typeColors = {
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
            onClick={() => navigate('/contacts')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${typeColors[contact.type]}`}>
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
            to={`/contacts?edit=${id}`}
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

      {/* Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact info card */}
          <div className="bg-white rounded-lg shadow-sm p-6">
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
                      {contact.mobile}
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
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Notes</h2>
              <p className="text-gray-600 whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}

          {/* Related Projects */}
          {contact.projects?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Projects</h2>
                <span className="text-sm text-gray-500">{contact.projects.length}</span>
              </div>
              <div className="divide-y">
                {contact.projects.map(project => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
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
          {contact.quotes?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Quotes</h2>
                <span className="text-sm text-gray-500">{contact.quotes.length}</span>
              </div>
              <div className="divide-y">
                {contact.quotes.map(quote => (
                  <Link
                    key={quote.id}
                    to={`/quotes/${quote.id}`}
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
          <div className="bg-white rounded-lg shadow-sm p-6">
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
          <div className="bg-white rounded-lg shadow-sm p-6">
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
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to={`/quotes?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <FileText className="w-4 h-4 text-gray-500" />
                Create Quote
              </Link>
              <Link
                to={`/jobs?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <Briefcase className="w-4 h-4 text-gray-500" />
                Schedule Job
              </Link>
              <Link
                to={`/invoices?contactId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2"
              >
                <Receipt className="w-4 h-4 text-gray-500" />
                Create Invoice
              </Link>
            </div>
          </div>
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
