import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Printer, Clock, CheckCircle, XCircle, Truck, ShoppingBag } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { orderLabel } from '../utils/order';

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
  // A refund is either UNITS coming back off the shelf or MONEY going back with the goods kept.
  // The screen used to offer neither choice: one button refunded the whole order as a dollar
  // amount, so a single returned gummy was impossible and nothing ever came back to inventory. (T21 M10)
  const [refundMode, setRefundMode] = useState<'items' | 'amount'>('items');
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  // Settling an order from this screen. A kiosk order arrives here as pending with idVerified false —
  // the customer passed the tablet's age gate, but the law wants a human to look at the card — and
  // "Mark Completed" called the status route, which refuses a cannabis sale that has not been ID
  // checked. There was no checkbox to satisfy it and no way to say how the customer paid, so a kiosk
  // order could not be completed from anywhere in the product. (Dispensary T29 H1)
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [idChecked, setIdChecked] = useState(false);
  const [completing, setCompleting] = useState(false);

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

  // Units left on a line after any earlier partial refund — the ceiling for this one.
  const remainingOf = (item: any) => Math.max(0, Number(item.quantity || 0) - Number(item.refundedQuantity || 0));
  const orderItems: any[] = order?.items || [];
  const remainingUnits = orderItems.reduce((s, it) => s + remainingOf(it), 0);
  const selectedUnits = orderItems.reduce((s, it) => s + Math.min(remainingOf(it), Number(refundQty[it.id] || 0)), 0);
  const refundedSoFar = Number(order?.refundedAmount || 0);
  const remainingRefundable = Math.max(0, Number(order?.total || 0) - refundedSoFar);

  const openRefund = () => {
    // Default to bringing back everything still outstanding: the common case is the whole
    // sale coming back, and a budtender then types down the one line that did.
    const seed: Record<string, number> = {};
    for (const it of (order?.items || [])) seed[it.id] = remainingOf(it);
    setRefundQty(seed);
    setRestock(true);
    setRefundMode('items');
    setRefundAmount('');
    setRefundReason('');
    setRefundOpen(true);
  };

  const handleRefund = async () => {
    const reason = refundReason.trim() || 'Refund requested by manager';
    const body: any = { reason };
    if (refundMode === 'amount') {
      const amt = Number(refundAmount);
      if (!(amt > 0)) { toast.error('Enter an amount to refund'); return; }
      if (amt > remainingRefundable + 0.005) { toast.error(`Only $${remainingRefundable.toFixed(2)} remains refundable`); return; }
      body.amount = amt;
    } else {
      // Units, with the shelf decision made explicitly: product that came back gets restocked,
      // product that was destroyed or kept does not.
      body.restoreInventory = restock;
      body.partialItems = orderItems
        .map((it) => ({ orderItemId: it.id, quantity: Math.min(remainingOf(it), Number(refundQty[it.id] || 0)) }))
        .filter((p) => p.quantity > 0);
      if (!body.partialItems.length && remainingUnits > 0) { toast.error('Choose at least one item to refund'); return; }
    }
    setRefunding(true);
    try {
      await api.post(`/api/orders/${id}/refund`, body);
      toast.success(refundMode === 'amount' ? 'Refund issued' : `Refunded ${selectedUnits} item${selectedUnits === 1 ? '' : 's'}${restock ? ' and returned them to inventory' : ''}`);
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

  // Settle the sale properly: POST /complete is the path that takes payment, moves the stock, marks
  // the order paid and awards loyalty. The status route only ever changed a word on the record.
  const handleComplete = async () => {
    setCompleting(true);
    try {
      await api.post(`/api/orders/${id}/complete`, {
        paymentMethod,
        // Only assert the check when the budtender actually ticked it — the server records who
        // verified, and a default of `true` would put a name against an ID nobody looked at.
        ...(idChecked ? { idVerified: true } : {}),
      });
      toast.success('Sale completed');
      loadOrder();
    } catch (err: any) {
      toast.error(err.message || 'Could not complete this sale');
    } finally {
      setCompleting(false);
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
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Order #{orderLabel(order)}
            </h1>
            <p className="text-gray-500 dark:text-slate-400">
              {order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}
              {order.customerName && ` — ${order.customerName}`}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2 dark:border-slate-700 dark:text-slate-200">
            <Printer className="w-4 h-4" /> Print Receipt
          </button>
          {/* Refund is only meaningful once money has been taken. It was offered on a PENDING, unpaid
              kiosk order, where pressing it can only produce a refusal — the server refuses anything
              that is not completed or partially refunded. Offer it where it can work. (T29 L4) */}
          {isManager && order.completedAt && order.status !== 'refunded' && order.status !== 'cancelled' && (
            <button
              onClick={openRefund}
              className="px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 font-medium flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Refund
            </button>
          )}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
        <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Order Status</h2>
        <div className="flex items-center gap-4">
          {statusSteps.map((step, idx) => {
            const isActive = idx <= currentStepIndex;
            const isCurrent = step === order.status;
            const Icon = statusIcons[step] || Clock;
            return (
              <div key={step} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-2 ${isActive ? 'text-green-600' : 'text-gray-500 dark:text-slate-400'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    isCurrent ? 'bg-green-700 text-white' : isActive ? 'bg-green-100' : 'bg-gray-100'
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
        {(order.status === 'pending' || order.status === 'processing' || order.status === 'ready') && (
          <div className="mt-4 space-y-3">
            {order.status === 'pending' && (
              <button
                onClick={() => handleStatusUpdate('processing')}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                Start Processing
              </button>
            )}

            {/* Taking the money. A kiosk order lands here already built and already age-gated by the
                tablet; the budtender still has to see the card and say how it was paid. */}
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300" htmlFor="order-payment-method">Payment</label>
                <select
                  id="order-payment-method"
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="cash">Cash</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {!order.idVerified && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={idChecked}
                    onChange={e => setIdChecked(e.target.checked)}
                    className="w-4 h-4 rounded text-green-600 focus:ring-green-500"
                  />
                  ID checked, 21+
                </label>
              )}

              <button
                onClick={handleComplete}
                disabled={completing}
                className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-sm hover:bg-green-800 disabled:opacity-50"
              >
                {completing ? 'Completing…' : 'Complete Sale'}
              </button>
            </div>

            {!order.idVerified && (
              <p className="text-xs text-gray-600 dark:text-slate-300">
                A cannabis sale cannot be completed until someone has checked the customer's ID.
                {order.customerDob ? ' The kiosk recorded a date of birth — check it against the card.' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Line Items */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm dark:bg-slate-900">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900 dark:text-slate-100">Line Items</h2>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Product</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(order.items || []).map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{item.productName || item.name}</p>
                    {item.strainType && (
                      <span className="text-xs text-gray-500 dark:text-slate-400">{item.strainType}</span>
                    )}
                    {/* What actually came back, on the line it came back from — the order page
                        showed no trace of a return, so a refund looked like it had done nothing. (T21 M10) */}
                    {Number(item.refundedQuantity || 0) > 0 && (
                      <span className="ml-2 text-xs font-medium text-red-600 dark:text-red-400">
                        {Number(item.refundedQuantity)} returned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700 dark:text-slate-200">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">${Number(item.unitPrice || item.price || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">
                    ${(Number(item.unitPrice || item.price || 0) * item.quantity).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-sm text-gray-600 dark:text-slate-400">Subtotal</td>
                <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-slate-100">${Number(order.subtotal || 0).toFixed(2)}</td>
              </tr>
              {/* The order stores excise_tax / sales_tax / total_tax (and tax_amount). This read
                  `order.tax`, which does not exist, so every detail page showed Tax $0.00 while
                  the total included $6.25 of tax (go-live QA M-2). */}
              {Number(order.exciseTax || 0) > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-sm text-gray-600 dark:text-slate-400">Excise Tax</td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-slate-200">${Number(order.exciseTax || 0).toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-sm text-gray-600 dark:text-slate-400">{Number(order.exciseTax || 0) > 0 ? 'Sales Tax' : 'Tax'}</td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-slate-200">
                  ${Number(Number(order.exciseTax || 0) > 0 ? (order.salesTax ?? (Number(order.totalTax ?? order.taxAmount ?? 0) - Number(order.exciseTax || 0))) : (order.totalTax ?? order.taxAmount ?? order.salesTax ?? order.tax ?? 0)).toFixed(2)}
                </td>
              </tr>
              {Number(order.discountAmount || 0) > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-sm text-green-600">Discount</td>
                  <td className="px-4 py-2 text-right text-green-600">-${Number(order.discountAmount).toFixed(2)}</td>
                </tr>
              )}
              {order.loyaltyDiscount > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-sm text-green-600">Loyalty Discount</td>
                  <td className="px-4 py-2 text-right text-green-600">-${Number(order.loyaltyDiscount).toFixed(2)}</td>
                </tr>
              )}
              <tr className="border-t-2">
                <td colSpan={3} className="px-4 py-3 text-right font-bold text-gray-900 dark:text-slate-100">Total</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900 text-lg dark:text-slate-100">${Number(order.total || 0).toFixed(2)}</td>
              </tr>
              {/* After a partial refund this page showed the returned units on their line and nothing
                  anywhere about the money — no refunded figure, no remaining balance. The one question
                  someone opens a refunded order to answer is "how much went back", and it was the one
                  thing not on the page. (Dispensary T29 L4) */}
              {refundedSoFar > 0 && (
                <>
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-right text-sm text-red-700 dark:text-red-300">Refunded</td>
                    <td className="px-4 py-2 text-right text-red-700 dark:text-red-300">−${refundedSoFar.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-slate-200">Kept</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-slate-100">${Math.max(0, Number(order.total || 0) - refundedSoFar).toFixed(2)}</td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>

        {/* Payment & Info */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Payment Details</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-slate-400">Method</span>
                <span className="capitalize font-medium text-gray-900 dark:text-slate-100">{order.paymentMethod || '—'}</span>
              </div>
              {/* Only once money has actually been taken. A pending cash order has tendered nothing, and
                  this block used to render anyway and RE-DERIVE the change as tendered − total, so an
                  unpaid $25 order read "Change $-25.00" — a figure the register can never produce, since
                  the server refuses an under-tender and stores change as never-negative. Read what was
                  stored rather than recomputing it, so there is one change rule and it lives at the till.
                  (Dispensary T23) */}
              {order.paymentMethod === 'cash' && (order.paymentStatus === 'paid' || order.cashTendered != null) && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-slate-400">Cash Tendered</span>
                    <span className="text-gray-900 dark:text-slate-100">${Number(order.cashTendered || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-slate-400">Change</span>
                    <span className="text-gray-900 dark:text-slate-100">${Number(order.changeDue || 0).toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-slate-400">Status</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  order.status === 'completed' ? 'bg-green-100 text-green-700' :
                  order.status === 'refunded' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {order.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-slate-400">Type</span>
                <span className="capitalize text-gray-900 dark:text-slate-100">{(order.type || 'walk_in').replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-slate-400">Processed by</span>
                {/* The endpoint resolves budtender_id to a name now; this read `processedBy || createdByName`
                    and the API returned neither, so every order said "—". A kiosk order has no budtender
                    until the register settles it, and that still says so rather than guessing. (T28 L-g) */}
                <span className="text-gray-900 dark:text-slate-100">{order.processedBy || (order.type === 'kiosk' ? 'Kiosk (not yet settled)' : '—')}</span>
              </div>
            </div>
          </div>

          {/* Customer — the page carried the name as a suffix on the heading and nothing else, so a sale
              that belonged to a real customer looked anonymous and there was no way to reach them from the
              order. Shown only when there is one: a walk-in is genuinely nobody. (T28 L-g) */}
          {(order.customer || order.customerName) && (
            <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
              <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Customer</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500 dark:text-slate-400">Name</span>
                  {order.customer?.id ? (
                    <button
                      onClick={() => navigate(`/crm/customers/${order.customer.id}`)}
                      className="text-green-700 hover:underline font-medium text-right dark:text-green-300"
                    >
                      {order.customerName || order.customer.name}
                    </button>
                  ) : (
                    <span className="text-gray-900 text-right dark:text-slate-100">{order.customerName}</span>
                  )}
                </div>
                {order.customer?.email && (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500 dark:text-slate-400">Email</span>
                    <a href={`mailto:${order.customer.email}`} className="text-gray-900 text-right break-all hover:underline dark:text-slate-100">{order.customer.email}</a>
                  </div>
                )}
                {order.customer?.phone && (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500 dark:text-slate-400">Phone</span>
                    <a href={`tel:${order.customer.phone}`} className="text-gray-900 text-right hover:underline dark:text-slate-100">{order.customer.phone}</a>
                  </div>
                )}
                {order.customer?.medicalCardNumber && (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500 dark:text-slate-400">Medical card</span>
                    <span className="font-mono text-gray-900 text-right dark:text-slate-100">{order.customer.medicalCardNumber}</span>
                  </div>
                )}
                {!order.customer && (
                  <p className="text-xs text-gray-500 dark:text-slate-400">Name taken at the till — this sale is not linked to a customer record.</p>
                )}
              </div>
            </div>
          )}

          {/* Audit Trail */}
          <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Audit Trail</h2>
            <div className="space-y-3">
              {auditLog.length > 0 ? auditLog.map((entry: any, idx: number) => (
                <div key={idx} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-400 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-gray-900 dark:text-slate-100">{entry.action || entry.description}</p>
                    <p className="text-gray-500 text-xs dark:text-slate-400">
                      {entry.userName || 'System'} — {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              )) : (
                <p className="text-gray-500 text-sm dark:text-slate-400">No audit entries</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Refund Modal — pick the units coming back, or refund a dollar amount instead. (T21 M10) */}
      <Modal
        isOpen={refundOpen}
        onClose={() => !refunding && setRefundOpen(false)}
        title={`Refund order #${orderLabel(order)}`}
        size="lg"
      >
        <div className="space-y-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRefundMode('items')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${refundMode === 'items' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'border-gray-300 text-gray-700 dark:border-slate-700 dark:text-slate-300'}`}
            >
              Return items
            </button>
            <button
              type="button"
              onClick={() => setRefundMode('amount')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${refundMode === 'amount' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'border-gray-300 text-gray-700 dark:border-slate-700 dark:text-slate-300'}`}
            >
              Refund an amount
            </button>
          </div>

          {refundMode === 'items' ? (
            <div className="space-y-3">
              {remainingUnits === 0 ? (
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  Every item on this order has already been returned. ${remainingRefundable.toFixed(2)} of money is still outstanding and will be refunded.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-gray-500 dark:text-slate-400">
                      <th className="text-left py-1">Item</th>
                      <th className="text-center py-1">Sold</th>
                      <th className="text-center py-1">Already back</th>
                      <th className="text-center py-1">Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {orderItems.map((item: any) => (
                      <tr key={item.id}>
                        <td className="py-2 text-gray-900 dark:text-slate-100">{item.productName || item.name}</td>
                        <td className="py-2 text-center text-gray-700 dark:text-slate-300">{item.quantity}</td>
                        <td className="py-2 text-center text-gray-700 dark:text-slate-300">{Number(item.refundedQuantity || 0)}</td>
                        <td className="py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={remainingOf(item)}
                            aria-label={`Quantity to refund for ${item.productName || item.name}`}
                            value={refundQty[item.id] ?? 0}
                            disabled={remainingOf(item) === 0}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(remainingOf(item), Math.floor(Number(e.target.value) || 0)));
                              setRefundQty((q) => ({ ...q, [item.id]: v }));
                            }}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-center dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {remainingUnits > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="rounded" />
                  Return these items to inventory
                </label>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Amount to refund</label>
              <input
                type="number"
                min={0}
                step="0.01"
                max={remainingRefundable}
                aria-label="Amount to refund"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-40 px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
              />
              <p className="text-xs text-gray-500 dark:text-slate-400">
                ${remainingRefundable.toFixed(2)} of the ${Number(order.total || 0).toFixed(2)} total remains refundable. Money only — the items stay sold and nothing returns to inventory.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Reason</label>
            <input
              type="text"
              aria-label="Reason"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Refund requested by manager"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setRefundOpen(false)} disabled={refunding}>Cancel</Button>
            <Button
              variant="danger"
              onClick={handleRefund}
              disabled={refunding || (refundMode === 'items' && remainingUnits > 0 && selectedUnits === 0)}
            >
              {refunding ? 'Processing…' : refundMode === 'amount' ? 'Process Refund' : `Refund ${selectedUnits} item${selectedUnits === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
