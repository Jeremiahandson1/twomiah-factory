import { useState, useEffect } from 'react';
import { FileText, Calendar, DollarSign, RefreshCw, Plus, Eye, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const filingStatusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  amended: 'bg-purple-100 text-purple-700',
};

export default function TaxFilingPage() {
  const toast = useToast();
  const [tab, setTab] = useState('filings');

  // Filings
  const [filings, setFilings] = useState<any[]>([]);
  const [loadingFilings, setLoadingFilings] = useState(true);
  const [generateModal, setGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState({ type: 'state_excise', period: 'monthly', startDate: '', endDate: '' });
  const [generating, setGenerating] = useState(false);

  // Detail
  const [detailModal, setDetailModal] = useState(false);
  const [detailFiling, setDetailFiling] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Upcoming
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [loadingDeadlines, setLoadingDeadlines] = useState(true);

  // Summary
  const [summary, setSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    if (tab === 'filings') loadFilings();
    if (tab === 'upcoming') loadDeadlines();
    if (tab === 'summary') loadSummary();
  }, [tab]);

  const loadFilings = async () => {
    setLoadingFilings(true);
    try {
      const data = await api.get('/api/tax/filings');
      setFilings(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load filings');
    } finally {
      setLoadingFilings(false);
    }
  };

  const loadDeadlines = async () => {
    setLoadingDeadlines(true);
    try {
      const data = await api.get('/api/tax/deadlines');
      setDeadlines(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load deadlines');
    } finally {
      setLoadingDeadlines(false);
    }
  };

  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      const data = await api.get('/api/tax/summary');
      setSummary(data);
    } catch (err) {
      toast.error('Failed to load tax summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleGenerate = async () => {
    if (!generateForm.startDate || !generateForm.endDate) {
      toast.error('Date range is required');
      return;
    }
    setGenerating(true);
    try {
      await api.post('/api/tax/filings/generate', generateForm);
      toast.success('Filing generated');
      setGenerateModal(false);
      setGenerateForm({ type: 'state_excise', period: 'monthly', startDate: '', endDate: '' });
      loadFilings();
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate filing');
    } finally {
      setGenerating(false);
    }
  };

  const viewDetail = async (filing: any) => {
    setDetailFiling(filing);
    setDetailModal(true);
    setDetailLoading(true);
    try {
      const data = await api.get(`/api/tax/filings/${filing.id}`);
      setDetailFiling(data);
    } catch (err) {
      toast.error('Failed to load filing detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const tabs = [
    { id: 'filings', label: 'Filings', icon: FileText },
    { id: 'upcoming', label: 'Upcoming', icon: Calendar },
    { id: 'summary', label: 'Summary', icon: DollarSign },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Filing</h1>
          <p className="text-gray-600">Automated cannabis tax filing and reporting</p>
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

      {/* Filings Tab */}
      {tab === 'filings' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => setGenerateModal(true)}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Generate Filing
            </Button>
          </div>

          {loadingFilings ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date Range</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filings.map(filing => (
                    <tr key={filing.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {(filing.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{filing.period || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {filing.startDate ? new Date(filing.startDate).toLocaleDateString() : '—'} - {filing.endDate ? new Date(filing.endDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {filing.totalAmount != null ? `$${Number(filing.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${filingStatusColors[filing.status] || 'bg-gray-100 text-gray-600'}`}>
                          {filing.status || 'draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => viewDetail(filing)} className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1 ml-auto">
                          <Eye className="w-3 h-3" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filings.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No tax filings yet</p>
                        <p className="text-sm mt-1">Generate your first filing to get started</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Upcoming Tab */}
      {tab === 'upcoming' && (
        <div>
          {loadingDeadlines ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {deadlines.map((deadline, i) => {
                const dueDate = new Date(deadline.dueDate);
                const daysUntil = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
                const isOverdue = daysUntil < 0;
                const isUrgent = daysUntil >= 0 && daysUntil <= 7;

                return (
                  <div key={deadline.id || i} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isOverdue ? 'bg-red-100' : isUrgent ? 'bg-orange-100' : 'bg-green-100'
                      }`}>
                        <Calendar className={`w-5 h-5 ${isOverdue ? 'text-red-600' : isUrgent ? 'text-orange-600' : 'text-green-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {(deadline.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </p>
                        <p className="text-sm text-gray-500">{deadline.description || deadline.period || '—'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">{dueDate.toLocaleDateString()}</p>
                      <p className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : isUrgent ? 'text-orange-600' : 'text-gray-500'}`}>
                        {isOverdue ? `${Math.abs(daysUntil)} days overdue` : daysUntil === 0 ? 'Due today' : `${daysUntil} days left`}
                      </p>
                    </div>
                  </div>
                );
              })}
              {deadlines.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No upcoming deadlines</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <div>
          {loadingSummary ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* YTD Stats */}
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-green-600" />
                    </div>
                    <p className="text-sm text-gray-500">Total Collected (YTD)</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    ${Number(summary?.totalCollected || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="text-sm text-gray-500">Total Filed (YTD)</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    ${Number(summary?.totalFiled || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                    </div>
                    <p className="text-sm text-gray-500">Outstanding</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    ${Number(summary?.outstanding || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Chart placeholder */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="font-semibold text-gray-900 mb-4">Tax Collection Trends</h3>
                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center text-gray-400">
                    <DollarSign className="w-12 h-12 mx-auto mb-2" />
                    <p className="text-sm">Chart visualization will be displayed here</p>
                  </div>
                </div>
              </div>

              {/* Breakdown */}
              {summary?.breakdown && Array.isArray(summary.breakdown) && summary.breakdown.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
                  <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-gray-900">Tax Breakdown by Type</h3>
                  </div>
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tax Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Filed</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.breakdown.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{row.type || '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-700">${Number(row.collected || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">${Number(row.filed || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-medium text-orange-600">${Number(row.outstanding || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Generate Filing Modal */}
      <Modal
        isOpen={generateModal}
        onClose={() => setGenerateModal(false)}
        title="Generate Tax Filing"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Filing Type</label>
            <select
              value={generateForm.type}
              onChange={(e) => setGenerateForm({ ...generateForm, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="state_excise">State Excise Tax</option>
              <option value="local_excise">Local Excise Tax</option>
              <option value="sales_tax">Sales Tax</option>
              <option value="city_tax">City Tax</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
            <select
              value={generateForm.period}
              onChange={(e) => setGenerateForm({ ...generateForm, period: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
              <input
                type="date"
                value={generateForm.startDate}
                onChange={(e) => setGenerateForm({ ...generateForm, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
              <input
                type="date"
                value={generateForm.endDate}
                onChange={(e) => setGenerateForm({ ...generateForm, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setGenerateModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : 'Generate'}
          </Button>
        </div>
      </Modal>

      {/* Filing Detail Modal */}
      <Modal
        isOpen={detailModal}
        onClose={() => setDetailModal(false)}
        title="Filing Detail"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : detailFiling ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Type</p>
                <p className="font-medium text-gray-900">{(detailFiling.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</p>
              </div>
              <div>
                <p className="text-gray-500">Status</p>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${filingStatusColors[detailFiling.status] || 'bg-gray-100 text-gray-600'}`}>
                  {detailFiling.status || 'draft'}
                </span>
              </div>
              <div>
                <p className="text-gray-500">Period</p>
                <p className="font-medium text-gray-900 capitalize">{detailFiling.period}</p>
              </div>
              <div>
                <p className="text-gray-500">Total Amount</p>
                <p className="font-medium text-gray-900">
                  ${Number(detailFiling.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Line items */}
            {detailFiling.lineItems && Array.isArray(detailFiling.lineItems) && detailFiling.lineItems.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Line Items</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {detailFiling.lineItems.map((item: any, i: number) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-700">{item.description || item.name || `Item ${i + 1}`}</td>
                          <td className="px-3 py-2 text-right text-gray-900">${Number(item.amount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
        <div className="flex justify-end mt-6">
          <button onClick={() => setDetailModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Close</button>
        </div>
      </Modal>
    </div>
  );
}
