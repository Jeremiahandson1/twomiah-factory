import { useState, useEffect } from 'react';
import { 
  DollarSign, Briefcase, FolderKanban, FileText, TrendingUp, TrendingDown,
  Users, Clock, AlertCircle, CheckCircle, Loader2, Calendar, ArrowUpRight
} from 'lucide-react';
import api from '../../services/api';

export default function ReportsDashboard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [monthlyRevenue, setMonthlyRevenue] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [teamData, setTeamData] = useState([]);
  const [dateRange, setDateRange] = useState('30');

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [dashboard, monthly, customers, team] = await Promise.all([
        api.get('/api/reports/dashboard'),
        api.get('/api/reports/revenue/monthly?months=6'),
        api.get('/api/reports/revenue/customers?limit=5'),
        api.get('/api/reports/team'),
      ]);
      
      setData(dashboard);
      setMonthlyRevenue(monthly);
      setTopCustomers(customers);
      setTeamData(team);
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Failed to load reports
      </div>
    );
  }

  const { revenue, jobs, projects, quotes, recentActivity } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Last {dateRange} days overview</p>
        </div>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue Collected"
          value={`$${revenue.collected.toLocaleString()}`}
          subtitle={`$${revenue.invoiced.toLocaleString()} invoiced`}
          icon={DollarSign}
          color="green"
          trend={revenue.collectionRate}
          trendLabel="collection rate"
        />
        <MetricCard
          title="Outstanding"
          value={`$${revenue.outstanding.toLocaleString()}`}
          subtitle={`$${revenue.overdue.toLocaleString()} overdue`}
          icon={AlertCircle}
          color="orange"
          alert={revenue.overdueCount > 0}
        />
        <MetricCard
          title="Jobs Completed"
          value={jobs.completed}
          subtitle={`${jobs.total} total jobs`}
          icon={Briefcase}
          color="blue"
          trend={jobs.completionRate}
          trendLabel="completion rate"
        />
        <MetricCard
          title="Quote Conversion"
          value={`${quotes.conversionRate}%`}
          subtitle={`${quotes.approved} of ${quotes.total} approved`}
          icon={FileText}
          color="purple"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Revenue Trend</h3>
          <RevenueChart data={monthlyRevenue} />
        </div>

        {/* Job Status */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Job Status</h3>
          <JobStatusChart jobs={jobs} />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Customers */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Top Customers</h3>
          <div className="space-y-3">
            {topCustomers.length === 0 ? (
              <p className="text-gray-500 text-sm">No data yet</p>
            ) : (
              topCustomers.map((customer, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium">
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{customer.contact?.name || 'Unknown'}</p>
                      <p className="text-xs text-gray-500">{customer.invoiceCount} invoices</p>
                    </div>
                  </div>
                  <span className="font-medium text-gray-900">${customer.total.toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Team Productivity */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Team Productivity</h3>
          <div className="space-y-3">
            {teamData.length === 0 ? (
              <p className="text-gray-500 text-sm">No time entries yet</p>
            ) : (
              teamData.slice(0, 5).map((member, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                      <Users className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">
                        {member.user?.firstName} {member.user?.lastName}
                      </p>
                      <p className="text-xs text-gray-500">{member.jobsCompleted} jobs completed</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900">{member.hoursWorked}h</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recentActivity.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  item.type === 'invoice' ? 'bg-green-100' :
                  item.type === 'job' ? 'bg-blue-100' : 'bg-purple-100'
                }`}>
                  {item.type === 'invoice' ? <DollarSign className="w-4 h-4 text-green-600" /> :
                   item.type === 'job' ? <Briefcase className="w-4 h-4 text-blue-600" /> :
                   <FileText className="w-4 h-4 text-purple-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.type === 'invoice' ? `Invoice ${item.number}` :
                     item.type === 'job' ? item.title :
                     `Quote ${item.number}`}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  item.status === 'paid' || item.status === 'completed' || item.status === 'approved'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Project Summary */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Project Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-3xl font-bold text-gray-900">{projects.total}</p>
            <p className="text-sm text-gray-500">Total Projects</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-3xl font-bold text-green-600">{projects.active}</p>
            <p className="text-sm text-gray-500">Active</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <p className="text-3xl font-bold text-blue-600">{projects.completed}</p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <p className="text-3xl font-bold text-orange-600">${(projects.totalValue / 1000).toFixed(0)}k</p>
            <p className="text-sm text-gray-500">Total Value</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, color, trend, trendLabel, alert }) {
  const colors = {
    green: 'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div className={`bg-white rounded-xl border p-5 ${alert ? 'border-orange-300' : ''}`}>
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-sm ${trend >= 50 ? 'text-green-600' : 'text-orange-600'}`}>
            {trend >= 50 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>{trend}%</span>
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{subtitle}</p>
        {trendLabel && <p className="text-xs text-gray-400 mt-1">{trendLabel}</p>}
      </div>
    </div>
  );
}

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-gray-400">No data</div>;
  }

  const maxValue = Math.max(...data.map(d => Math.max(d.invoiced, d.collected)));
  
  return (
    <div className="h-48">
      <div className="flex items-end justify-between h-40 gap-2">
        {data.map((month, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-1 items-end h-32">
              <div 
                className="flex-1 bg-blue-200 rounded-t"
                style={{ height: `${(month.invoiced / maxValue) * 100}%` }}
                title={`Invoiced: $${month.invoiced.toLocaleString()}`}
              />
              <div 
                className="flex-1 bg-green-500 rounded-t"
                style={{ height: `${(month.collected / maxValue) * 100}%` }}
                title={`Collected: $${month.collected.toLocaleString()}`}
              />
            </div>
            <span className="text-xs text-gray-500">
              {new Date(month.month + '-01').toLocaleDateString('en-US', { month: 'short' })}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-200 rounded" />
          <span className="text-xs text-gray-500">Invoiced</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span className="text-xs text-gray-500">Collected</span>
        </div>
      </div>
    </div>
  );
}

function JobStatusChart({ jobs }) {
  const statuses = [
    { key: 'scheduled', label: 'Scheduled', color: 'bg-blue-500' },
    { key: 'inProgress', label: 'In Progress', color: 'bg-yellow-500' },
    { key: 'completed', label: 'Completed', color: 'bg-green-500' },
    { key: 'cancelled', label: 'Cancelled', color: 'bg-gray-400' },
  ];

  const total = jobs.total || 1;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="h-4 bg-gray-100 rounded-full overflow-hidden flex">
        {statuses.map(status => {
          const count = jobs[status.key] || jobs.byStatus?.[status.key.replace(/([A-Z])/g, '_$1').toLowerCase()] || 0;
          const percent = (count / total) * 100;
          return percent > 0 ? (
            <div 
              key={status.key}
              className={`${status.color} transition-all`}
              style={{ width: `${percent}%` }}
              title={`${status.label}: ${count}`}
            />
          ) : null;
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-3">
        {statuses.map(status => {
          const count = jobs[status.key] || jobs.byStatus?.[status.key.replace(/([A-Z])/g, '_$1').toLowerCase()] || 0;
          return (
            <div key={status.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded ${status.color}`} />
                <span className="text-sm text-gray-600">{status.label}</span>
              </div>
              <span className="font-medium text-gray-900">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
