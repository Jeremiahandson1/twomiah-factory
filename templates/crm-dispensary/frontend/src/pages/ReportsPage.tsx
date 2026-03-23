import { useState, useEffect } from 'react';
import {
  BarChart3, PieChart, Table, Plus, Play, Eye, Trash2, RefreshCw,
  Calendar, ChevronDown, ChevronUp, ArrowUpDown, Users, DollarSign,
  TrendingUp, Award, X
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

export default function ReportsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);

  // Dashboard widgets
  const [widgets, setWidgets] = useState<any[]>([]);
  const [widgetModal, setWidgetModal] = useState(false);
  const [widgetForm, setWidgetForm] = useState({
    title: '',
    type: 'kpi',
    dataSource: '',
    config: '',
  });
  const [savingWidget, setSavingWidget] = useState(false);

  // Saved reports
  const [reports, setReports] = useState<any[]>([]);
  const [reportModal, setReportModal] = useState(false);
  const [reportForm, setReportForm] = useState({
    name: '',
    type: 'sales',
    metrics: '',
    dateRange: '30d',
    groupBy: 'day',
  });
  const [savingReport, setSavingReport] = useState(false);
  const [reportResults, setReportResults] = useState<any>(null);
  const [viewingReport, setViewingReport] = useState<any>(null);

  // Budtender performance
  const [budtenderData, setBudtenderData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState('30d');
  const [sortField, setSortField] = useState('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [reportsPage, setReportsPage] = useState(1);
  const [reportsPagination, setReportsPagination] = useState<any>(null);
  const [budtenderPage, setBudtenderPage] = useState(1);
  const [budtenderPagination, setBudtenderPagination] = useState<any>(null);

  useEffect(() => {
    if (tab === 'dashboard') loadWidgets();
    if (tab === 'saved') loadReports();
    if (tab === 'budtender') loadBudtenderPerformance();
  }, [tab, reportsPage, budtenderPage, dateRange, sortField, sortDir]);

  const loadWidgets = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/reports/widgets');
      setWidgets(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load widgets');
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/reports/saved', { page: reportsPage, limit: 20 });
      setReports(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setReportsPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load saved reports');
    } finally {
      setLoading(false);
    }
  };

  const loadBudtenderPerformance = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/reports/budtender-performance', {
        dateRange,
        sortBy: sortField,
        sortDir,
        page: budtenderPage,
        limit: 20,
      });
      setBudtenderData(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setBudtenderPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load budtender performance');
    } finally {
      setLoading(false);
    }
  };

  const handleAddWidget = async () => {
    if (!widgetForm.title.trim()) {
      toast.error('Widget title is required');
      return;
    }
    setSavingWidget(true);
    try {
      await api.post('/api/reports/widgets', {
        title: widgetForm.title,
        type: widgetForm.type,
        dataSource: widgetForm.dataSource,
        config: widgetForm.config ? JSON.parse(widgetForm.config) : {},
      });
      toast.success('Widget added');
      setWidgetModal(false);
      setWidgetForm({ title: '', type: 'kpi', dataSource: '', config: '' });
      loadWidgets();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add widget');
    } finally {
      setSavingWidget(false);
    }
  };

  const deleteWidget = async (widgetId: string) => {
    try {
      await api.delete(`/api/reports/widgets/${widgetId}`);
      toast.success('Widget removed');
      loadWidgets();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove widget');
    }
  };

  const handleCreateReport = async () => {
    if (!reportForm.name.trim()) {
      toast.error('Report name is required');
      return;
    }
    setSavingReport(true);
    try {
      await api.post('/api/reports/saved', {
        name: reportForm.name,
        type: reportForm.type,
        config: {
          metrics: reportForm.metrics.split(',').map(m => m.trim()).filter(Boolean),
          dateRange: reportForm.dateRange,
          groupBy: reportForm.groupBy,
        },
      });
      toast.success('Report created');
      setReportModal(false);
      setReportForm({ name: '', type: 'sales', metrics: '', dateRange: '30d', groupBy: 'day' });
      loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create report');
    } finally {
      setSavingReport(false);
    }
  };

  const runReport = async (report: any) => {
    setViewingReport(report);
    setReportResults(null);
    try {
      const data = await api.post(`/api/reports/saved/${report.id}/run`);
      setReportResults(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to run report');
    }
  };

  const deleteReport = async (reportId: string) => {
    try {
      await api.delete(`/api/reports/saved/${reportId}`);
      toast.success('Report deleted');
      loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete report');
    }
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-400" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-green-600" />
      : <ChevronDown className="w-3 h-3 text-green-600" />;
  };

  const widgetTypeIcons: Record<string, any> = {
    kpi: DollarSign,
    chart: BarChart3,
    table: Table,
    pie: PieChart,
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'saved', label: 'Saved Reports', icon: Table },
    { id: 'budtender', label: 'Budtender Performance', icon: Users },
  ];

  const dateRangeOptions = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'ytd', label: 'Year to date' },
    { value: 'all', label: 'All time' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600">Custom reports and business intelligence</p>
        </div>
        <button
          onClick={() => {
            if (tab === 'dashboard') loadWidgets();
            if (tab === 'saved') loadReports();
            if (tab === 'budtender') loadBudtenderPerformance();
          }}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
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

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setWidgetForm({ title: '', type: 'kpi', dataSource: '', config: '' }); setWidgetModal(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Widget
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {widgets.map(widget => {
                const Icon = widgetTypeIcons[widget.type] || BarChart3;
                return (
                  <div key={widget.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b flex items-center justify-between bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-green-600" />
                        <h3 className="font-medium text-gray-900 text-sm">{widget.title}</h3>
                      </div>
                      <button
                        onClick={() => deleteWidget(widget.id)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="p-5">
                      {widget.type === 'kpi' ? (
                        <div>
                          <p className="text-3xl font-bold text-gray-900">{widget.value ?? '--'}</p>
                          {widget.change != null && (
                            <p className={`text-sm mt-1 ${widget.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {widget.change >= 0 ? '+' : ''}{widget.change}% vs prior period
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-32 flex items-center justify-center">
                          <p className="text-sm text-gray-400 capitalize">{widget.type} chart area</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {widgets.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No widgets yet</p>
                  <p className="text-sm mt-1">Add widgets to build your custom dashboard</p>
                </div>
              )}
            </div>
          )}

          {/* Add Widget Modal */}
          <Modal isOpen={widgetModal} onClose={() => setWidgetModal(false)} title="Add Dashboard Widget">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={widgetForm.title}
                  onChange={e => setWidgetForm({ ...widgetForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Revenue This Month"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={widgetForm.type}
                  onChange={e => setWidgetForm({ ...widgetForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                >
                  <option value="kpi">KPI (Single Value)</option>
                  <option value="chart">Bar/Line Chart</option>
                  <option value="pie">Pie Chart</option>
                  <option value="table">Table</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data Source</label>
                <input
                  type="text"
                  value={widgetForm.dataSource}
                  onChange={e => setWidgetForm({ ...widgetForm, dataSource: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="e.g., orders, revenue, products"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Config (JSON, optional)</label>
                <textarea
                  value={widgetForm.config}
                  onChange={e => setWidgetForm({ ...widgetForm, config: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  rows={3}
                  placeholder='{"dateRange": "30d", "metric": "total"}'
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setWidgetModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
              <Button onClick={handleAddWidget} disabled={savingWidget}>
                {savingWidget ? 'Adding...' : 'Add Widget'}
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Saved Reports */}
      {tab === 'saved' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setReportForm({ name: '', type: 'sales', metrics: '', dateRange: '30d', groupBy: 'day' }); setReportModal(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Create Report
            </Button>
          </div>

          {/* Report results viewer */}
          {viewingReport && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6 overflow-hidden">
              <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{viewingReport.name} - Results</h3>
                <button onClick={() => { setViewingReport(null); setReportResults(null); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                {reportResults ? (
                  <div>
                    {reportResults.summary && (
                      <div className="grid md:grid-cols-4 gap-4 mb-4">
                        {Object.entries(reportResults.summary).map(([key, value]: [string, any]) => (
                          <div key={key} className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</p>
                            <p className="text-lg font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : String(value)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {reportResults.rows && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              {Object.keys(reportResults.rows[0] || {}).map(col => (
                                <th key={col} className="text-left px-3 py-2 font-medium text-gray-700 capitalize">{col.replace(/_/g, ' ')}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {reportResults.rows.map((row: any, idx: number) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                {Object.values(row).map((val: any, cIdx: number) => (
                                  <td key={cIdx} className="px-3 py-2 text-gray-600">{typeof val === 'number' ? val.toLocaleString() : String(val ?? '--')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {!reportResults.rows && !reportResults.summary && (
                      <p className="text-gray-500 text-center py-4">Report returned no data</p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24">
                    <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(report => (
                <div key={report.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{report.name}</h3>
                    <p className="text-sm text-gray-500">
                      Type: {report.type || '--'} | Created: {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : '--'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runReport(report)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Run
                    </button>
                    <button
                      onClick={() => deleteReport(report.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {reports.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Table className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No saved reports</p>
                  <p className="text-sm mt-1">Create a report to get started</p>
                </div>
              )}
            </div>
          )}

          {reportsPagination && reportsPagination.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-600">Page {reportsPagination.page} of {reportsPagination.pages}</p>
              <div className="flex gap-2">
                <button onClick={() => setReportsPage(p => Math.max(1, p - 1))} disabled={reportsPage <= 1} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Previous</button>
                <button onClick={() => setReportsPage(p => p + 1)} disabled={reportsPage >= reportsPagination.pages} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Next</button>
              </div>
            </div>
          )}

          {/* Create Report Modal */}
          <Modal isOpen={reportModal} onClose={() => setReportModal(false)} title="Create Report">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Report Name *</label>
                <input
                  type="text"
                  value={reportForm.name}
                  onChange={e => setReportForm({ ...reportForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Weekly Sales Summary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={reportForm.type}
                  onChange={e => setReportForm({ ...reportForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                >
                  <option value="sales">Sales</option>
                  <option value="inventory">Inventory</option>
                  <option value="customers">Customers</option>
                  <option value="compliance">Compliance</option>
                  <option value="loyalty">Loyalty</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Metrics (comma-separated)</label>
                <input
                  type="text"
                  value={reportForm.metrics}
                  onChange={e => setReportForm({ ...reportForm, metrics: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="revenue, orders, avg_order_value"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
                  <select
                    value={reportForm.dateRange}
                    onChange={e => setReportForm({ ...reportForm, dateRange: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                  >
                    {dateRangeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group By</label>
                  <select
                    value={reportForm.groupBy}
                    onChange={e => setReportForm({ ...reportForm, groupBy: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="category">Category</option>
                    <option value="budtender">Budtender</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setReportModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
              <Button onClick={handleCreateReport} disabled={savingReport}>
                {savingReport ? 'Creating...' : 'Create Report'}
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Budtender Performance */}
      {tab === 'budtender' && (
        <div>
          {/* Date range filter */}
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-4 h-4 text-gray-500" />
            <div className="flex gap-1">
              {dateRangeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setDateRange(opt.value); setBudtenderPage(1); }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap ${
                    dateRange === opt.value
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Name</th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-700 cursor-pointer select-none"
                        onClick={() => toggleSort('orders')}
                      >
                        <span className="inline-flex items-center gap-1">Orders <SortIcon field="orders" /></span>
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-700 cursor-pointer select-none"
                        onClick={() => toggleSort('revenue')}
                      >
                        <span className="inline-flex items-center gap-1">Revenue <SortIcon field="revenue" /></span>
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-700 cursor-pointer select-none"
                        onClick={() => toggleSort('avgOrder')}
                      >
                        <span className="inline-flex items-center gap-1">Avg Order <SortIcon field="avgOrder" /></span>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Top Category</th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-700 cursor-pointer select-none"
                        onClick={() => toggleSort('tips')}
                      >
                        <span className="inline-flex items-center gap-1">Tips <SortIcon field="tips" /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {budtenderData.map(bt => (
                      <tr key={bt.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                              {(bt.name || 'B')[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-900">{bt.name || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 font-medium">{bt.orders ?? 0}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-bold">${Number(bt.revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right text-gray-600">${Number(bt.avgOrder || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{bt.topCategory || '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-600">${Number(bt.tips || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                    {budtenderData.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                          <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          No budtender data for this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {budtenderPagination && budtenderPagination.pages > 1 && (
                <div className="px-4 py-3 border-t flex items-center justify-between">
                  <p className="text-sm text-gray-600">Page {budtenderPagination.page} of {budtenderPagination.pages}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setBudtenderPage(p => Math.max(1, p - 1))} disabled={budtenderPage <= 1} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => setBudtenderPage(p => p + 1)} disabled={budtenderPage >= budtenderPagination.pages} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
