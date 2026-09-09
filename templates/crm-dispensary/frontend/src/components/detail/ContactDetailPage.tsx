import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Edit, Trash2, Mail, Phone, MapPin, Building2,
  ShoppingCart, Star, MessageSquare, Award, Gift
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { Modal, ConfirmModal } from '../ui/Modal';

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsBody, setSmsBody] = useState('');
  const [smsSending, setSmsSending] = useState(false);

  useEffect(() => {
    loadContact();
    loadOrders();
    loadLoyalty();
  }, [id]);

  const loadContact = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.contacts.get(id);
      setContact(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load customer');
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const data = await api.get('/api/orders', { contactId: id, limit: 10 });
      setOrders(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      // Orders may not exist yet
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadLoyalty = async () => {
    try {
      const data = await api.get(`/api/contacts/${id}/loyalty`);
      setLoyalty(data);
    } catch (err) {
      // Loyalty may not be set up
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.contacts.delete(id);
      toast.success('Customer deleted');
      navigate('/crm/customers');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // Send an in-app SMS via the CRM's Twilio-backed /api/sms/send (phone is
  // normalized server-side). The endpoint returns 200 with { status } even on a
  // provider failure, so branch on status rather than assuming success.
  const handleSendSms = async () => {
    if (!smsBody.trim()) { toast.error('Message is required'); return; }
    setSmsSending(true);
    try {
      const res: any = await api.post('/api/sms/send', {
        contactId: id,
        toPhone: contact.phone,
        message: smsBody.trim(),
      });
      if (res?.status === 'sent') {
        toast.success('Text message sent');
        setSmsOpen(false);
        setSmsBody('');
      } else {
        toast.error(res?.errorMessage || 'Message could not be sent');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setSmsSending(false);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error loading customer" description={error} onAction={loadContact} actionLabel="Retry" />;
  if (!contact) return <EmptyState title="Customer not found" />;

  const typeColors: Record<string, string> = {
    lead: 'bg-yellow-100 text-yellow-700',
    customer: 'bg-green-100 text-green-700',
  };

  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/crm/customers')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{contact.name}</h1>
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${typeColors[contact.type] || 'bg-gray-100 text-gray-600'}`}>
                {contact.type}
              </span>
            </div>
            {contact.company && (
              <p className="text-gray-500 flex items-center gap-1 mt-1 dark:text-slate-400">
                <Building2 className="w-4 h-4" />
                {contact.company}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/crm/customers?edit=${id}`}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2 dark:bg-slate-800 dark:text-slate-200"
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
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Contact Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {contact.email && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Email</p>
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
                    <p className="text-sm text-gray-500 dark:text-slate-400">Phone</p>
                    <a href={`tel:${contact.phone}`} className="text-gray-900 hover:underline dark:text-slate-100">
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
                    <p className="text-sm text-gray-500 dark:text-slate-400">Mobile</p>
                    <a href={`tel:${contact.mobile}`} className="text-gray-900 hover:underline dark:text-slate-100">
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
                    <p className="text-sm text-gray-500 dark:text-slate-400">Address</p>
                    <p className="text-gray-900 dark:text-slate-100">
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
            <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
              <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Notes</h2>
              <p className="text-gray-600 whitespace-pre-wrap dark:text-slate-400">{contact.notes}</p>
            </div>
          )}

          {/* Order History */}
          <div className="bg-white rounded-lg shadow-sm dark:bg-slate-900">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Order History</h2>
              <span className="text-sm text-gray-500 dark:text-slate-400">{orders.length} orders</span>
            </div>
            {ordersLoading ? (
              <div className="p-8 flex justify-center">
                <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : orders.length > 0 ? (
              <div className="divide-y">
                {orders.map((order: any) => (
                  <Link
                    key={order.id}
                    to={`/crm/orders/${order.id}`}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <ShoppingCart className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">#{order.orderNumber || order.id?.slice(0, 8)}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">
                          {order.createdAt ? formatDate(order.createdAt) : '—'}
                          {' · '}{order.itemCount || order.items?.length || 0} items
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900 dark:text-slate-100">${Number(order.total || 0).toFixed(2)}</p>
                      <StatusBadge status={order.status} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="p-6 text-gray-500 text-sm text-center dark:text-slate-400">No orders yet</p>
            )}
          </div>

          {/* Loyalty Status */}
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
              <Award className="w-5 h-5 text-amber-500" />
              Loyalty Status
            </h2>
            {loyalty ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Tier</span>
                  <span className="font-medium flex items-center gap-1">
                    <Star className="w-4 h-4 text-amber-500" />
                    {loyalty.tier || 'Standard'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Points Balance</span>
                  <span className="font-medium">{loyalty.points ?? 0} pts</span>
                </div>
                {loyalty.recentTransactions?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2 dark:text-slate-200">Recent Transactions</p>
                    <div className="space-y-2">
                      {loyalty.recentTransactions.slice(0, 5).map((txn: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-slate-400">{txn.description || txn.type}</span>
                          <span className={txn.points >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {txn.points >= 0 ? '+' : ''}{txn.points} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm dark:text-slate-400">No loyalty data available</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick stats */}
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Summary</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Orders</span>
                <span className="font-medium">{orders.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Total Spent</span>
                <span className="font-medium">${totalSpent.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Loyalty Tier</span>
                <span className="font-medium">{loyalty?.tier || 'Standard'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Points Balance</span>
                <span className="font-medium">{loyalty?.points ?? 0}</span>
              </div>
              {contact.source && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Source</span>
                  <span className="font-medium">{contact.source}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Activity</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500 dark:text-slate-400">Created</span>
                <span className="text-gray-900 dark:text-slate-100">{formatDate(contact.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-gray-500 dark:text-slate-400">Updated</span>
                <span className="text-gray-900 dark:text-slate-100">{formatDate(contact.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to={`/crm/orders/new?customerId=${id}`}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
              >
                <ShoppingCart className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                Create Order
              </Link>
              <button
                onClick={async () => {
                  if (!loyalty?.id) { toast.info('This contact is not enrolled in loyalty yet.'); return; }
                  const raw = window.prompt('Adjust loyalty points (use a negative number to deduct):');
                  if (raw === null) return;
                  const points = parseInt(raw, 10);
                  if (!Number.isInteger(points) || points === 0) { toast.error('Enter a non-zero whole number of points.'); return; }
                  const reason = window.prompt('Reason for this adjustment:');
                  if (!reason || !reason.trim()) { toast.error('A reason is required.'); return; }
                  try {
                    await api.post(`/api/loyalty/members/${loyalty.id}/adjust`, { points, reason: reason.trim() });
                    toast.success(`Adjusted ${points > 0 ? '+' : ''}${points} pts`);
                    loadLoyalty();
                  } catch (err: any) {
                    toast.error(err?.message || 'Failed to adjust points (manager role required).');
                  }
                }}
                className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
              >
                <Gift className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                Adjust Loyalty Points
              </button>
              {contact.phone && (
                <button
                  onClick={() => { setSmsBody(''); setSmsOpen(true); }}
                  className="w-full px-4 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center gap-2 dark:bg-slate-900"
                >
                  <MessageSquare className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                  Send SMS
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Send SMS */}
      <Modal isOpen={smsOpen} onClose={() => setSmsOpen(false)} title={`Text ${contact?.name || 'customer'}`}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">To</label>
            <p className="text-sm text-gray-600 dark:text-slate-400">{contact?.phone}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Message</label>
            <textarea
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              rows={4}
              maxLength={480}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="Type your message..."
            />
            <p className="mt-1 text-xs text-gray-400">{smsBody.length}/480</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setSmsOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium dark:text-slate-200">Cancel</button>
          <button
            onClick={handleSendSms}
            disabled={smsSending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {smsSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Customer"
        message={`Are you sure you want to delete "${contact.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
