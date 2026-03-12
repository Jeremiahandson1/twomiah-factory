import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ruler, ChevronLeft, ChevronRight, Plus, X, RefreshCw, CreditCard, AlertTriangle, CheckCircle, Loader2, Edit3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const QUALITY_COLORS: Record<string, string> = {
  HIGH: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-red-100 text-red-700',
  MANUAL: 'bg-gray-100 text-gray-600',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MeasurementsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [measurements, setMeasurements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [pricePerReport, setPricePerReport] = useState('9.00');

  // Order modal
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ address: '', city: '', state: '', zip: '', jobId: '' });
  const [ordering, setOrdering] = useState(false);

  // Detail view
  const [selectedReport, setSelectedReport] = useState<any>(null);

  // Manual entry
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSquares, setManualSquares] = useState('');

  // Buy credits
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyQty, setBuyQty] = useState(10);
  const [buying, setBuying] = useState(false);

  const limit = 25;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const loadCredits = useCallback(async () => {
    try {
      const res = await fetch('/api/measurements/credits/info', { headers });
      if (res.ok) {
        const data = await res.json();
        setCredits(data.credits);
        setPricePerReport(data.pricePerReport || '9.00');
      }
    } catch { /* ignore */ }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await fetch(`/api/measurements?${params}`, { headers });
      const data = await res.json();
      setMeasurements(data.data || []);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast.error('Failed to load measurements');
    } finally {
      setLoading(false);
    }
  }, [page, token]);

  useEffect(() => { load(); loadCredits(); }, [load, loadCredits]);

  const totalPages = Math.ceil(total / limit) || 1;

  const orderReport = async () => {
    if (!orderForm.address || !orderForm.city || !orderForm.state || !orderForm.zip) {
      toast.error('Address fields are required');
      return;
    }
    setOrdering(true);
    try {
      const res = await fetch('/api/measurements/order', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(orderForm),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Failed to order report');
        return;
      }
      toast.success('Measurement report ordered! Processing...');
      setOrderOpen(false);
      setOrderForm({ address: '', city: '', state: '', zip: '', jobId: '' });
      load();
      loadCredits();
    } catch {
      toast.error('Failed to order report');
    } finally {
      setOrdering(false);
    }
  };

  const regenerateReport = async (reportId: string) => {
    try {
      const res = await fetch(`/api/measurements/${reportId}/regenerate`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error();
      toast.success('Regeneration started');
      load();
    } catch {
      toast.error('Failed to regenerate');
    }
  };

  const saveManualEntry = async (reportId: string) => {
    const sq = parseFloat(manualSquares);
    if (!sq || sq <= 0) { toast.error('Enter valid squares'); return; }
    try {
      const res = await fetch(`/api/measurements/${reportId}/manual`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalSquares: sq }),
      });
      if (!res.ok) throw new Error();
      toast.success('Manual measurements saved');
      setManualOpen(false);
      setManualSquares('');
      setSelectedReport(null);
      load();
    } catch {
      toast.error('Failed to save');
    }
  };

  const purchaseCredits = async () => {
    setBuying(true);
    try {
      const res = await fetch('/api/measurements/credits/purchase', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: buyQty }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCredits(data.credits);
      toast.success(data.message);
      setBuyOpen(false);
    } catch {
      toast.error('Failed to purchase credits');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Measurements</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} reports</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Credits badge */}
            {credits !== null && (
              <button
                onClick={() => setBuyOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border rounded-lg text-sm hover:bg-gray-50"
              >
                <CreditCard className="w-4 h-4 text-gray-400" />
                <span className="font-medium">{credits}</span>
                <span className="text-gray-500">credits</span>
              </button>
            )}
            <button
              onClick={() => setOrderOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
            >
              <Plus className="w-4 h-4" /> Order Report
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Address</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Quality</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Squares</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Area (sqft)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Cost</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : measurements.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400">No measurement reports found</td></tr>
                ) : (
                  measurements.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedReport(m)}
                      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-900 max-w-[200px] truncate">
                        {m.address}, {m.city}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[m.status] || 'bg-gray-100 text-gray-600'}`}>
                          {m.status === 'processing' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                          {formatStatus(m.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {m.imageryQuality && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${QUALITY_COLORS[m.imageryQuality] || 'bg-gray-100 text-gray-600'}`}>
                            {m.imageryQuality}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 font-medium">{m.totalSquares ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {m.totalArea != null ? Number(m.totalArea).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {m.cost != null ? `$${Number(m.cost).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {m.status === 'failed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); regenerateReport(m.id); }}
                            className="text-blue-600 hover:text-blue-800"
                            title="Retry"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Order Modal ── */}
      {orderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOrderOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Order Measurement Report</h2>
              <button onClick={() => setOrderOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {credits !== null && credits <= 0 && (
              <div className="flex items-start gap-2 p-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>No credits remaining. <button onClick={() => { setOrderOpen(false); setBuyOpen(true); }} className="underline font-medium">Purchase credits</button> to order reports.</span>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Street Address *</label>
                <input value={orderForm.address} onChange={(e) => setOrderForm({ ...orderForm, address: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="1234 Main St" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">City *</label>
                  <input value={orderForm.city} onChange={(e) => setOrderForm({ ...orderForm, city: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">State *</label>
                  <input value={orderForm.state} onChange={(e) => setOrderForm({ ...orderForm, state: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Zip *</label>
                  <input value={orderForm.zip} onChange={(e) => setOrderForm({ ...orderForm, zip: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Link to Job (optional)</label>
                <input value={orderForm.jobId} onChange={(e) => setOrderForm({ ...orderForm, jobId: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="Job ID" />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">Uses 1 credit (${pricePerReport}/report). Powered by Google Solar API.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOrderOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={orderReport} disabled={ordering || (credits !== null && credits <= 0)} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                <Ruler className="w-4 h-4" /> {ordering ? 'Ordering...' : 'Order Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Report Detail Modal ── */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedReport(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Measurement Report</h2>
              <button onClick={() => setSelectedReport(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              {/* Status + quality */}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[selectedReport.status] || 'bg-gray-100 text-gray-600'}`}>
                  {selectedReport.status === 'processing' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                  {formatStatus(selectedReport.status)}
                </span>
                {selectedReport.imageryQuality && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${QUALITY_COLORS[selectedReport.imageryQuality] || ''}`}>
                    {selectedReport.imageryQuality} Quality
                  </span>
                )}
              </div>

              {/* Low quality warning */}
              {selectedReport.imageryQuality === 'LOW' && selectedReport.status === 'complete' && (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Low quality imagery</p>
                    <p className="text-xs mt-0.5">Satellite data for this area is limited. Consider entering measurements manually for more accurate results.</p>
                    <button onClick={() => { setManualOpen(true); setManualSquares(selectedReport.totalSquares || ''); }} className="flex items-center gap-1 mt-2 text-xs font-medium text-yellow-900 underline">
                      <Edit3 className="w-3 h-3" /> Enter manually
                    </button>
                  </div>
                </div>
              )}

              {/* Address */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Address</p>
                  <p className="font-medium text-gray-900">{selectedReport.address}</p>
                  <p className="text-gray-600">{selectedReport.city}, {selectedReport.state} {selectedReport.zip}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Imagery Date</p>
                  <p className="font-medium text-gray-900">{selectedReport.imageryDate || '—'}</p>
                </div>
              </div>

              {/* Totals */}
              {selectedReport.status === 'complete' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-purple-700">{selectedReport.totalSquares || '—'}</p>
                    <p className="text-xs text-purple-600">Total Squares</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{selectedReport.totalArea ? Number(selectedReport.totalArea).toLocaleString() : '—'}</p>
                    <p className="text-xs text-blue-600">Total Sqft</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-700">{Array.isArray(selectedReport.segments) ? selectedReport.segments.length : '—'}</p>
                    <p className="text-xs text-gray-600">Segments</p>
                  </div>
                </div>
              )}

              {/* Segments table */}
              {Array.isArray(selectedReport.segments) && selectedReport.segments.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Roof Segments</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium text-xs">Segment</th>
                        <th className="pb-2 font-medium text-xs text-right">Area (sqft)</th>
                        <th className="pb-2 font-medium text-xs text-right">Pitch</th>
                        <th className="pb-2 font-medium text-xs text-right">Azimuth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.segments.map((seg: any, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1.5 text-gray-900">{seg.name}</td>
                          <td className="py-1.5 text-right text-gray-600">{Number(seg.area).toLocaleString()}</td>
                          <td className="py-1.5 text-right text-gray-600">{seg.pitch}</td>
                          <td className="py-1.5 text-right text-gray-600">{seg.azimuthDegrees != null ? `${seg.azimuthDegrees}°` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {selectedReport.status === 'failed' && (
                  <button onClick={() => { regenerateReport(selectedReport.id); setSelectedReport(null); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                )}
                {selectedReport.jobId && (
                  <button onClick={() => { setSelectedReport(null); navigate(`/crm/jobs/${selectedReport.jobId}`); }} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    View Job
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual Entry Modal ── */}
      {manualOpen && selectedReport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setManualOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Manual Measurement Entry</h2>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Total Squares</label>
              <input type="number" step="0.01" value={manualSquares} onChange={(e) => setManualSquares(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="e.g. 24.5" />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setManualOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={() => saveManualEntry(selectedReport.id)} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Buy Credits Modal ── */}
      {buyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBuyOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Purchase Credits</h2>
              <button onClick={() => setBuyOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">Each credit = 1 measurement report. ${pricePerReport} per report.</p>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Quantity</label>
              <div className="flex gap-2">
                {[5, 10, 25, 50].map((q) => (
                  <button
                    key={q}
                    onClick={() => setBuyQty(q)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${buyQty === q ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p className="text-sm font-medium text-gray-900 mt-3">
                Total: ${(buyQty * Number(pricePerReport)).toFixed(2)}
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setBuyOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={purchaseCredits} disabled={buying} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                <CreditCard className="w-4 h-4" /> {buying ? 'Processing...' : 'Purchase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
