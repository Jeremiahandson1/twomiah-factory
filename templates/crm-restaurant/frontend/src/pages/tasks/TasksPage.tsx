import { useState, useEffect } from 'react';
import {
  CheckCircle2, Circle, Plus, Calendar, User, Flag,
  Trash2, Edit2, Loader2, AlertCircle, FolderKanban,
  ChevronDown, ChevronRight, MoreVertical
} from 'lucide-react';
import api from '../../services/api';

interface TaskData {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate?: string;
  assignedToId?: string;
  assignedTo?: { firstName: string };
  projectId?: string;
  project?: { name: string };
  checklist?: ChecklistItem[];
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
}

interface UserData {
  id: string;
  firstName: string;
  lastName: string;
}

interface ProjectData {
  id: string;
  name: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<string>('all'); // all, pending, completed, overdue
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<TaskData | null>(null);

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    try {
      const params = new URLSearchParams({ mine: 'true', limit: '100' });
      if (filter === 'pending') params.append('status', 'pending');
      if (filter === 'completed') params.append('status', 'completed');

      const [tasksRes, statsRes] = await Promise.all([
        api.get(`/api/tasks?${params}`),
        api.get('/api/tasks/stats'),
      ]);

      let taskList = ((tasksRes as Record<string, unknown>)?.data || []) as TaskData[];

      // Filter overdue locally
      if (filter === 'overdue') {
        taskList = taskList.filter((t: TaskData) =>
          t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date()
        );
      }

      setTasks(taskList);
      setStats((statsRes || { total: 0, completed: 0, pending: 0, overdue: 0 }) as TaskStats);
    } catch (error: unknown) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (taskId: string) => {
    try {
      const updated = await api.post(`/api/tasks/${taskId}/toggle`);
      setTasks((prev: TaskData[]) => prev.map((t: TaskData) => t.id === taskId ? updated as TaskData : t));
      loadData(); // Refresh stats
    } catch (error: unknown) {
      alert('Failed to update task');
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      setTasks((prev: TaskData[]) => prev.filter((t: TaskData) => t.id !== taskId));
      loadData();
    } catch (error: unknown) {
      alert('Failed to delete task');
    }
  };

  const handleSave = async (taskData: Record<string, unknown>) => {
    try {
      if (editingTask) {
        const updated = await api.put(`/api/tasks/${editingTask.id}`, taskData);
        setTasks((prev: TaskData[]) => prev.map((t: TaskData) => t.id === editingTask.id ? updated as TaskData : t));
      } else {
        const created = await api.post('/api/tasks', taskData);
        setTasks((prev: TaskData[]) => [created as TaskData, ...prev]);
      }
      setShowForm(false);
      setEditingTask(null);
      loadData();
    } catch (error: unknown) {
      alert('Failed to save task');
    }
  };

  const priorityColors: Record<string, string> = {
    low: 'text-gray-400',
    medium: 'text-yellow-500',
    high: 'text-orange-500',
    urgent: 'text-red-500',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-gray-500">Manage your to-do list</p>
        </div>
        <button
          onClick={() => { setEditingTask(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} color="blue" />
          <StatCard label="Completed" value={stats.completed} color="green" />
          <StatCard label="Overdue" value={stats.overdue} color="red" />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'pending', 'completed', 'overdue'].map((f: string) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
              filter === f
                ? 'bg-orange-100 text-orange-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Task List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No tasks found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {tasks.map((task: TaskData) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={() => handleToggle(task.id)}
              onEdit={() => { setEditingTask(task); setShowForm(true); }}
              onDelete={() => handleDelete(task.id)}
              priorityColors={priorityColors}
            />
          ))}
        </div>
      )}

      {/* Task Form Modal */}
      {showForm && (
        <TaskFormModal
          task={editingTask}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingTask(null); }}
        />
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  color?: string;
}

function StatCard({ label, value, color = 'gray' }: StatCardProps) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-50',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

interface TaskItemProps {
  task: TaskData;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  priorityColors: Record<string, string>;
}

function TaskItem({ task, onToggle, onEdit, onDelete, priorityColors }: TaskItemProps) {
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const isOverdue = task.status !== 'completed' && task.dueDate && new Date(task.dueDate) < new Date();

  return (
    <div className={`p-4 hover:bg-gray-50 ${task.status === 'completed' ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button onClick={onToggle} className="mt-0.5">
          {task.status === 'completed' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5 text-gray-300 hover:text-gray-400" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`font-medium ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {task.title}
            </p>
            <Flag className={`w-4 h-4 ${priorityColors[task.priority]}`} />
          </div>

          {task.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-1">{task.description}</p>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            {task.dueDate && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}>
                <Calendar className="w-3 h-3" />
                {new Date(task.dueDate).toLocaleDateString()}
                {isOverdue && ' (Overdue)'}
              </span>
            )}
            {task.project && (
              <span className="flex items-center gap-1">
                <FolderKanban className="w-3 h-3" />
                {task.project.name}
              </span>
            )}
            {task.assignedTo && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {task.assignedTo.firstName}
              </span>
            )}
          </div>

          {/* Checklist preview */}
          {task.checklist && task.checklist.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              {task.checklist.filter((i: ChecklistItem) => i.completed).length}/{task.checklist.length} items completed
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 mt-1 bg-white border rounded-lg shadow-lg py-1 z-10 w-32">
                <button
                  onClick={() => { setShowMenu(false); onEdit(); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => { setShowMenu(false); onDelete(); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-gray-50 w-full"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface TaskFormModalProps {
  task: TaskData | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function TaskFormModal({ task, onSave, onClose }: TaskFormModalProps) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    dueDate: task?.dueDate ? task.dueDate.split('T')[0] : '',
    priority: task?.priority || 'medium',
    assignedToId: task?.assignedToId || '',
    projectId: task?.projectId || '',
    checklist: task?.checklist || [] as ChecklistItem[],
  });
  const [newItem, setNewItem] = useState<string>('');
  const [users, setUsers] = useState<UserData[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const [usersRes, projectsRes] = await Promise.all([
        api.get('/api/team'),
        api.get('/api/projects?status=active&limit=100'),
      ]);
      setUsers(((usersRes as Record<string, unknown>).data || usersRes || []) as UserData[]);
      setProjects(((projectsRes as Record<string, unknown>).data || []) as ProjectData[]);
    } catch (error: unknown) {
      console.error('Failed to load options:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const addChecklistItem = () => {
    if (!newItem.trim()) return;
    setForm((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { id: `item-${Date.now()}`, text: newItem, completed: false }],
    }));
    setNewItem('');
  };

  const removeChecklistItem = (id: string) => {
    setForm((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((i: ChecklistItem) => i.id !== id),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            {task ? 'Edit Task' : 'New Task'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="What needs to be done?"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, priority: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
                <select
                  value={form.assignedToId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, assignedToId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Myself</option>
                  {users.map((u: UserData) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                <select
                  value={form.projectId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">None</option>
                  {projects.map((p: ProjectData) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Checklist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Checklist</label>
              <div className="space-y-2 mb-2">
                {form.checklist.map((item: ChecklistItem) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    <Circle className="w-4 h-4 text-gray-300" />
                    <span className="flex-1">{item.text}</span>
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newItem}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItem(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())}
                  placeholder="Add checklist item"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={addChecklistItem}
                  className="px-3 py-2 text-orange-600 hover:bg-orange-50 rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.title.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {task ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Task Widget for Dashboard
 */
export function TaskWidget() {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      const data = await api.get('/api/tasks/upcoming');
      setTasks(Array.isArray(data) ? data as TaskData[] : []);
    } catch (error: unknown) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (taskId: string) => {
    try {
      await api.post(`/api/tasks/${taskId}/toggle`);
      loadTasks();
    } catch (error: unknown) {
      console.error('Failed to toggle task:', error);
    }
  };

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-2">
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No upcoming tasks</p>
      ) : (
        tasks.slice(0, 5).map((task: TaskData) => (
          <div key={task.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
            <button onClick={() => handleToggle(task.id)}>
              <Circle className="w-4 h-4 text-gray-300 hover:text-gray-400" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
              {task.dueDate && (
                <p className="text-xs text-gray-500">
                  Due {new Date(task.dueDate).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
