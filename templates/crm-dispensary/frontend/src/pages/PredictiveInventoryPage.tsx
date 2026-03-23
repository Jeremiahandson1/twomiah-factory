import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Package, AlertTriangle, CheckCircle, RefreshCw, BarChart3, ShoppingCart, XCircle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';

const urgencyColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};

function daysUntilStockoutColor(days: number): string {
  if (days < 3) return 'text-red-600 font-bold';
  if (days < 7) return 'text-orange-600 font-semibold';
  if (days < 14) return 'text-yellow-600 font-medium';
  return 'text-green-600';
}

export default function PredictiveInventoryPage() {
  const toast = useToast();
  const [tab, setTab] = useState('forecasts');
  const [forecasts, setForecasts] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningForecast, setRunningForecast] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);

  useEffect(() => {
    if (tab === 'forecasts') loadForecasts();
    if (tab === 'reorder') loadSuggestions();
    if (tab === 'trends') loadTrends();
  }, [tab]);

  const loadForecasts = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/inventory/forecasts');
      setForecasts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load forecasts');
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/inventory/reorder-suggestions');
      const items = Array.isArray(data) ? data : data?.data || [];
      setSuggestions(items);
      setApprovedCount(items.filter((s: any) => s.approved).length);
    } catch (err) {
      toast.error('Failed to load reorder suggestions');
    } finally {
      setLoading(false);
    }
  };

  const loadTrends = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/inventory/trends');
      setTrends(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load trends');
    } finally {
      setLoading(false);
    }
  };

  const runForecast = async () => {
    setRunningForecast(true);
    try {
      await api.post('/api/inventory/forecasts/run');
      toast.success('Forecast generated');
      loadForecasts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to run forecast');
    } finally {
      setRunningForecast(false);
    }
  };

  const handleApproveSuggestion = async (id: string) => {
    try {
      await api.put(`/api/inventory/reorder-suggestions/${id}/approve`);
      toast.success('Reorder approved');
      loadSuggestions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    }
  };

  const handleDismissSuggestion = async (id: string) => {
    try {
      await api.put(`/api/inventory/reorder-suggestions/${id}/dismiss`);
      toast.success('Suggestion dismissed');
      loadSuggestions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to dismiss');
    }
  };

  const tabs = [
    { id: 'forecasts', label: 'Forecasts', icon: BarChart3 },
    { id: 'reorder', label: 'Reorder Suggestions', icon: ShoppingCart },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Predictive Inventory</h1>
          <p className="text-gray-600">AI-powered stock forecasting and reorder recommendations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Forecasts Tab */}
      {tab === 'forecasts' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={runForecast} disabled={runningForecast}>
              <RefreshCw className={`w-4 h-4 mr-2 inline ${runningForecast ? 'animate-spin' : ''}`} />
              {runningForecast ? 'Running...' : 'Run Forecast'}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Daily Avg Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days Until Stockout</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Suggested Reorder</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {forecasts.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{f.productName || f.product || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{f.currentStock ?? 0}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{Number(f.dailyAvgSales || 0).toFixed(1)}</td>
                      <td className={`px-4 py-3 text-right ${daysUntilStockoutColor(f.daysUntilStockout ?? 999)}`}>
                        {f.daysUntilStockout != null ? f.daysUntilStockout : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{f.suggestedReorderQty ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{f.confidence ? `${Math.round(f.confidence * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                  {forecasts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No forecasts available</p>
                        <p className="text-sm mt-1">Click "Run Forecast" to generate predictions</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reorder Suggestions Tab */}
      {tab === 'reorder' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              <CheckCircle className="w-4 h-4 inline mr-1 text-green-500" />
              {approvedCount} approved
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Urgency</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reorder Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {suggestions.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.productName || s.product || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${urgencyColors[s.urgency] || 'bg-gray-100 text-gray-600'}`}>
                          {s.urgency || 'normal'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{s.currentStock ?? 0}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{s.reorderQty ?? '—'}</td>
                      <td className="px-4 py-3">
                        {s.approved ? (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Approved
                          </span>
                        ) : s.dismissed ? (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Dismissed
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-600">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!s.approved && !s.dismissed && (
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => handleApproveSuggestion(s.id)}
                              className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleDismissSuggestion(s.id)}
                              className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {suggestions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No reorder suggestions at this time</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {tab === 'trends' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Top Movers */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  Top Movers
                </h3>
                <div className="space-y-3">
                  {trends.filter(t => t.trend === 'up' || t.velocity === 'high').slice(0, 10).map((t, i) => (
                    <div key={t.id || i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-400 w-6">#{i + 1}</span>
                        <span className="text-sm font-medium text-gray-900">{t.productName || t.product}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-green-500" />
                        <span className="text-sm text-green-600 font-medium">
                          {t.dailySales ? `${Number(t.dailySales).toFixed(1)}/day` : t.velocity || '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {trends.filter(t => t.trend === 'up' || t.velocity === 'high').length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No trending products</p>
                  )}
                </div>
              </div>

              {/* Declining Products */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  Declining Products
                </h3>
                <div className="space-y-3">
                  {trends.filter(t => t.trend === 'down' || t.velocity === 'low').slice(0, 10).map((t, i) => (
                    <div key={t.id || i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-400 w-6">#{i + 1}</span>
                        <span className="text-sm font-medium text-gray-900">{t.productName || t.product}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingDown className="w-3 h-3 text-red-500" />
                        <span className="text-sm text-red-600 font-medium">
                          {t.dailySales ? `${Number(t.dailySales).toFixed(1)}/day` : t.velocity || '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {trends.filter(t => t.trend === 'down' || t.velocity === 'low').length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No declining products</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
