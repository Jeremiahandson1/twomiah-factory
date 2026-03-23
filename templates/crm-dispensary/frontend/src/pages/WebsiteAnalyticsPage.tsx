import { useState, useEffect, useCallback } from 'react';
import { Calendar, Eye, Users, Clock, TrendingDown, Globe, Monitor, Smartphone, BarChart3, Activity } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';

const tabs = [
  { id: 'pages', label: 'Pages', icon: Globe },
  { id: 'traffic', label: 'Traffic Sources', icon: BarChart3 },
  { id: 'devices', label: 'Devices', icon: Monitor },
  { id: 'realtime', label: 'Realtime', icon: Activity },
];

export default function WebsiteAnalyticsPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('pages');
  const [dateRange, setDateRange] = useState({ start: getDefaultStart(), end: getToday() });
  const [kpis, setKpis] = useState<any>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  function getToday() {
    return new Date().toISOString().split('T')[0];
  }

  function getDefaultStart() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }

  const loadKPIs = useCallback(async () => {
    setKpiLoading(true);
    try {
      const data = await api.get('/api/website-analytics/overview', { startDate: dateRange.start, endDate: dateRange.end });
      setKpis(data);
    } catch {
      toast.error('Failed to load analytics');
    } finally {
      setKpiLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { loadKPIs(); }, [loadKPIs]);

  return (
    <div>
      <PageHeader title="Website Analytics" subtitle="Track visitors and engagement" />

      {/* Date Range Picker */}
      <div className="flex items-center gap-3 mb-6">
        <Calendar className="w-4 h-4 text-gray-500" />
        <input
          type="date"
          value={dateRange.start}
          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500 text-sm"
        />
        <span className="text-gray-400">to</span>
        <input
          type="date"
          value={dateRange.end}
          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500 text-sm"
        />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard icon={Eye} label="Total Page Views" value={kpis?.totalPageViews} loading={kpiLoading} />
        <KPICard icon={Users} label="Unique Sessions" value={kpis?.uniqueSessions} loading={kpiLoading} />
        <KPICard icon={Clock} label="Avg Session Duration" value={kpis?.avgSessionDuration || '--'} loading={kpiLoading} suffix="" />
        <KPICard icon={TrendingDown} label="Bounce Rate" value={kpis?.bounceRate != null ? `${kpis.bounceRate}%` : '--'} loading={kpiLoading} suffix="" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'pages' && <PagesTab dateRange={dateRange} />}
      {activeTab === 'traffic' && <TrafficTab dateRange={dateRange} />}
      {activeTab === 'devices' && <DevicesTab dateRange={dateRange} />}
      {activeTab === 'realtime' && <RealtimeTab />}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, loading, suffix }: any) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-400" />
        <p className="text-sm text-gray-500">{label}</p>
      </div>
      {loading ? (
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-gray-900">
          {typeof value === 'number' ? value.toLocaleString() : value ?? '--'}
          {suffix}
        </p>
      )}
    </div>
  );
}

/* ─── Pages Tab ─── */
function PagesTab({ dateRange }: { dateRange: { start: string; end: string } }) {
  const toast = useToast();
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/website-analytics/pages', { page, limit: 25, startDate: dateRange.start, endDate: dateRange.end });
      setPages(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load page analytics');
    } finally {
      setLoading(false);
    }
  }, [page, dateRange]);

  useEffect(() => { loadPages(); }, [loadPages]);

  const columns = [
    { key: 'path', label: 'Page', render: (val: string) => <span className="font-medium text-gray-900">{val}</span> },
    { key: 'views', label: 'Views', render: (val: number) => <span className="text-gray-700">{(val || 0).toLocaleString()}</span> },
    { key: 'uniqueSessions', label: 'Unique Sessions', render: (val: number) => <span className="text-gray-700">{(val || 0).toLocaleString()}</span> },
    {
      key: 'views', label: '', render: (val: number, row: any) => {
        const maxViews = Math.max(...pages.map(p => p.views || 0), 1);
        const width = Math.max(5, ((val || 0) / maxViews) * 100);
        return (
          <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-orange-400 rounded-full" style={{ width: `${width}%` }} />
          </div>
        );
      },
    },
  ];

  return <DataTable data={pages} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No page data" />;
}

/* ─── Traffic Tab ─── */
function TrafficTab({ dateRange }: { dateRange: { start: string; end: string } }) {
  const toast = useToast();
  const [referrers, setReferrers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/website-analytics/referrers', { startDate: dateRange.start, endDate: dateRange.end }),
      api.get('/api/website-analytics/campaigns', { startDate: dateRange.start, endDate: dateRange.end }),
    ]).then(([refData, campData]) => {
      setReferrers(Array.isArray(refData) ? refData : refData?.data || []);
      setCampaigns(Array.isArray(campData) ? campData : campData?.data || []);
    }).catch(() => {
      toast.error('Failed to load traffic data');
    }).finally(() => setLoading(false));
  }, [dateRange]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Referrers */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Referrer Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sessions</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {referrers.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No referrer data</td></tr>
              ) : referrers.map((ref, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{ref.source || 'Direct'}</td>
                  <td className="px-4 py-3 text-gray-700">{(ref.sessions || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">{ref.percentage != null ? `${ref.percentage}%` : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campaigns */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">UTM Campaign Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Campaign</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Medium</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No campaign data</td></tr>
              ) : campaigns.map((camp, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{camp.campaign || '--'}</td>
                  <td className="px-4 py-3 text-gray-700">{camp.source || '--'}</td>
                  <td className="px-4 py-3 text-gray-700">{camp.medium || '--'}</td>
                  <td className="px-4 py-3 text-gray-700">{(camp.sessions || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Devices Tab ─── */
function DevicesTab({ dateRange }: { dateRange: { start: string; end: string } }) {
  const toast = useToast();
  const [deviceData, setDeviceData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/api/website-analytics/devices', { startDate: dateRange.start, endDate: dateRange.end })
      .then(setDeviceData)
      .catch(() => toast.error('Failed to load device data'))
      .finally(() => setLoading(false));
  }, [dateRange]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderBreakdown = (title: string, icon: any, items: any[]) => {
    const total = items.reduce((sum, item) => sum + (item.count || 0), 0) || 1;
    const Icon = icon;
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon className="w-5 h-5 text-gray-400" />
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        {items.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No data</p>
        ) : (
          <div className="space-y-3">
            {items.map((item, i) => {
              const pct = Math.round(((item.count || 0) / total) * 100);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700">{item.name || 'Unknown'}</span>
                    <span className="text-gray-500">{pct}% ({(item.count || 0).toLocaleString()})</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      {renderBreakdown('Device Type', Monitor, deviceData?.deviceTypes || [])}
      {renderBreakdown('Browser', Globe, deviceData?.browsers || [])}
      {renderBreakdown('Operating System', Smartphone, deviceData?.operatingSystems || [])}
    </div>
  );
}

/* ─── Realtime Tab ─── */
function RealtimeTab() {
  const toast = useToast();
  const [realtime, setRealtime] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadRealtime = useCallback(async () => {
    try {
      const data = await api.get('/api/website-analytics/realtime');
      setRealtime(data);
    } catch {
      // Silently fail on refresh
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRealtime();
    const interval = setInterval(loadRealtime, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [loadRealtime]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Visitors */}
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
          <Activity className="w-8 h-8 text-green-600" />
        </div>
        <p className="text-5xl font-bold text-gray-900">{realtime?.activeVisitors ?? 0}</p>
        <p className="text-gray-500 mt-1">Active visitors right now</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-gray-400">Live</span>
        </div>
      </div>

      {/* Active Pages */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Active Pages</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Page</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Active Users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(!realtime?.activePages || realtime.activePages.length === 0) ? (
                <tr><td colSpan={2} className="px-4 py-8 text-center text-gray-500">No active pages</td></tr>
              ) : realtime.activePages.map((pg: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{pg.path}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-gray-700">{pg.count}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
