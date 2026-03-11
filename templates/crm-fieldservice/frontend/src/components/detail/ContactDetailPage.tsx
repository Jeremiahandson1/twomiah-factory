import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Edit, Trash2, Mail, Phone, MapPin, Building2,
  Calendar, Tag, FileText, Briefcase, Receipt, MessageSquare,
  Wrench, Shield, Plus, Globe, Send, Loader2, ToggleLeft, ToggleRight,
  MapPinned, ChevronRight, X
} from 'lucide-react';
import { Modal } from '../ui/Modal';
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
  const [portalStatus, setPortalStatus] = useState<any>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [siteForm, setSiteForm] = useState({ name: '', address: '', city: '', state: '', zip: '', accessNotes: '' });
  const [savingSite, setSavingSite] = useState(false);
  const [siteDetail, setSiteDetail] = useState<any>(null);
  const [siteDetailLoading, setSiteDetailLoading] = useState(false);
  const [smsMessages, setSmsMessages] = useState<any[]>([]);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsInput, setSmsInput] = useState('');
  const [smsSending, setSmsSending] = useState(false);

  useEffect(() => {
    loadContact();
    loadPortalStatus();
    loadSmsMessages();
  }, [id]);

  const loadSmsMessages = async () => {
    setSmsLoading(true);
    try {
      const res = await api.get(`/api/sms/conversations`, { contactId: id });
      if (res.data?.length > 0) {
        const convo = await api.get(`/api/sms/conversations/${res.data[0].conversation.id}`);
        setSmsMessages(convo.messages || []);
      }
    } catch {} finally {
      setSmsLoading(false);
    }
  };

  const loadPortalStatus = async () => {
    try {
      const data = await api.get(`/api/portal/contacts/${id}/status`);
      setPortalStatus(data);
    } catch {}
  };

  const togglePortal = async () => {
    setPortalLoading(true);
    try {
      if (portalStatus?.enabled) {
        await api.post(`/api/portal/contacts/${id}/disable`);
        toast.success('Portal access disabled');
      } else {
        await api.post(`/api/portal/contacts/${id}/enable`);
        toast.success('Portal access enabled');
      }
      await loadPortalStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update portal access');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleCreateSite = async () => {
    if (!siteForm.name.trim()) return;
    setSavingSite(true);
    try {
      await api.post(`/api/contacts/${id}/sites`, siteForm);
      toast.success('Location added');
      setSiteModalOpen(false);
      setSiteForm({ name: '', address: '', city: '', state: '', zip: '', accessNotes: '' });
      loadContact();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add location');
    } finally {
      setSavingSite(false);
    }
  };

  const openSiteDetail = async (siteId: string) => {
    setSiteDetailLoading(true);
    try {
      const data = await api.get(`/api/contacts/sites/${siteId}`);
      setSiteDetail(data);
    } catch {
      toast.error('Failed to load site details');
    } finally {
      setSiteDetailLoading(false);
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

  const handleSendSms = async () => {
    if (!smsInput.trim()) return;
    setSmsSending(true);
    try {
      await api.post('/api/sms/send', { contactId: id, message: smsInput });
      setSmsInput('');
      loadSmsMessages();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setSmsSending(false);
    }
  };

  const handleToggleOptOut = async () => {
    try {
      await api.put(`/api/contacts/${id}`, { optedOutSms: !contact.optedOutSms });
      toast.success(contact.optedOutSms ? 'SMS opted back in' : 'SMS opted out');
      loadContact();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update opt-out');
    }
  };

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

          {/* Equipment */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Equipment</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{contact.equipment?.length || 0}</span>
                <Link
                  to={`/equipment?contactId=${id}`}
                  className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Add Equipment
                </Link>
              </div>
            </div>
            {contact.equipment?.length > 0 ? (
              <div className="divide-y">
                {contact.equipment.map(eq => (
                  <Link
                    key={eq.id}
                    to={`/equipment`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
                        <Wrench className="w-5 h-5 text-orange-500" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{eq.name}</p>
                        <p className="text-sm text-gray-500">
                          {[eq.manufacturer, eq.model].filter(Boolean).join(' ') || 'No model info'}
                          {eq.serialNumber && <span className="ml-2 font-mono text-xs">S/N: {eq.serialNumber}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {eq.warrantyExpiry && (
                        <div className="flex items-center gap-1 justify-end">
                          <Shield className={`w-3.5 h-3.5 ${new Date(eq.warrantyExpiry) > new Date() ? 'text-green-500' : 'text-gray-400'}`} />
                          <span className={new Date(eq.warrantyExpiry) > new Date() ? 'text-green-600' : 'text-gray-400'}>
                            Warranty {new Date(eq.warrantyExpiry) > new Date() ? 'active' : 'expired'}
                          </span>
                        </div>
                      )}
                      {eq.purchaseDate && (
                        <p className="text-gray-400">
                          Installed {new Date(eq.purchaseDate).toLocaleDateString()}
                        </p>
                      )}
                      {eq.location && (
                        <p className="text-gray-400">{eq.location}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-gray-400">
                <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No equipment on file</p>
              </div>
            )}
          </div>

          {/* Locations / Sites */}
          {(contact.sites?.length > 0 || contact.type === 'client') && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Locations</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{contact.sites?.length || 0}</span>
                  <button
                    onClick={() => setSiteModalOpen(true)}
                    className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add Location
                  </button>
                </div>
              </div>
              {contact.sites?.length > 0 ? (
                <div className="divide-y">
                  {contact.sites.map(s => (
                    <button
                      key={s.id}
                      onClick={() => openSiteDetail(s.id)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                          <MapPinned className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{s.name}</p>
                          <p className="text-sm text-gray-500">
                            {[s.address, s.city].filter(Boolean).join(', ') || 'No address'}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-300" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-400">
                  <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No locations added — useful for commercial accounts with multiple sites</p>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Messages
              </h2>
              <button onClick={handleToggleOptOut} className={`text-xs px-2 py-1 rounded ${contact.optedOutSms ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                {contact.optedOutSms ? 'Opted Out — Re-enable' : 'Opt Out SMS'}
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-4 space-y-2">
              {smsMessages.length === 0 && !smsLoading && (
                <p className="text-center text-sm text-gray-400 py-6">No messages yet</p>
              )}
              {smsMessages.map(m => (
                <div key={m.message.id} className={`flex ${m.message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.message.direction === 'outbound' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
                    <p>{m.message.body}</p>
                    <p className={`text-[10px] mt-1 ${m.message.direction === 'outbound' ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(m.message.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {!contact.optedOutSms && (
              <div className="p-3 border-t flex gap-2">
                <input
                  value={smsInput}
                  onChange={(e) => setSmsInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendSms()}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                />
                <button onClick={handleSendSms} disabled={smsSending || !smsInput.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {smsSending ? '...' : 'Send'}
                </button>
              </div>
            )}
          </div>
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
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Equipment</span>
                <span className="font-medium">{contact.equipment?.length || 0}</span>
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

          {/* Portal Access */}
          {contact.email && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-500" />
                Portal Access
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Status</span>
                  <button
                    onClick={togglePortal}
                    disabled={portalLoading}
                    className="flex items-center gap-1.5"
                  >
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
                  <button
                    onClick={resendPortalInvite}
                    disabled={portalLoading}
                    className="w-full mt-2 px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2"
                  >
                    {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Resend Portal Invite
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Location Modal */}
      <Modal isOpen={siteModalOpen} onClose={() => setSiteModalOpen(false)} title="Add Location" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Location Name *</label>
            <input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder='e.g. "Main Warehouse", "Downtown Office"' />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium mb-1">City</label><input value={siteForm.city} onChange={(e) => setSiteForm({ ...siteForm, city: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">State</label><input value={siteForm.state} onChange={(e) => setSiteForm({ ...siteForm, state: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">ZIP</label><input value={siteForm.zip} onChange={(e) => setSiteForm({ ...siteForm, zip: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Access Notes</label>
            <textarea value={siteForm.accessNotes} onChange={(e) => setSiteForm({ ...siteForm, accessNotes: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded-lg" placeholder="Gate codes, contact on site, parking instructions..." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setSiteModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={handleCreateSite} disabled={savingSite || !siteForm.name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{savingSite ? 'Saving...' : 'Add Location'}</button>
          </div>
        </div>
      </Modal>

      {/* Site Detail Modal */}
      {siteDetail && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSiteDetail(null)} />
          <div className="relative min-h-screen flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <MapPinned className="w-5 h-5 text-blue-500" />
                    {siteDetail.name}
                  </h2>
                  <p className="text-sm text-gray-500">{[siteDetail.address, siteDetail.city, siteDetail.state, siteDetail.zip].filter(Boolean).join(', ')}</p>
                </div>
                <button onClick={() => setSiteDetail(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
              </div>

              {siteDetail.accessNotes && (
                <div className="mb-4 p-3 bg-yellow-50 rounded-lg">
                  <p className="text-xs font-semibold text-yellow-700 uppercase mb-1">Access Notes</p>
                  <p className="text-sm text-yellow-800">{siteDetail.accessNotes}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Equipment at this location ({siteDetail.equipment?.length || 0})</h3>
                  {siteDetail.equipment?.length > 0 ? (
                    <div className="divide-y border rounded-lg">
                      {siteDetail.equipment.map((eq: any) => (
                        <div key={eq.id} className="p-3 flex items-center gap-3">
                          <Wrench className="w-4 h-4 text-orange-500" />
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{eq.name}</p>
                            <p className="text-xs text-gray-500">{[eq.manufacturer, eq.model].filter(Boolean).join(' ')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No equipment at this location</p>
                  )}
                  <Link
                    to={`/equipment?contactId=${id}&siteId=${siteDetail.id}`}
                    className="mt-2 inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"
                  >
                    <Plus className="w-3 h-3" /> Add Equipment to This Location
                  </Link>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Service History ({siteDetail.jobs?.length || 0})</h3>
                  {siteDetail.jobs?.length > 0 ? (
                    <div className="divide-y border rounded-lg">
                      {siteDetail.jobs.map((j: any) => (
                        <Link key={j.id} to={`/jobs/${j.id}`} className="p-3 flex items-center justify-between hover:bg-gray-50">
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{j.title}</p>
                            <p className="text-xs text-gray-500">{j.number} — {j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString() : ''}</p>
                          </div>
                          <StatusBadge status={j.status} />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No jobs at this location</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
