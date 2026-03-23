import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle, XCircle, Clock, DollarSign, AlertTriangle, Settings,
  ShieldCheck, Percent, RotateCcw, Tag
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const TYPE_STYLES: Record<string, { bg: string; icon: any; label: string }> = {
  void: { bg: 'bg-red-100 text-red-700', icon: XCircle, label: 'Void' },
  discount: { bg: 'bg-orange-100 text-orange-700', icon: Percent, label: 'Discount' },
  refund: { bg: 'bg-purple-100 text-purple-700', icon: RotateCcw, label: 'Refund' },
  price_override: { bg: 'bg-blue-100 text-blue-700', icon: Tag, label: 'Price Override' },
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState('');
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const exp = new Date(expiresAt).getTime();
      const diff = exp - now;
      if (diff <= 0) {
        setTimeLeft('Expired');
        clearInterval(intervalRef.current);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs}s`);
    };
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => clearInterval(intervalRef.current);
  }, [expiresAt]);

  const isUrgent = timeLeft !== 'Expired' && parseInt(timeLeft) < 5;

  return (
    <span className={`text-xs font-mono ${timeLeft === 'Expired' ? 'text-gray-400' : isUrgent ? 'text-red-600 font-bold' : 'text-yellow-600'}`}>
      {timeLeft === 'Expired' ? 'Expired' : `Expires in ${timeLeft}`}
    </span>
  );
}

export default function ApprovalsPage() {
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);

  // Pending
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);

  // Config
  const [config, setConfig] = useState({
    voidsRequireApproval: true,
    discountThreshold: '10',
    refundsRequireApproval: true,
    priceOverridesRequireApproval: true,
    expirationMinutes: '15',
  });
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (tab === 'pending') loadPending();
    if (tab === 'history') loadHistory();
    if (tab === 'config') loadConfig();
  }, [tab, historyPage]);

  const loadPending = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/approvals', { status: 'pending' });
      setPendingRequests(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/approvals', { page: historyPage, limit: 25 });
      setHistory(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load approval history');
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/approvals/config');
      if (data) {
        setConfig({
          voidsRequireApproval: data.voidsRequireApproval ?? true,
          discountThreshold: String(data.discountThreshold ?? 10),
          refundsRequireApproval: data.refundsRequireApproval ?? true,
          priceOverridesRequireApproval: data.priceOverridesRequireApproval ?? true,
          expirationMinutes: String(data.expirationMinutes ?? 15),
        });
      }
    } catch (err) {
      toast.error('Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (id: string, action: 'approve' | 'reject') => {
    try {
      await api.post(`/api/approvals/${id}/${action}`);
      toast.success(`Request ${action}d`);
      loadPending();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} request`);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/approvals/config', {
        ...config,
        discountThreshold: parseFloat(config.discountThreshold) || 10,
        expirationMinutes: parseInt(config.expirationMinutes) || 15,
      });
      toast.success('Config saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  const tabs = [
    { id: 'pending', label: 'Pending', icon: Clock, count: pendingRequests.length },
    { id: 'history', label: 'History', icon: CheckCircle },
    { id: 'config', label: 'Config', icon: Settings },
  ];

  return (
    <div>
      <PageHeader title="Void / Discount Approvals" />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-green-400" />
              No pending approval requests
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingRequests.map(req => {
                const typeInfo = TYPE_STYLES[req.type] || TYPE_STYLES.void;
                const TypeIcon = typeInfo.icon;
                return (
                  <div key={req.id} className="border rounded-lg p-5 bg-white">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeInfo.bg}`}>
                          <TypeIcon className="w-3 h-3 inline mr-1" />{typeInfo.label}
                        </span>
                        {req.expiresAt && <CountdownTimer expiresAt={req.expiresAt} />}
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="text-2xl font-bold">${Number(req.amount || 0).toFixed(2)}</div>
                      <div className="text-sm text-gray-500">Requested by <span className="font-medium text-gray-700">{req.requesterName}</span></div>
                    </div>

                    {req.reason && (
                      <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-3">
                        <span className="font-medium">Reason:</span> {req.reason}
                      </div>
                    )}

                    {req.type === 'void' && req.orderDetails && (
                      <div className="text-sm text-gray-500 border-t pt-3 mb-3">
                        <div>Order #{req.orderDetails.orderNumber}</div>
                        <div>{req.orderDetails.items?.length || 0} items &middot; {req.orderDetails.customerName || 'Walk-in'}</div>
                      </div>
                    )}

                    {isManager && (
                      <div className="flex gap-2">
                        <button onClick={() => handleApproval(req.id, 'approve')}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
                          <CheckCircle className="w-4 h-4" />Approve
                        </button>
                        <button onClick={() => handleApproval(req.id, 'reject')}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
                          <XCircle className="w-4 h-4" />Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Requester</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Reason</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Reviewed By</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(req => {
                    const typeInfo = TYPE_STYLES[req.type] || TYPE_STYLES.void;
                    return (
                      <tr key={req.id} className="border-t">
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${typeInfo.bg}`}>{typeInfo.label}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">${Number(req.amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-sm">{req.requesterName}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{req.reason || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[req.status] || 'bg-gray-100 text-gray-700'}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{req.reviewerName || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{req.createdAt ? new Date(req.createdAt).toLocaleString() : '-'}</td>
                      </tr>
                    );
                  })}
                  {history.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-500">No approval history</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="max-w-lg">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Settings className="w-5 h-5" />Approval Settings</h3>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white border rounded-lg p-6 space-y-5">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-medium">Voids Require Approval</div>
                  <div className="text-sm text-gray-500">All void transactions need manager approval</div>
                </div>
                <div className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.voidsRequireApproval ? 'bg-green-500' : 'bg-gray-300'}`}
                  onClick={() => setConfig({ ...config, voidsRequireApproval: !config.voidsRequireApproval })}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.voidsRequireApproval ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>

              <div>
                <label className="block font-medium mb-1">Discount Threshold ($)</label>
                <div className="text-sm text-gray-500 mb-2">Discounts above this amount require approval</div>
                <input type="number" value={config.discountThreshold} onChange={e => setConfig({ ...config, discountThreshold: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-medium">Refunds Require Approval</div>
                  <div className="text-sm text-gray-500">All refund transactions need manager approval</div>
                </div>
                <div className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.refundsRequireApproval ? 'bg-green-500' : 'bg-gray-300'}`}
                  onClick={() => setConfig({ ...config, refundsRequireApproval: !config.refundsRequireApproval })}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.refundsRequireApproval ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-medium">Price Overrides Require Approval</div>
                  <div className="text-sm text-gray-500">Manual price changes need manager approval</div>
                </div>
                <div className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.priceOverridesRequireApproval ? 'bg-green-500' : 'bg-gray-300'}`}
                  onClick={() => setConfig({ ...config, priceOverridesRequireApproval: !config.priceOverridesRequireApproval })}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.priceOverridesRequireApproval ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>

              <div>
                <label className="block font-medium mb-1">Expiration (minutes)</label>
                <div className="text-sm text-gray-500 mb-2">Pending requests expire after this time</div>
                <input type="number" value={config.expirationMinutes} onChange={e => setConfig({ ...config, expirationMinutes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>

              <Button onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
