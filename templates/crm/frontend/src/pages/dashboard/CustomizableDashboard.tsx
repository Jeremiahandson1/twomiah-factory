import { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, Settings, Plus, X, GripVertical, 
  DollarSign, Briefcase, FileText, Users, Clock, 
  CheckCircle2, AlertCircle, TrendingUp, Calendar,
  FolderKanban, Loader2
} from 'lucide-react';
import api from '../../services/api';

// Widget registry
const WIDGETS = {
  revenue: {
    id: 'revenue',
    title: 'Revenue',
    icon: DollarSign,
    defaultSize: 'medium',
    component: RevenueWidget,
  },
  jobs_today: {
    id: 'jobs_today',
    title: "Today's Jobs",
    icon: Briefcase,
    defaultSize: 'medium',
    component: JobsTodayWidget,
  },
  overdue_invoices: {
    id: 'overdue_invoices',
    title: 'Overdue Invoices',
    icon: AlertCircle,
    defaultSize: 'small',
    component: OverdueInvoicesWidget,
  },
  pending_quotes: {
    id: 'pending_quotes',
    title: 'Pending Quotes',
    icon: FileText,
    defaultSize: 'small',
    component: PendingQuotesWidget,
  },
  team_activity: {
    id: 'team_activity',
    title: 'Team Activity',
    icon: Users,
    defaultSize: 'medium',
    component: TeamActivityWidget,
  },
  my_tasks: {
    id: 'my_tasks',
    title: 'My Tasks',
    icon: CheckCircle2,
    defaultSize: 'medium',
    component: MyTasksWidget,
  },
  recent_activity: {
    id: 'recent_activity',
    title: 'Recent Activity',
    icon: Clock,
    defaultSize: 'large',
    component: RecentActivityWidget,
  },
  project_progress: {
    id: 'project_progress',
    title: 'Project Progress',
    icon: FolderKanban,
    defaultSize: 'medium',
    component: ProjectProgressWidget,
  },
  quick_stats: {
    id: 'quick_stats',
    title: 'Quick Stats',
    icon: TrendingUp,
    defaultSize: 'large',
    component: QuickStatsWidget,
  },
  upcoming_schedule: {
    id: 'upcoming_schedule',
    title: 'Upcoming Schedule',
    icon: Calendar,
    defaultSize: 'medium',
    component: UpcomingScheduleWidget,
  },
};

const DEFAULT_LAYOUT = [
  { id: 'quick_stats', size: 'large' },
  { id: 'jobs_today', size: 'medium' },
  { id: 'my_tasks', size: 'medium' },
  { id: 'overdue_invoices', size: 'small' },
  { id: 'pending_quotes', size: 'small' },
];

export default function CustomizableDashboard() {
  const [layout, setLayout] = useState([]);
  const [editing, setEditing] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState(null);

  // Load saved layout
  useEffect(() => {
    const saved = localStorage.getItem('dashboard_layout');
    if (saved) {
      try {
        setLayout(JSON.parse(saved));
      } catch {
        setLayout(DEFAULT_LAYOUT);
      }
    } else {
      setLayout(DEFAULT_LAYOUT);
    }
  }, []);

  // Save layout changes
  const saveLayout = useCallback((newLayout) => {
    setLayout(newLayout);
    localStorage.setItem('dashboard_layout', JSON.stringify(newLayout));
  }, []);

  const addWidget = (widgetId) => {
    const widget = WIDGETS[widgetId];
    if (!widget) return;
    
    saveLayout([...layout, { id: widgetId, size: widget.defaultSize }]);
    setShowAddWidget(false);
  };

  const removeWidget = (index) => {
    const newLayout = [...layout];
    newLayout.splice(index, 1);
    saveLayout(newLayout);
  };

  const changeSize = (index, size) => {
    const newLayout = [...layout];
    newLayout[index] = { ...newLayout[index], size };
    saveLayout(newLayout);
  };

  const handleDragStart = (index) => {
    setDraggingIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === index) return;

    const newLayout = [...layout];
    const [removed] = newLayout.splice(draggingIndex, 1);
    newLayout.splice(index, 0, removed);
    saveLayout(newLayout);
    setDraggingIndex(index);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
  };

  const resetLayout = () => {
    saveLayout(DEFAULT_LAYOUT);
  };

  const usedWidgets = new Set(layout.map(w => w.id));
  const availableWidgets = Object.values(WIDGETS).filter(w => !usedWidgets.has(w.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500">Welcome back! Here's your overview.</p>
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <>
              <button
                onClick={() => setShowAddWidget(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                <Plus className="w-4 h-4" />
                Add Widget
              </button>
              <button
                onClick={resetLayout}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Reset
              </button>
            </>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
              editing 
                ? 'bg-orange-500 text-white' 
                : 'border hover:bg-gray-50'
            }`}
          >
            {editing ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Done
              </>
            ) : (
              <>
                <Settings className="w-4 h-4" />
                Customize
              </>
            )}
          </button>
        </div>
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-12 gap-4">
        {layout.map((item, index) => {
          const widget = WIDGETS[item.id];
          if (!widget) return null;

          const sizeClasses = {
            small: 'col-span-12 sm:col-span-6 lg:col-span-3',
            medium: 'col-span-12 sm:col-span-6 lg:col-span-4',
            large: 'col-span-12 lg:col-span-6',
            full: 'col-span-12',
          };

          const WidgetComponent = widget.component;

          return (
            <div
              key={`${item.id}-${index}`}
              className={`${sizeClasses[item.size]} ${
                draggingIndex === index ? 'opacity-50' : ''
              }`}
              draggable={editing}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
            >
              <WidgetWrapper
                widget={widget}
                size={item.size}
                editing={editing}
                onRemove={() => removeWidget(index)}
                onResize={(size) => changeSize(index, size)}
              >
                <WidgetComponent />
              </WidgetWrapper>
            </div>
          );
        })}
      </div>

      {layout.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <LayoutDashboard className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 mb-4">No widgets added yet</p>
          <button
            onClick={() => setShowAddWidget(true)}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            Add Your First Widget
          </button>
        </div>
      )}

      {/* Add Widget Modal */}
      {showAddWidget && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowAddWidget(false)} />
          <div className="relative min-h-screen flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Add Widget</h2>
                <button onClick={() => setShowAddWidget(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {availableWidgets.length === 0 ? (
                <p className="text-gray-500 text-center py-8">All widgets are already added</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {availableWidgets.map((widget) => {
                    const Icon = widget.icon;
                    return (
                      <button
                        key={widget.id}
                        onClick={() => addWidget(widget.id)}
                        className="p-4 border rounded-lg text-left hover:border-orange-300 hover:bg-orange-50 transition-colors"
                      >
                        <Icon className="w-6 h-6 text-orange-500 mb-2" />
                        <p className="font-medium text-gray-900">{widget.title}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetWrapper({ widget, size, editing, onRemove, onResize, children }) {
  const Icon = widget.icon;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden h-full ${
      editing ? 'ring-2 ring-orange-200' : ''
    }`}>
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          {editing && (
            <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
          )}
          <Icon className="w-5 h-5 text-orange-500" />
          <h3 className="font-medium text-gray-900">{widget.title}</h3>
        </div>
        {editing && (
          <div className="flex items-center gap-2">
            <select
              value={size}
              onChange={(e) => onResize(e.target.value)}
              className="text-xs border rounded px-2 py-1"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="full">Full Width</option>
            </select>
            <button
              onClick={onRemove}
              className="p-1 text-gray-400 hover:text-red-500 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

// ============================================
// WIDGET COMPONENTS
// ============================================

function RevenueWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/reports/revenue')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-3">
      <div className="text-3xl font-bold text-gray-900">
        ${(data?.collected || 0).toLocaleString()}
      </div>
      <p className="text-sm text-gray-500">Collected this month</p>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-gray-500">Invoiced:</span>{' '}
          <span className="font-medium">${(data?.invoiced || 0).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500">Outstanding:</span>{' '}
          <span className="font-medium text-orange-600">${(data?.outstanding || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function JobsTodayWidget() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const params = new URLSearchParams({
      startDate: today.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
      limit: '10',
    });
    api.get(`/api/jobs?${params}`)
      .then(res => setJobs(res.data || res || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-2">
      {jobs.length === 0 ? (
        <p className="text-gray-500 text-sm">No jobs scheduled today</p>
      ) : (
        jobs.slice(0, 5).map((job) => (
          <div key={job.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
            <div className="truncate">
              <p className="font-medium text-sm text-gray-900 truncate">{job.title}</p>
              <p className="text-xs text-gray-500">{job.assignedTo?.firstName || 'Unassigned'}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${
              job.status === 'completed' ? 'bg-green-100 text-green-700' :
              job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {job.status?.replace('_', ' ')}
            </span>
          </div>
        ))
      )}
      {jobs.length > 5 && (
        <p className="text-xs text-gray-500 text-center">+{jobs.length - 5} more</p>
      )}
    </div>
  );
}

function OverdueInvoicesWidget() {
  const [data, setData] = useState({ count: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/invoices?status=overdue&limit=1')
      .then(res => {
        const invoices = res.data || [];
        const total = invoices.reduce((sum, i) => sum + Number(i.balance || 0), 0);
        setData({ count: res.pagination?.total || invoices.length, total });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-red-600">{data.count}</div>
      <p className="text-sm text-gray-500">Overdue invoices</p>
      {data.total > 0 && (
        <p className="text-lg font-semibold text-red-600 mt-2">
          ${data.total.toLocaleString()}
        </p>
      )}
    </div>
  );
}

function PendingQuotesWidget() {
  const [data, setData] = useState({ count: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/quotes?status=sent&limit=100')
      .then(res => {
        const quotes = res.data || [];
        const total = quotes.reduce((sum, q) => sum + Number(q.total || 0), 0);
        setData({ count: quotes.length, total });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-orange-600">{data.count}</div>
      <p className="text-sm text-gray-500">Pending quotes</p>
      {data.total > 0 && (
        <p className="text-lg font-semibold text-gray-900 mt-2">
          ${data.total.toLocaleString()}
        </p>
      )}
    </div>
  );
}

function TeamActivityWidget() {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/reports/team')
      .then(data => setTeam(data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-2">
      {team.slice(0, 5).map((member, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-xs font-medium text-orange-600">
              {member.user?.firstName?.[0]}{member.user?.lastName?.[0]}
            </div>
            <span className="text-sm text-gray-900">{member.user?.firstName}</span>
          </div>
          <span className="text-sm text-gray-500">{member.hoursWorked}h</span>
        </div>
      ))}
    </div>
  );
}

function MyTasksWidget() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/tasks?mine=true&status=pending&limit=5')
      .then(res => setTasks(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-2">
      {tasks.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">No pending tasks!</p>
      ) : (
        tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded">
            <CheckCircle2 className="w-4 h-4 text-gray-300" />
            <span className="text-sm text-gray-900 truncate">{task.title}</span>
          </div>
        ))
      )}
    </div>
  );
}

function RecentActivityWidget() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/comments/activity/feed?limit=10')
      .then(res => setActivity(res.activities || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {activity.map((item, i) => (
        <div key={i} className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded text-sm">
          <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">
            {item.user?.firstName?.[0]}
          </div>
          <div>
            <span className="font-medium">{item.user?.firstName}</span>{' '}
            <span className="text-gray-500">{item.action?.replace(/_/g, ' ')}</span>
            <p className="text-xs text-gray-400">
              {new Date(item.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectProgressWidget() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/projects?status=active&limit=5')
      .then(res => setProjects(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <div key={project.id}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="font-medium truncate">{project.name}</span>
            <span className="text-gray-500">{project.progress || 0}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 rounded-full"
              style={{ width: `${project.progress || 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickStatsWidget() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/reports/dashboard')
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  const items = [
    { label: 'Revenue', value: `$${(stats?.revenue?.collected || 0).toLocaleString()}`, color: 'green' },
    { label: 'Jobs Completed', value: stats?.jobs?.completed || 0, color: 'blue' },
    { label: 'Quotes Sent', value: stats?.quotes?.total || 0, color: 'purple' },
    { label: 'Active Projects', value: stats?.projects?.active || 0, color: 'orange' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map((item, i) => (
        <div key={i} className={`p-3 bg-${item.color}-50 rounded-lg`}>
          <p className="text-2xl font-bold text-gray-900">{item.value}</p>
          <p className="text-xs text-gray-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function UpcomingScheduleWidget() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    const params = new URLSearchParams({
      startDate: today.toISOString(),
      endDate: nextWeek.toISOString(),
      limit: '10',
    });
    
    api.get(`/api/jobs?${params}`)
      .then(res => setJobs(res.data || res || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WidgetLoader />;

  return (
    <div className="space-y-2">
      {jobs.slice(0, 5).map((job) => (
        <div key={job.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded">
          <div className="text-center">
            <div className="text-xs text-gray-500">
              {new Date(job.scheduledDate).toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div className="text-lg font-bold">
              {new Date(job.scheduledDate).getDate()}
            </div>
          </div>
          <div className="flex-1 truncate">
            <p className="font-medium text-sm truncate">{job.title}</p>
            <p className="text-xs text-gray-500">{job.contact?.name || 'No contact'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function WidgetLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );
}
