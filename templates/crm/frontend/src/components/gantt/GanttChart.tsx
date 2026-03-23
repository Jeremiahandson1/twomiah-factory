import { useState, useEffect, useRef } from 'react';
import {
  Calendar, Plus, Link2, AlertTriangle, Target,
  ChevronRight, ChevronDown, Loader2, Settings,
  Play, Flag, Milestone
} from 'lucide-react';
import api from '../../services/api';

const DAY_WIDTH = 30;
const ROW_HEIGHT = 36;

interface GanttTask {
  id: string;
  name: string;
  start?: string | null;
  end?: string | null;
  duration?: number;
  progress?: number;
  level: number;
  parentId?: string | null;
  isMilestone?: boolean;
  isCritical?: boolean;
  color?: string;
  dependencies?: Array<{ id: string; type: string }>;
  [key: string]: unknown;
}

interface GanttData {
  tasks: GanttTask[];
  [key: string]: unknown;
}

interface GanttChartProps {
  projectId: string;
}

interface TaskRowProps {
  task: GanttTask;
  allTasks: GanttTask[];
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  isSelected: boolean;
}

interface TimelineHeaderProps {
  minDate: Date;
  totalDays: number;
}

interface TaskBarProps {
  task: GanttTask;
  index: number;
  minDate: Date;
  onClick: () => void;
  isSelected: boolean;
}

interface TodayLineProps {
  minDate: Date;
  totalDays: number;
  visibleTasks: GanttTask[];
}

interface DependencyLineProps {
  fromTask: GanttTask;
  toTask: GanttTask;
  fromIndex: number;
  toIndex: number;
  minDate: Date;
  type: string;
}

interface TaskDetailModalProps {
  task: GanttTask;
  allTasks: GanttTask[];
  projectId: string;
  onSave: () => void;
  onClose: () => void;
}

interface AddTaskModalProps {
  projectId: string;
  onSave: () => void;
  onClose: () => void;
}

interface AddDependencyModalProps {
  projectId: string;
  tasks: GanttTask[];
  onSave: () => void;
  onClose: () => void;
}

export default function GanttChart({ projectId }: GanttChartProps) {
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<GanttTask | null>(null);
  const [showAddTask, setShowAddTask] = useState<boolean>(false);
  const [showAddDependency, setShowAddDependency] = useState<boolean>(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/scheduling/project/${projectId}/gantt`);
      setGanttData(data);
      setExpandedTasks(new Set(data.tasks.map((t: GanttTask) => t.id)));
    } catch (error: unknown) {
      console.error('Failed to load Gantt data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!ganttData) {
    return (
      <div className="text-center py-12 text-gray-500">Failed to load schedule</div>
    );
  }

  const tasks = ganttData.tasks;
  const allDates = tasks.flatMap((t: GanttTask) => [t.start, t.end]).filter(Boolean).map((d: string | null | undefined) => new Date(d!));
  const minDate = allDates.length > 0
    ? new Date(Math.min(...allDates.map((d: Date) => d.getTime())))
    : new Date();
  const maxDate = allDates.length > 0
    ? new Date(Math.max(...allDates.map((d: Date) => d.getTime())))
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 14);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  const chartWidth = totalDays * DAY_WIDTH;

  const visibleTasks: GanttTask[] = [];
  const addVisibleTasks = (taskList: GanttTask[], parentExpanded: boolean = true) => {
    for (const task of taskList) {
      if (parentExpanded) {
        visibleTasks.push(task);
        const hasChildren = tasks.some((t: GanttTask) => t.parentId === task.id);
        if (hasChildren && expandedTasks.has(task.id)) {
          const children = tasks.filter((t: GanttTask) => t.parentId === task.id);
          addVisibleTasks(children, true);
        }
      }
    }
  };

  const rootTasks = tasks.filter((t: GanttTask) => !t.parentId);
  addVisibleTasks(rootTasks);

  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-900">Project Schedule</h2>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-red-600">
              <div className="w-3 h-2 bg-red-500 rounded" />
              Critical Path
            </span>
            <span className="flex items-center gap-1 text-xs text-blue-600">
              <div className="w-3 h-2 bg-blue-500 rounded" />
              On Track
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddTask(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg">
            <Plus className="w-4 h-4" /> Add Task
          </button>
          <button onClick={() => setShowAddDependency(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg">
            <Link2 className="w-4 h-4" /> Add Link
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex">
          <div className="w-80 flex-shrink-0 border-r">
            <div className="h-12 border-b bg-gray-50 flex items-center px-4">
              <span className="font-medium text-sm text-gray-700">Task Name</span>
            </div>
            <div>
              {visibleTasks.map((task: GanttTask, index: number) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  allTasks={tasks}
                  isExpanded={expandedTasks.has(task.id)}
                  onToggle={() => toggleExpand(task.id)}
                  onClick={() => setSelectedTask(task)}
                  isSelected={selectedTask?.id === task.id}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-x-auto" ref={chartRef}>
            <TimelineHeader minDate={minDate} totalDays={totalDays} />
            <div className="relative" style={{ width: chartWidth }}>
              <TodayLine minDate={minDate} totalDays={totalDays} visibleTasks={visibleTasks} />
              {visibleTasks.map((task: GanttTask, index: number) => (
                <TaskBar key={task.id} task={task} index={index} minDate={minDate} onClick={() => setSelectedTask(task)} isSelected={selectedTask?.id === task.id} />
              ))}
              <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: chartWidth, height: visibleTasks.length * ROW_HEIGHT }}>
                {visibleTasks.flatMap((task: GanttTask, taskIndex: number) =>
                  (task.dependencies || []).map((dep: { id: string; type: string }) => {
                    const predIndex = visibleTasks.findIndex((t: GanttTask) => t.id === dep.id);
                    if (predIndex === -1) return null;
                    const predTask = visibleTasks[predIndex];
                    return (
                      <DependencyLine key={`${dep.id}-${task.id}`} fromTask={predTask} toTask={task} fromIndex={predIndex} toIndex={taskIndex} minDate={minDate} type={dep.type} />
                    );
                  })
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailModal task={selectedTask} allTasks={tasks} projectId={projectId} onSave={() => { setSelectedTask(null); loadData(); }} onClose={() => setSelectedTask(null)} />
      )}
      {showAddTask && (
        <AddTaskModal projectId={projectId} onSave={() => { setShowAddTask(false); loadData(); }} onClose={() => setShowAddTask(false)} />
      )}
      {showAddDependency && (
        <AddDependencyModal projectId={projectId} tasks={tasks} onSave={() => { setShowAddDependency(false); loadData(); }} onClose={() => setShowAddDependency(false)} />
      )}
    </div>
  );
}

function TaskRow({ task, allTasks, isExpanded, onToggle, onClick, isSelected }: TaskRowProps) {
  const hasChildren = allTasks.some((t: GanttTask) => t.parentId === task.id);
  const indent = task.level * 20;

  return (
    <div className={`h-9 border-b flex items-center px-2 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-orange-50' : ''}`} onClick={onClick} style={{ paddingLeft: indent + 8 }}>
      {hasChildren ? (
        <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggle(); }} className="p-1 hover:bg-gray-200 rounded">
          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </button>
      ) : (
        <div className="w-6" />
      )}
      {task.isMilestone ? <Flag className="w-4 h-4 text-purple-500 mr-2" /> : task.isCritical ? <AlertTriangle className="w-4 h-4 text-red-500 mr-2" /> : null}
      <span className={`text-sm truncate ${task.isCritical ? 'text-red-700 font-medium' : 'text-gray-700'}`}>{task.name}</span>
    </div>
  );
}

function TimelineHeader({ minDate, totalDays }: TimelineHeaderProps) {
  const months: Array<{ key: string | null; label: string; startDay: number; days: number }> = [];
  const days: Array<{ date: Date; isWeekend: boolean }> = [];

  let currentDate = new Date(minDate);
  let currentMonth: string | null = null;
  let monthStartDay = 0;

  for (let i = 0; i < totalDays; i++) {
    const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
    if (monthKey !== currentMonth) {
      if (currentMonth !== null) {
        months.push({
          key: currentMonth,
          label: new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          startDay: monthStartDay,
          days: i - monthStartDay,
        });
      }
      currentMonth = monthKey;
      monthStartDay = i;
    }
    days.push({ date: new Date(currentDate), isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6 });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  months.push({
    key: currentMonth,
    label: new Date(minDate.getTime() + (totalDays - 1) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    startDay: monthStartDay,
    days: totalDays - monthStartDay,
  });

  return (
    <div className="h-12 border-b bg-gray-50 flex flex-col">
      <div className="flex h-6 border-b">
        {months.map((m) => (
          <div key={m.key} className="border-r text-xs font-medium text-gray-600 flex items-center justify-center" style={{ width: m.days * DAY_WIDTH }}>{m.label}</div>
        ))}
      </div>
      <div className="flex h-6">
        {days.map((d, i: number) => (
          <div key={i} className={`border-r text-xs flex items-center justify-center ${d.isWeekend ? 'bg-gray-100 text-gray-400' : 'text-gray-500'}`} style={{ width: DAY_WIDTH }}>{d.date.getDate()}</div>
        ))}
      </div>
    </div>
  );
}

function TaskBar({ task, index, minDate, onClick, isSelected }: TaskBarProps) {
  if (!task.start || !task.end) return null;

  const startDate = new Date(task.start);
  const endDate = new Date(task.end);
  const startDay = Math.floor((startDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  const duration = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  const left = startDay * DAY_WIDTH;
  const width = duration * DAY_WIDTH - 4;
  const top = index * ROW_HEIGHT + 8;

  if (task.isMilestone) {
    return (
      <div className="absolute cursor-pointer" style={{ left: left + width / 2 - 8, top: top + 2, width: 16, height: 16, transform: 'rotate(45deg)', backgroundColor: '#9333ea' }} onClick={onClick} />
    );
  }

  const barColor = task.isCritical ? 'bg-red-500' : (task.color || 'bg-blue-500');
  const progressWidth = (task.progress || 0) / 100 * width;

  return (
    <div className={`absolute rounded cursor-pointer ${barColor} ${isSelected ? 'ring-2 ring-orange-400' : ''}`} style={{ left, top, width, height: ROW_HEIGHT - 16 }} onClick={onClick}>
      <div className="absolute left-0 top-0 bottom-0 bg-black/20 rounded-l" style={{ width: progressWidth }} />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-white truncate" style={{ maxWidth: width - 16 }}>{task.name}</span>
    </div>
  );
}

function TodayLine({ minDate, totalDays, visibleTasks }: TodayLineProps) {
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceStart < 0 || daysSinceStart > totalDays) return null;

  return (
    <div className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-10" style={{ left: daysSinceStart * DAY_WIDTH, height: visibleTasks.length * ROW_HEIGHT }} />
  );
}

function DependencyLine({ fromTask, toTask, fromIndex, toIndex, minDate, type }: DependencyLineProps) {
  if (!fromTask.end || !toTask.start) return null;

  const fromDate = new Date(fromTask.end);
  const toDate = new Date(toTask.start);

  const fromX = Math.floor((fromDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) * DAY_WIDTH;
  const toX = Math.floor((toDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) * DAY_WIDTH;

  const fromY = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const toY = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

  const midX = fromX + 15;
  const path = `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`;

  return (
    <g>
      <path d={path} fill="none" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#6b7280" />
        </marker>
      </defs>
    </g>
  );
}

function TaskDetailModal({ task, allTasks, projectId, onSave, onClose }: TaskDetailModalProps) {
  const [form, setForm] = useState({
    name: task.name,
    startDate: task.start?.split('T')[0] || '',
    endDate: task.end?.split('T')[0] || '',
    duration: task.duration || 1,
    progress: task.progress || 0,
    isMilestone: task.isMilestone || false,
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/scheduling/tasks/${task.id}`, form);
      onSave();
    } catch (error: unknown) {
      alert('Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Edit Task</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input type="text" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input type="date" value={form.startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, startDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input type="date" value={form.endDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, endDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (days)</label>
                <input type="number" value={form.duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duration: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" min="1" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Progress (%)</label>
                <input type="number" value={form.progress} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, progress: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" min="0" max="100" />
              </div>
            </div>
            {task.isCritical && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                This task is on the critical path
              </div>
            )}
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AddTaskModal({ projectId, onSave, onClose }: AddTaskModalProps) {
  const [form, setForm] = useState({ name: '', startDate: '', duration: 1, isMilestone: false });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/scheduling/project/${projectId}/tasks`, form);
      onSave();
    } catch (error: unknown) {
      alert('Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Task</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input type="text" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input type="date" value={form.startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, startDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (days)</label>
                <input type="number" value={form.duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duration: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" min="1" />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isMilestone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, isMilestone: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm">Milestone (no duration)</span>
            </label>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">{saving ? 'Creating...' : 'Add Task'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AddDependencyModal({ projectId, tasks, onSave, onClose }: AddDependencyModalProps) {
  const [form, setForm] = useState({ predecessorId: '', successorId: '', type: 'finish_to_start', lagDays: 0 });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (form.predecessorId === form.successorId) { alert('Cannot link a task to itself'); return; }
    setSaving(true);
    try {
      await api.post(`/scheduling/project/${projectId}/dependencies`, form);
      onSave();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'Failed to create dependency');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Dependency</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Predecessor (From)</label>
              <select value={form.predecessorId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, predecessorId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select task...</option>
                {tasks.map((t: GanttTask) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Successor (To)</label>
              <select value={form.successorId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, successorId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select task...</option>
                {tasks.map((t: GanttTask) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="finish_to_start">Finish to Start (FS)</option>
                <option value="start_to_start">Start to Start (SS)</option>
                <option value="finish_to_finish">Finish to Finish (FF)</option>
                <option value="start_to_finish">Start to Finish (SF)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lag (days)</label>
              <input type="number" value={form.lagDays} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, lagDays: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" />
              <p className="text-xs text-gray-500 mt-1">Positive = delay, Negative = lead time</p>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">{saving ? 'Creating...' : 'Add Link'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
