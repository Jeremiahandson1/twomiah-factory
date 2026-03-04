import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ClipboardList, CheckCircle, XCircle, Clock, Loader2, PenTool, AlertTriangle } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';
import { SignatureModal, SignatureDisplay } from '../common/SignaturePad';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function PortalChangeOrders() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [changeOrders, setChangeOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadChangeOrders() {
      try {
        const data = await portalFetch('/change-orders');
        setChangeOrders(data);
      } catch (error) {
        console.error('Failed to load change orders:', error);
      } finally {
        setLoading(false);
      }
    }
    loadChangeOrders();
  }, [portalFetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const pendingOrders = changeOrders.filter(co => co.status === 'pending');
  const otherOrders = changeOrders.filter(co => co.status !== 'pending');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Change Orders</h1>
        <p className="text-gray-600">Review and approve change orders for your projects.</p>
      </div>

      {changeOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No change orders.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending */}
          {pendingOrders.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Awaiting Your Approval ({pendingOrders.length})
              </h2>
              <div className="space-y-3">
                {pendingOrders.map((co) => (
                  <ChangeOrderCard key={co.id} changeOrder={co} token={token} highlight />
                ))}
              </div>
            </div>
          )}

          {/* Other */}
          {otherOrders.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">All Change Orders</h2>
              <div className="space-y-3">
                {otherOrders.map((co) => (
                  <ChangeOrderCard key={co.id} changeOrder={co} token={token} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeOrderCard({ changeOrder, token, highlight }) {
  const isAddition = Number(changeOrder.amount) > 0;

  return (
    <Link
      to={`/portal/${token}/change-orders/${changeOrder.id}`}
      className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all ${
        highlight ? 'border-orange-300 ring-2 ring-orange-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isAddition ? 'bg-red-100' : 'bg-green-100'}`}>
            <ClipboardList className={`w-5 h-5 ${isAddition ? 'text-red-600' : 'text-green-600'}`} />
          </div>
          <div>
            <p className="font-medium text-gray-900">{changeOrder.title || changeOrder.number}</p>
            <p className="text-sm text-gray-500">
              {changeOrder.number} • {changeOrder.project?.name}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold ${isAddition ? 'text-red-600' : 'text-green-600'}`}>
            {isAddition ? '+' : '-'}${Math.abs(Number(changeOrder.amount)).toLocaleString()}
          </p>
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[changeOrder.status]}`}>
            {changeOrder.status}
          </span>
        </div>
      </div>
    </Link>
  );
}

// Change Order detail page
export function PortalChangeOrderDetail() {
  const { token, changeOrderId } = useParams();
  const { fetch: portalFetch, contact } = usePortal();
  const [changeOrder, setChangeOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  useEffect(() => {
    async function loadChangeOrder() {
      try {
        const data = await portalFetch(`/change-orders/${changeOrderId}`);
        setChangeOrder(data);
      } catch (error) {
        console.error('Failed to load change order:', error);
      } finally {
        setLoading(false);
      }
    }
    loadChangeOrder();
  }, [portalFetch, changeOrderId]);

  const handleApprove = async (signatureData) => {
    setActionLoading(true);
    setShowSignatureModal(false);
    try {
      await portalFetch(`/change-orders/${changeOrderId}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          signature: signatureData.signature,
          signedBy: signatureData.signedBy,
        }),
      });
      setChangeOrder({ 
        ...changeOrder, 
        status: 'approved',
        signature: signatureData.signature,
        signedBy: signatureData.signedBy,
        approvedAt: signatureData.signedAt,
      });
    } catch (error) {
      alert('Failed to approve: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Please provide a reason for rejection (optional):');
    
    setActionLoading(true);
    try {
      await portalFetch(`/change-orders/${changeOrderId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setChangeOrder({ ...changeOrder, status: 'rejected' });
    } catch (error) {
      alert('Failed to reject: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!changeOrder) {
    return <div className="text-center py-12 text-gray-500">Change order not found.</div>;
  }

  const canRespond = changeOrder.status === 'pending';
  const isAddition = Number(changeOrder.amount) > 0;

  return (
    <div>
      <Link to={`/portal/${token}/change-orders`} className="text-orange-600 hover:underline text-sm mb-4 inline-block">
        ← Back to Change Orders
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{changeOrder.title || changeOrder.number}</h1>
              <p className="text-gray-500">{changeOrder.number}</p>
              {changeOrder.project && (
                <p className="text-sm text-gray-500 mt-1">
                  Project: {changeOrder.project.name}
                </p>
              )}
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[changeOrder.status]}`}>
              {changeOrder.status}
            </span>
          </div>
        </div>

        {/* Amount banner */}
        <div className={`p-6 ${isAddition ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className={`w-6 h-6 ${isAddition ? 'text-red-600' : 'text-green-600'}`} />
            <div>
              <p className="text-sm text-gray-600">
                {isAddition ? 'This change order will ADD to your project cost' : 'This change order will REDUCE your project cost'}
              </p>
              <p className={`text-2xl font-bold ${isAddition ? 'text-red-600' : 'text-green-600'}`}>
                {isAddition ? '+' : '-'}${Math.abs(Number(changeOrder.amount)).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="p-6 border-b">
          <h3 className="font-medium text-gray-900 mb-2">Description</h3>
          <p className="text-gray-700 whitespace-pre-wrap">
            {changeOrder.description || 'No description provided.'}
          </p>
        </div>

        {/* Reason */}
        {changeOrder.reason && (
          <div className="p-6 border-b">
            <h3 className="font-medium text-gray-900 mb-2">Reason for Change</h3>
            <p className="text-gray-700">{changeOrder.reason}</p>
          </div>
        )}

        {/* Schedule impact */}
        {changeOrder.scheduleImpact && (
          <div className="p-6 border-b">
            <h3 className="font-medium text-gray-900 mb-2">Schedule Impact</h3>
            <p className="text-gray-700">{changeOrder.scheduleImpact}</p>
          </div>
        )}

        {/* Actions */}
        {canRespond && (
          <div className="p-6 bg-orange-50 border-t">
            <p className="text-sm text-gray-600 mb-4">
              Please review this change order carefully. Your signature is required to approve.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSignatureModal(true)}
                disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <PenTool className="w-4 h-4" />
                Sign & Approve
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Approved with signature */}
        {changeOrder.status === 'approved' && (
          <div className="p-6 bg-green-50 border-t">
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-medium text-green-800">
                  Approved on {new Date(changeOrder.approvedAt).toLocaleDateString()}
                </p>
                {changeOrder.signature && (
                  <div className="mt-3">
                    <SignatureDisplay 
                      signature={changeOrder.signature}
                      signedBy={changeOrder.signedBy || changeOrder.approvedBy}
                      signedAt={changeOrder.approvedAt}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rejected */}
        {changeOrder.status === 'rejected' && (
          <div className="p-6 bg-red-50 border-t">
            <div className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              <span className="font-medium">
                Rejected{changeOrder.rejectedAt && ` on ${new Date(changeOrder.rejectedAt).toLocaleDateString()}`}
              </span>
            </div>
            {changeOrder.rejectionReason && (
              <p className="mt-2 text-sm text-red-600">Reason: {changeOrder.rejectionReason}</p>
            )}
          </div>
        )}
      </div>

      {/* Signature Modal */}
      <SignatureModal
        isOpen={showSignatureModal}
        onClose={() => setShowSignatureModal(false)}
        onSave={handleApprove}
        title="Approve Change Order"
        signerName={contact?.name || ''}
      />
    </div>
  );
}
