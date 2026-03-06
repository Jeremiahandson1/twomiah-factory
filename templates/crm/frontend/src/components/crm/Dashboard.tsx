import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  TrendingUp, Users, Calendar, DollarSign, Clock, FileText,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, StatCard, StatusBadge } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

function QuickStats({ instance }) {
  const { contacts, projects, jobs, invoices } = useCRMDataStore();
  const primaryColor = instance.primaryColor || '#ec7619';

  const stats = [
    {
      label: 'Active Projects',
      value: projects.filter(p => p.status === 'in_progress').length,
      total: projects.length,
      icon: FileText,
      trend: '+2 this month',
      trendUp: true,
      enabled: instance.enabledFeatures.some(f => 
        ['rfis', 'submittals', 'punch_lists', 'gantt_schedules'].includes(f)
      )
    },
    {
      label: 'Open Jobs',
      value: jobs.filter(j => ['scheduled', 'in_progress'].includes(j.status)).length,
      total: jobs.length,
      icon: Calendar,
      trend: '3 due today',
      trendUp: null,
      enabled: instance.enabledFeatures.some(f => 
        ['work_orders', 'service_dispatch', 'drag_drop_calendar'].includes(f)
      )
    },
    {
      label: 'Total Contacts',
      value: contacts.length,
      icon: Users,
      trend: '+5 this week',
      trendUp: true,
      enabled: instance.enabledFeatures.includes('contact_database')
    },
    {
      label: 'Revenue (MTD)',
      value: '$' + invoices.filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + i.paid, 0).toLocaleString(),
      icon: DollarSign,
      trend: '+12.5%',
      trendUp: true,
      enabled: instance.enabledFeatures.includes('invoice_generation')
    },
  ];

  const visibleStats = stats.filter(s => s.enabled);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {visibleStats.map((stat, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-slate-400 mt-1">{stat.label}</p>
              {stat.trend && (
                <p className={`text-xs mt-2 flex items-center gap-1 ${
                  stat.trendUp === true ? 'text-emerald-400' : 
                  stat.trendUp === false ? 'text-red-400' : 'text-slate-500'
                }`}>
                  {stat.trendUp === true && <ArrowUpRight className="w-3 h-3" />}
                  {stat.trendUp === false && <ArrowDownRight className="w-3 h-3" />}
                  {stat.trend}
                </p>
              )}
            </div>
            <div 
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${primaryColor}20` }}
            >
              <stat.icon className="w-6 h-6" style={{ color: primaryColor }} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function RecentActivity({ instance }) {
  const { jobs, invoices, rfis } = useCRMDataStore();
  const primaryColor = instance.primaryColor || '#ec7619';

  const activities = [
    ...jobs.slice(0, 3).map(j => ({
      type: 'job',
      title: j.title,
      subtitle: `Assigned to ${j.assignee}`,
      status: j.status,
      date: j.scheduledDate,
    })),
    ...invoices.slice(0, 2).map(i => ({
      type: 'invoice',
      title: `Invoice ${i.number}`,
      subtitle: `$${i.amount.toLocaleString()}`,
      status: i.status,
      date: i.dueDate,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  return (
    <Card>
      <CardHeader title="Recent Activity" subtitle="Latest updates across your CRM" />
      <CardBody className="p-0">
        <div className="divide-y divide-slate-800">
          {activities.map((activity, i) => (
            <div key={i} className="px-6 py-4 hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{activity.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{activity.subtitle}</p>
                </div>
                <div className="text-right">
                  <StatusBadge status={activity.status} />
                  <p className="text-xs text-slate-500 mt-1">
                    {format(new Date(activity.date), 'MMM d')}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function TodaysSchedule({ instance }) {
  const { jobs } = useCRMDataStore();
  const primaryColor = instance.primaryColor || '#ec7619';
  
  const todaysJobs = jobs.filter(j => 
    ['scheduled', 'in_progress'].includes(j.status)
  ).slice(0, 4);

  if (!instance.enabledFeatures.some(f => ['drag_drop_calendar', 'service_dispatch'].includes(f))) {
    return null;
  }

  return (
    <Card>
      <CardHeader 
        title="Today's Schedule" 
        subtitle={format(new Date(), 'EEEE, MMMM d')}
        action={
          <button 
            className="text-xs font-medium hover:underline"
            style={{ color: primaryColor }}
          >
            View Calendar →
          </button>
        }
      />
      <CardBody className="p-0">
        <div className="divide-y divide-slate-800">
          {todaysJobs.map((job, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4">
              <div 
                className="w-1 h-12 rounded-full"
                style={{ backgroundColor: primaryColor }}
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{job.title}</p>
                <p className="text-xs text-slate-500">{job.assignee}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-300">{job.estimatedHours}h</p>
                <StatusBadge status={job.status} />
              </div>
            </div>
          ))}
          {todaysJobs.length === 0 && (
            <div className="px-6 py-8 text-center text-slate-500">
              No jobs scheduled for today
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function PendingItems({ instance }) {
  const { quotes, invoices, rfis } = useCRMDataStore();
  const primaryColor = instance.primaryColor || '#ec7619';

  const items = [];

  if (instance.enabledFeatures.includes('professional_quotes')) {
    const pendingQuotes = quotes.filter(q => q.status === 'pending');
    if (pendingQuotes.length > 0) {
      items.push({
        label: 'Pending Quotes',
        count: pendingQuotes.length,
        value: '$' + pendingQuotes.reduce((sum, q) => sum + q.amount, 0).toLocaleString(),
        icon: FileText,
        color: 'text-amber-400',
        bg: 'bg-amber-500/20'
      });
    }
  }

  if (instance.enabledFeatures.includes('invoice_generation')) {
    const pendingInvoices = invoices.filter(i => i.status === 'pending');
    if (pendingInvoices.length > 0) {
      items.push({
        label: 'Unpaid Invoices',
        count: pendingInvoices.length,
        value: '$' + pendingInvoices.reduce((sum, i) => sum + (i.amount - i.paid), 0).toLocaleString(),
        icon: DollarSign,
        color: 'text-red-400',
        bg: 'bg-red-500/20'
      });
    }
  }

  if (instance.enabledFeatures.includes('rfis')) {
    const openRFIs = rfis.filter(r => r.status === 'open');
    if (openRFIs.length > 0) {
      items.push({
        label: 'Open RFIs',
        count: openRFIs.length,
        value: 'Awaiting response',
        icon: AlertCircle,
        color: 'text-blue-400',
        bg: 'bg-blue-500/20'
      });
    }
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Needs Attention" />
      <CardBody className="space-y-3">
        {items.map((item, i) => (
          <div 
            key={i}
            className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <div className={`p-2 rounded-lg ${item.bg}`}>
              <item.icon className={`w-5 h-5 ${item.color}`} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{item.label}</p>
              <p className="text-xs text-slate-500">{item.value}</p>
            </div>
            <span 
              className="text-lg font-bold"
              style={{ color: primaryColor }}
            >
              {item.count}
            </span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function Dashboard() {
  const { instance } = useOutletContext();
  const primaryColor = instance.primaryColor || '#ec7619';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">
          Welcome back! Here's what's happening with {instance.companyName || 'your business'}.
        </p>
      </div>

      {/* Stats */}
      <QuickStats instance={instance} />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <RecentActivity instance={instance} />
        </div>
        <div className="space-y-6">
          <TodaysSchedule instance={instance} />
          <PendingItems instance={instance} />
        </div>
      </div>
    </div>
  );
}
