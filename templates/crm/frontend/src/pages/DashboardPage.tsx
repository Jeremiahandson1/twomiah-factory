import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import {
  Users, FolderKanban, Briefcase, FileText, Receipt, DollarSign,
  TrendingUp, Calendar, Clock, AlertCircle
} from 'lucide-react';

export default function DashboardPage() {
  const { user, company } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, activityData] = await Promise.all([
        api.dashboard.stats(),
        api.dashboard.recentActivity(),
      ]);
      setStats(statsData);
      setActivity(activityData);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: 'Contacts', value: stats?.contacts || 0, icon: Users, color: 'blue', link: '/contacts' },
    { label: 'Active Projects', value: stats?.projects?.byStatus?.active || 0, icon: FolderKanban, color: 'green', link: '/projects' },
    { label: 'Jobs Today', value: stats?.jobs?.today || 0, icon: Briefcase, color: 'purple', link: '/jobs' },
    { label: 'Pending Quotes', value: stats?.quotes?.pending || 0, icon: FileText, color: 'orange', link: '/quotes' },
    { label: 'Open Invoices', value: stats?.invoices?.outstanding || 0, icon: Receipt, color: 'red', link: '/invoices' },
    { label: 'Outstanding', value: `$${(stats?.invoices?.outstandingValue || 0).toLocaleString()}`, icon: DollarSign, color: 'emerald', link: '/invoices' },
  ];

  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.firstName}!</h1>
        <p className="text-gray-600">{company?.name} Dashboard</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={`w-10 h-10 rounded-lg ${colorClasses[stat.color]} flex items-center justify-center mb-3`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-sm text-gray-500">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Jobs */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Jobs</h2>
            <Link to="/jobs" className="text-sm text-orange-500 hover:text-orange-600">View all</Link>
          </div>
          <div className="divide-y">
            {activity?.recentJobs?.length > 0 ? activity.recentJobs.map((job) => (
              <div key={job.id} className="p-4">
                <p className="font-medium text-gray-900 truncate">{job.title}</p>
                <p className="text-sm text-gray-500">{job.number}</p>
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                  job.status === 'completed' ? 'bg-green-100 text-green-700' :
                  job.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {job.status.replace('_', ' ')}
                </span>
              </div>
            )) : (
              <p className="p-4 text-gray-500 text-sm">No recent jobs</p>
            )}
          </div>
        </div>

        {/* Recent Quotes */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Quotes</h2>
            <Link to="/quotes" className="text-sm text-orange-500 hover:text-orange-600">View all</Link>
          </div>
          <div className="divide-y">
            {activity?.recentQuotes?.length > 0 ? activity.recentQuotes.map((quote) => (
              <div key={quote.id} className="p-4">
                <p className="font-medium text-gray-900 truncate">{quote.name}</p>
                <p className="text-sm text-gray-500">{quote.number} • ${Number(quote.total).toLocaleString()}</p>
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                  quote.status === 'approved' ? 'bg-green-100 text-green-700' :
                  quote.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                  quote.status === 'rejected' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {quote.status}
                </span>
              </div>
            )) : (
              <p className="p-4 text-gray-500 text-sm">No recent quotes</p>
            )}
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Invoices</h2>
            <Link to="/invoices" className="text-sm text-orange-500 hover:text-orange-600">View all</Link>
          </div>
          <div className="divide-y">
            {activity?.recentInvoices?.length > 0 ? activity.recentInvoices.map((invoice) => (
              <div key={invoice.id} className="p-4">
                <p className="font-medium text-gray-900">{invoice.number}</p>
                <p className="text-sm text-gray-500">
                  ${Number(invoice.total).toLocaleString()}
                  {Number(invoice.balance) > 0 && (
                    <span className="text-orange-500"> (${Number(invoice.balance).toLocaleString()} due)</span>
                  )}
                </p>
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                  invoice.status === 'paid' ? 'bg-green-100 text-green-700' :
                  invoice.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                  invoice.status === 'overdue' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {invoice.status}
                </span>
              </div>
            )) : (
              <p className="p-4 text-gray-500 text-sm">No recent invoices</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
