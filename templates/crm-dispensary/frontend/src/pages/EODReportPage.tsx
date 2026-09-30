import { useState, useEffect } from 'react';
import {
  FileText, Calendar, MapPin, DollarSign, Package, Shield, Users,
  Star, CheckCircle, Clock, AlertTriangle, Download, Eye
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTimeInZone } from '../utils/date';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  reviewed: 'bg-blue-100 text-blue-700',
  submitted: 'bg-green-100 text-green-700',
};

export default function EODReportPage() {
  const { user, isManager, company } = useAuth();
  // A drawer belongs to the shop's clock, like every other figure on this report. (T46 N16)
  const storeTz = (company as any)?.timeZone as string | undefined;
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
      await api.put(`/api/eod/${report.id}/review`, { checklist });
      toast.success('Marked as reviewed');
      setReport({ ...report, status: 'reviewed' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark reviewed');
    }
  };

  const submitReport = async () => {
    if (!report?.id) return;
    try {
      await api.put(`/api/eod/${report.id}/submit`, { checklist });
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

  // The server now reports the day's variance across every drawer; deriving it from two totals
  // here would lose the detail it computes per drawer. (T45 H18)
  const cashVariance = report
    ? (report.cashVariance != null ? Number(report.cashVariance) : (report.cashActual || 0) - (report.cashExpected || 0))
    : 0;
  const drawers: any[] = Array.isArray(report?.drawers) ? report.drawers : [];
  // A day can run several drawers. "Drawer open" only means nothing has been counted YET when
  // none of them has been — otherwise the counted ones still have a real figure to show.
  const countedDrawerCount = report?.countedDrawerCount ?? (report?.cashDrawerStatus === 'open' ? 0 : 1);
  const drawerOpen = countedDrawerCount === 0 && (report?.openDrawerCount ?? (report?.cashDrawerStatus === 'open' ? 1 : 0)) > 0;

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
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700 dark:text-green-300' : 'border-transparent text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-200'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Generate Tab */}
      {tab === 'generate' && (
        <div>
          {/* Date/Location Selector */}
          <div className="flex flex-wrap items-end gap-4 mb-6 bg-white border rounded-lg p-4 dark:bg-slate-900">
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
                  <div className="bg-white border rounded-lg p-4 dark:bg-slate-900">
                    <div className="text-sm text-gray-500 dark:text-slate-400">Total Orders</div>
                    <div className="text-2xl font-bold">{report.totalOrders || 0}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4 dark:bg-slate-900">
                    <div className="text-sm text-gray-500 dark:text-slate-400">Total Revenue</div>
                    <div className="text-2xl font-bold text-green-600">${(report.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4 dark:bg-slate-900">
                    <div className="text-sm text-gray-500 dark:text-slate-400">Cash</div>
                    <div className="text-xl font-bold">${(report.cashTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="bg-white border rounded-lg p-4 dark:bg-slate-900">
                    <div className="text-sm text-gray-500 dark:text-slate-400">Debit / ACH</div>
                    <div className="text-xl font-bold">${(report.debitTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>

              {/* Cash Reconciliation */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3">
                  <DollarSign className="w-5 h-5 text-yellow-600" />Cash Reconciliation
                  {report.cashDrawerStatus === 'closed' && (
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">Drawer closed — final at close</span>
                  )}
                  {report.cashDrawerStatus == null && (
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No drawer opened</span>
                  )}
                  {drawerOpen && (
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Drawer open — not yet counted</span>
                  )}
                  {drawers.length > 1 && (
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {drawers.length} drawers today
                    </span>
                  )}
                </h4>
                <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Expected</div>
                      <div className="text-xl font-bold">${Number(report.cashExpected || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Actual Count</div>
                      <div className="text-xl font-bold">{drawerOpen ? <span className="text-gray-500 dark:text-slate-400">—</span> : `$${Number(report.cashActual || 0).toFixed(2)}`}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Variance</div>
                      {drawerOpen ? (
                        <div className="text-xl font-bold text-gray-500 dark:text-slate-400">Pending count</div>
                      ) : (
                        <div className={`text-xl font-bold ${Math.abs(cashVariance) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                          {cashVariance >= 0 ? '+' : ''}${Number(cashVariance).toFixed(2)}
                          {Math.abs(cashVariance) > 5 && <AlertTriangle className="w-4 h-4 inline ml-1 text-red-500" />}
                        </div>
                      )}
                    </div>
                  </div>
                  {drawers.length > 1 && (
                    <div className="mt-5 border-t pt-4 dark:border-slate-700">
                      {/* Which drawer is short. The day total alone says there is $10 missing; this
                          says where to look. (T45 H18) */}
                      <div className="text-sm font-medium text-gray-600 mb-2 dark:text-slate-400">By drawer</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-slate-400">
                              <th className="py-1 pr-4 font-medium">Opened</th>
                              {/* A $10 shortfall on one of five drawers has to name somebody to ask
                                  about it. The rows carried times and amounts only. (T46 L-b) */}
                              <th className="py-1 pr-4 font-medium">Register</th>
                              <th className="py-1 pr-4 font-medium">Counted by</th>
                              <th className="py-1 pr-4 font-medium">Status</th>
                              <th className="py-1 pr-4 font-medium text-right">Expected</th>
                              <th className="py-1 pr-4 font-medium text-right">Counted</th>
                              <th className="py-1 font-medium text-right">Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drawers.map((d: any, i: number) => (
                              <tr key={i} className="border-t dark:border-slate-800">
                                <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{d.openedAt ? formatTimeInZone(d.openedAt, storeTz) : '—'}</td>
                                <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{d.register || '—'}</td>
                                <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{d.closedByName || d.openedByName || '—'}</td>
                                <td className="py-1.5 pr-4 text-gray-700 dark:text-slate-200">{d.status === 'open' ? 'Open' : 'Closed'}</td>
                                <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700 dark:text-slate-200">${Number(d.expected || 0).toFixed(2)}</td>
                                <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700 dark:text-slate-200">{d.counted == null ? '—' : `$${Number(d.counted).toFixed(2)}`}</td>
                                <td className={`py-1.5 text-right tabular-nums font-medium ${d.variance == null ? 'text-gray-500 dark:text-slate-400' : Math.abs(Number(d.variance)) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                                  {d.variance == null ? 'Pending' : `${Number(d.variance) >= 0 ? '+' : ''}$${Number(d.variance).toFixed(2)}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Money the day has not accounted for, and product the day has not handed over.
                  Both figures have been on the End of Day response since T47/T48 and neither was
                  on the report a manager actually closes the day with — "a day that balances
                  perfectly while three sales sit unsettled has not balanced" was the reason for
                  building them, and it needs a screen to be true. (T49 M1) */}
              {((report.unsettledSales || 0) > 0 || (report.awaitingCollection || 0) > 0) && (
                <div>
                  <h4 className="font-semibold flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />Still outstanding at close
                  </h4>
                  <div className="bg-white border rounded-lg p-5 space-y-5 dark:bg-slate-900 dark:border-slate-700">
                    {(report.unsettledSales || 0) > 0 && (
                      <div>
                        <div className="flex items-baseline justify-between gap-4">
                          <div>
                            <div className="text-sm text-gray-500 dark:text-slate-400">Sold, not paid for</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              Handed over and still owed — usually a cash sale rung up with no drawer open.
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-red-600 dark:text-red-400">
                              ${Number(report.unsettledTotal || 0).toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              {report.unsettledSales} {Number(report.unsettledSales) === 1 ? 'sale' : 'sales'}
                            </div>
                          </div>
                        </div>
                        {Array.isArray(report.unsettledOrders) && report.unsettledOrders.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {report.unsettledOrders.map((o: any, i: number) => (
                              <li key={o.id || o.number || i} className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-900/30 dark:text-red-200">
                                {o.number || o.id}{o.total != null ? ` · $${Number(o.total).toFixed(2)}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {(report.awaitingCollection || 0) > 0 && (
                      <div className={((report.unsettledSales || 0) > 0 ? 'border-t pt-5 dark:border-slate-700' : '')}>
                        <div className="flex items-baseline justify-between gap-4">
                          <div>
                            <div className="text-sm text-gray-500 dark:text-slate-400">Waiting to be collected</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              Ordered and not picked up. Deliberately NOT counted as missing money — it is product, not a shortfall.
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                              ${Number(report.awaitingCollectionTotal || 0).toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              {report.awaitingCollection} {Number(report.awaitingCollection) === 1 ? 'order' : 'orders'}
                            </div>
                          </div>
                        </div>
                        {Array.isArray(report.awaitingCollectionOrders) && report.awaitingCollectionOrders.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {report.awaitingCollectionOrders.map((o: any, i: number) => (
                              <li key={o.id || o.number || i} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                                {o.number || o.id}{o.total != null ? ` · $${Number(o.total).toFixed(2)}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Inventory */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Package className="w-5 h-5 text-blue-600" />Inventory</h4>
                <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Adjustments</div>
                      <div className="text-xl font-bold">{report.inventoryAdjustments || 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Shrinkage Value</div>
                      <div className={`text-xl font-bold ${(report.shrinkageValue || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ${Number(report.shrinkageValue || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compliance Checklist */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Shield className="w-5 h-5 text-purple-600" />Compliance Checklist</h4>
                <div className="bg-white border rounded-lg p-5 space-y-3 dark:bg-slate-900">
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
                <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Employees On Duty</div>
                      <div className="text-xl font-bold">{report.employeesOnDuty || 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Total Hours</div>
                      <div className="text-xl font-bold">{Number(report.totalHours || 0).toFixed(1)}h</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Tips Collected</div>
                      <div className="text-xl font-bold">${Number(report.tipsTotal || 0).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Loyalty */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-3"><Star className="w-5 h-5 text-yellow-500" />Loyalty</h4>
                <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Points Issued</div>
                      <div className="text-xl font-bold">{(report.pointsIssued || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">Points Redeemed</div>
                      <div className="text-xl font-bold">{(report.pointsRedeemed || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">New Members</div>
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
                    className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 font-medium">
                    <CheckCircle className="w-4 h-4" />Submit Report
                  </button>
                </div>
              )}
            </div>
          )}

          {!report && !generating && (
            <div className="text-center py-16 text-gray-500 dark:text-slate-400">
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
            <div className="text-center py-12 text-gray-500 dark:text-slate-400">No past reports</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Location</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Revenue</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Cash Variance</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Submitted By</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-slate-400">Actions</th>
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
                            {variance >= 0 ? '+' : ''}${Number(variance).toFixed(2)}
                            {Math.abs(variance) > 5 && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status] || STATUS_STYLES.draft}`}>
                            {r.status || 'draft'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">{r.submittedBy || '-'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => viewHistoricReport(r.id)}
                            className="text-green-600 hover:text-green-800 dark:hover:text-green-300 text-sm font-medium flex items-center gap-1">
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
