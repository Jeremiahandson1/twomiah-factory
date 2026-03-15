import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Printer, Clock, CheckCircle, XCircle, Truck, ShoppingBag } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { ConfirmModal } from '../components/ui/Modal';

const statusSteps = ['pending', 'processing', 'completed'];

const statusIcons: Record<string, any> = {
  pending: Clock,
  processing: ShoppingBag,
  completed: CheckCircle,
  cancelled: XCircle,
  delivery: Truck,
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const toast = useToast();
  const [order, setOrder] = useState<any>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [id]);

  const loadOrder = async () => {
    try {
      const [orderData, auditData] = await Promise.all([
        api.get(`/api/orders/${id}`),
        api.get('/api/audit', { entity: 'order', entityId: id, limit: 20 }).then((r: any) => r?.data || r).catch(() => []),
      ]);
      setOrder(orderData);
      setAuditLog(Array.isArray(auditData) ? auditData : auditData?.data || []);
    } catch (err) {
      toast.error('Failed to load order');
      navigate('/crm/orders');
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async () => {
    setRefunding(true);
    try {
      await api.post(`/api/orders/${id}/refund`, { reason: 'Refund requested by manager' });
      toast.success('Order refunded');
      loadOrder();
      setRefundOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to process refund');
    } finally {
      setRefunding(false);
    }
  };

  const handleStatusUpdate = async (status: string) => {
    try {
      await api.put(`/api/orders/${id}/status`, { status });
      toast.success(`Order marked as ${status}`);
      loadOrder();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) return null;

  const currentStepIndex = statusSteps.indexOf(order.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/crm/orders')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Order #{order.orderNumber || order.id?.slice(0, 8)}
            </h1>
            <p className="text-gray-500">
              {order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}
              {order.customerName && ` — ${order.customerName}`}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print Receipt
          </button>
          {isManager && order.status !== 'refunded' && order.status !== 'cancelled' && (
            <button
              onClick={() => setRefundOpen(true)}
              className="px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 font-medium flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Refund
            </button>
          )}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Order Status</h2>
        <div className="flex items-center gap-4">
          {statusSteps.map((step, idx) => {
            const isActive = idx <= currentStepIndex;
            const isCurrent = step === order.status;
            const Icon = statusIcons[step] || Clock;
            return (
              <div key={step} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-2 ${isActive ? 'text-green-600' : 'text-gray-400'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    isCurrent ? 'bg-green-600 text-white' : isActive ? 'bg-green-100' : 'bg-gray-100'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-sm font-medium capitalize ${isCurrent ? 'text-green-700' : ''}`}>
                    {step}
                  </span>
                </div>
                {idx < statusSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${isActive ? 'bg-green-400' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        {order.status === 'pending' && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => handleStatusUpdate('processing')}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              Start Processing
            </button>
            <button
              onClick={() => handleStatusUpdate('completed')}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              Mark Completed
            </button>
          </div>
        )}
        {order.status === 'processing' && (
          <div className="mt-4">
            <button
              onClick={() => handleStatusUpdate('completed')}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              Mark Completed
            </button>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Line Items */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900">Line Items</h2>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(order.items || []).map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.productName || item.name}</p>
                    {item.strainType && (
                      <span className="text-xs text-gray-500">{item.strainType}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-700">${Number(item.unitPrice || item.price || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    ${(Number(item.unitPrice || item.price || 0) * item.quantity).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-sm text-gray-600">Subtotal</td>
                <td className="px-4 py-2 text-right font-medium text-gray-900">${Number(order.subtotal || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-sm text-gray-600">Tax</td>
                <td className="px-4 py-2 text-right text-gray-700">${Number(order.tax || 0).toFixed(2)}</td>
              </tr>
              {order.loyaltyDiscount > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-sm text-green-600">Loyalty Discount</td>
                  <td className="px-4 py-2 text-right text-green-600">-${Number(order.loyaltyDiscount).toFixed(2)}</td>
                </tr>
              )}
              <tr className="border-t-2">
                <td colSpan={3} className="px-4 py-3 text-right font-bold text-gray-900">Total</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900 text-lg">${Number(order.total || 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Payment & Info */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Payment Details</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Method</span>
                <span className="capitalize font-medium text-gray-900">{order.paymentMethod || '—'}</span>
              </div>
              {order.paymentMethod === 'cash' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cash Tendered</span>
                    <span className="text-gray-900">${Number(order.cashTendered || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Change</span>
                    <span className="text-gray-900">${(Number(order.cashTendered || 0) - Number(order.total || 0)).toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  order.status === 'completed' ? 'bg-green-100 text-green-700' :
                  order.status === 'refunded' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {order.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="capitalize text-gray-900">{(order.type || 'walk_in').replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Processed by</span>
                <span className="text-gray-900">{order.processedBy || order.createdByName || '—'}</span>
              </div>
            </div>
          </div>

          {/* Audit Trail */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Audit Trail</h2>
            <div className="space-y-3">
              {auditLog.length > 0 ? auditLog.map((entry: any, idx: number) => (
                <div key={idx} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-400 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-gray-900">{entry.action || entry.description}</p>
                    <p className="text-gray-500 text-xs">
                      {entry.userName || 'System'} — {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              )) : (
                <p className="text-gray-500 text-sm">No audit entries</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Refund Modal */}
      <ConfirmModal
        isOpen={refundOpen}
        onClose={() => setRefundOpen(false)}
        onConfirm={handleRefund}
        title="Refund Order"
        message={`Are you sure you want to refund order #${order.orderNumber || order.id?.slice(0, 8)} for $${Number(order.total || 0).toFixed(2)}? This action cannot be undone.`}
        confirmText="Process Refund"
        loading={refunding}
      />
    </div>
  );
}
