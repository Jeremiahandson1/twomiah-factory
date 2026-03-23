import { useState, useEffect } from 'react';
import {
  FileText, Calendar, MapPin, DollarSign, Package, Shield, Users,
  Star, CheckCircle, Clock, AlertTriangle, Download, Eye
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  reviewed: 'bg-blue-100 text-blue-700',
  submitted: 'bg-green-100 text-green-700',
};

export default function EODReportPage() {
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('generate');
  const [loading, setLoading] = useState(false);

  // Generate
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  // Compliance checklist
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  // History
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    loadLocations();
    if (tab === 'history') loadHistory();
  }, [tab]);

  const loadLocations = async () => {
    try {
      const data = await api.get('/api/locations', { limit: 50 });
      const locs = Array.isArray(data) ? data : data?.data || [];
      setLocations(locs);
      if (locs.length > 0 && !locationId) setLocationId(locs[0].id);
    } catch (err) {
      // Locations may not be configured
    }
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/eod', { limit: 30 });
      setHistory(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    if (!reportDate) { toast.error('Select a date'); return; }
    setGenerating(true);
    setReport(null);
    try {
      const data = await api.post('/api/eod/generate', { date: reportDate, locationId: locationId || undefined });
      setReport(data);
      // Initialize checklist
      const items: Record<string, boolean> = {};
      (data?.complianceChecklist || []).forEach((item: any) => { items[item.id] = item.checked || false; });
      setChecklist(items);
      toast.success('Report generated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const markReviewed = async () => {
    if (!report?.id) return;
    try {
      await api.post(`/api/eod/${report.id}/review`, { checklist });
      toast.success('Marked as reviewed');
      setReport({ ...report, status: 'reviewed' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark reviewed');
    }
  };

  const submitReport = async () => {
    if (!report?.id) return;
    try {
      await api.post(`/api/eod/${report.id}/submit`, { checklist });
      toast.success('Report submitted');
      setReport({ ...report, status: 'submitted' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit report');
    }
  };

  const viewHistoricReport = async (id: string) => {
    try {
      const data = await api.get(`/api/eod/${id}`);
      setReport(data);
      setTab('generate');
      const items: Record<string, boolean> = {};
      (data?.complianceChecklist || []).forEach((item: any) => { items[item.id] = item.checked || false; });
      setChecklist(items);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load report');
    }
  };

  const cashVariance = report ? (report.cashActual || 0) - (report.cashExpected || 0) : 0;

  const tabs = [
    { id: 'generate', label: 'Generate Report', icon: FileText },
    { id: 'history', label: 'History', icon: Clock },
  ];

  return (
    <div>
      <PageHeader title="End-of-Day Reconciliation" />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Generate Tab */}
      {tab === 'generate' && (
        <div>
          {/* Date/Location Selector */}
          <div className="flex flex-wrap items-end gap-4 mb-6 bg-white border rounded-lg p-4">
            <div>
              <label className="block text-sm font-medium mb-1"><Calendar className="w-3 h-3 inline mr-1" />Date</label>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                className="px-3 py-2 border rounded-lg" />
            </div>
            {locations.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1"><MapPin className="w-3 h-3 inline mr-1" />Location</label>
                <select value={locationId} onChange={e => setLocationId(e.target.value)}
                  className="px-3 py-2 border rounded-lg">
                  <option value="">All Locations</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
            <Button onClick={generateReport} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Report'}
            </Button>
          </div>

          {/* Report Display */}
          {report && (
            <div className="space-y-6">
              {/* Status badge */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">EOD Report &mdash; {report.date || reportDate}</h3>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${STATUS_STYLES[report.status] || STATUS_STYLES.draft}`}>
                  {report.status || 'draft'}
                </span>
              </div>

              {/* Sales Summary */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><DollarSign className="w-5 h-5 text-green-600" />Sales Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white border rounded-lg p-4">
                    <div className="text-sm text-gray-500">Total Orders</div>
                    <div className="text-2xl font-bold">{report.totalOrders || 0}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <div className="text-sm text-gray-500">Total Revenue</div>
                    <div className="text-2xl font-bold text-green-600">${(report.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <div className="text-sm text-gray-500">Cash</div>
                    <div className="text-xl font-bold">${(report.cashTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <div className="text-sm text-gray-500">Debit / ACH</div>
                    <div className="text-xl font-bold">${(report.debitTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>

              {/* Cash Reconciliation */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><DollarSign className="w-5 h-5 text-yellow-600" />Cash Reconciliation</h4>
                <div className="bg-white border rounded-lg p-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Expected</div>
                      <div className="text-xl font-bold">${(report.cashExpected || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Actual Count</div>
                      <div className="text-xl font-bold">${(report.cashActual || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Variance</div>
                      <div className={`text-xl font-bold ${Math.abs(cashVariance) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                        {cashVariance >= 0 ? '+' : ''}${cashVariance.toFixed(2)}
                        {Math.abs(cashVariance) > 5 && <AlertTriangle className="w-4 h-4 inline ml-1 text-red-500" />}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Inventory */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Package className="w-5 h-5 text-blue-600" />Inventory</h4>
                <div className="bg-white border rounded-lg p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Adjustments</div>
                      <div className="text-xl font-bold">{report.inventoryAdjustments || 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Shrinkage Value</div>
                      <div className={`text-xl font-bold ${(report.shrinkageValue || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ${(report.shrinkageValue || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compliance Checklist */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Shield className="w-5 h-5 text-purple-600" />Compliance Checklist</h4>
                <div className="bg-white border rounded-lg p-5 space-y-3">
                  {(report.complianceChecklist || [
                    { id: 'id_check', label: 'All IDs verified for every transaction' },
                    { id: 'camera_check', label: 'Security cameras operational all day' },
                    { id: 'metrc_sync', label: 'METRC/BioTrack packages reconciled' },
                    { id: 'waste_log', label: 'Waste/destruction log updated' },
                    { id: 'safe_count', label: 'Safe count completed' },
                    { id: 'visitor_log', label: 'Visitor log reviewed' },
                  ]).map((item: any) => (
                    <label key={item.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input type="checkbox" checked={checklist[item.id] || false}
                        onChange={e => setChecklist({ ...checklist, [item.id]: e.target.checked })}
                        disabled={report.status === 'submitted'}
                        className="rounded text-green-600 w-4 h-4" />
                      <span className="text-sm">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Staff */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Users className="w-5 h-5 text-indigo-600" />Staff</h4>
                <div className="bg-white border rounded-lg p-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Employees On Duty</div>
                      <div className="text-xl font-bold">{report.employeesOnDuty || 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Total Hours</div>
                      <div className="text-xl font-bold">{(report.totalHours || 0).toFixed(1)}h</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Tips Collected</div>
                      <div className="text-xl font-bold">${(report.tipsTotal || 0).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Loyalty */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Star className="w-5 h-5 text-yellow-500" />Loyalty</h4>
                <div className="bg-white border rounded-lg p-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Points Issued</div>
                      <div className="text-xl font-bold">{(report.pointsIssued || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Points Redeemed</div>
                      <div className="text-xl font-bold">{(report.pointsRedeemed || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">New Members</div>
                      <div className="text-xl font-bold">{report.newLoyaltyMembers || 0}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sign-off */}
              {report.status !== 'submitted' && isManager && (
                <div className="flex gap-3 pt-4 border-t">
                  {report.status !== 'reviewed' && (
                    <Button onClick={markReviewed}>
                      <Eye className="w-4 h-4 mr-2 inline" />Mark Reviewed
                    </Button>
                  )}
                  <button onClick={submitReport}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
                    <CheckCircle className="w-4 h-4" />Submit Report
                  </button>
                </div>
              )}
            </div>
          )}

          {!report && !generating && (
            <div className="text-center py-16 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              Select a date and generate your end-of-day report
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
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No past reports</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Location</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Revenue</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Cash Variance</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Submitted By</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => {
                    const variance = (r.cashActual || 0) - (r.cashExpected || 0);
                    return (
                      <tr key={r.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">{r.date}</td>
                        <td className="px-4 py-3 text-sm">{r.locationName || 'All'}</td>
                        <td className="px-4 py-3 text-sm font-medium">${(r.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={Math.abs(variance) > 5 ? 'text-red-600 font-medium' : 'text-green-600'}>
                            {variance >= 0 ? '+' : ''}${variance.toFixed(2)}
                            {Math.abs(variance) > 5 && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status] || STATUS_STYLES.draft}`}>
                            {r.status || 'draft'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{r.submittedBy || '-'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => viewHistoricReport(r.id)}
                            className="text-green-600 hover:text-green-800 text-sm font-medium flex items-center gap-1">
                            <Eye className="w-3 h-3" />View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
