import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ruler, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
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

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await fetch(`/api/measurements?${params}`, { headers });
      const data = await res.json();
      setMeasurements(Array.isArray(data) ? data : data.data || []);
      setTotal(data.pagination?.total || data.total || (Array.isArray(data) ? data.length : 0));
    } catch {
      toast.error('Failed to load measurements');
    } finally {
      setLoading(false);
    }
  }, [page, token]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Measurements</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} reports</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Address</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Job #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Provider</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Squares</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Area (sqft)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Cost</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
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
                      onClick={() => m.jobId && navigate(`/crm/jobs/${m.jobId}`)}
                      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-900 max-w-[200px] truncate">{m.address || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">
                        {m.jobNumber || (m.jobId ? `ROOF-${String(m.jobId).padStart(4, '0')}` : '—')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{m.provider || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[m.status] || 'bg-gray-100 text-gray-600'}`}>
                          {formatStatus(m.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{m.totalSquares ?? m.squares ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {m.totalArea != null ? Number(m.totalArea).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {m.cost != null ? `$${Number(m.cost).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}
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
    </div>
  );
}
