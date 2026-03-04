import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Clock, ChevronLeft, ChevronRight, Plus, Edit2, Trash2, Check, 
  Loader2, Calendar, User, Briefcase, Download
} from 'lucide-react';
import api from '../../services/api';
import TimeClock from '../../components/time/TimeClock';

export default function TimesheetPage() {
  const [view, setView] = useState('week'); // week, list
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [timesheet, setTimesheet] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    loadData();
  }, [view, weekStart]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (view === 'week') {
        const data = await api.get(`/api/time/weekly?weekStart=${weekStart}`);
        setTimesheet(data);
      } else {
        const result = await api.get('/api/time?limit=50');
        setEntries(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load time data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevWeek = () => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() - 7);
    setWeekStart(date.toISOString().split('T')[0]);
  };

  const handleNextWeek = () => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + 7);
    setWeekStart(date.toISOString().split('T')[0]);
  };

  const handleThisWeek = () => {
    setWeekStart(getWeekStart(new Date()));
  };

  const handleDeleteEntry = async (entryId) => {
    if (!confirm('Delete this time entry?')) return;
    try {
      await api.delete(`/api/time/${entryId}`);
      loadData();
    } catch (error) {
      alert('Failed to delete entry');
    }
  };

  const formatDuration = (minutes) => {
    if (!minutes) return '0:00';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Time Tracking</h1>
          <p className="text-gray-500">Track your work hours</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowManualEntry(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
          >
            <Plus className="w-4 h-4" />
            Add Entry
          </button>
          <Link
            to="/time/reports"
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Download className="w-4 h-4" />
            Reports
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Time Clock */}
        <div className="lg:col-span-1">
          <TimeClock onUpdate={loadData} />
        </div>

        {/* Timesheet */}
        <div className="lg:col-span-3">
          {/* View Toggle & Navigation */}
          <div className="bg-white rounded-xl border p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('week')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    view === 'week' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Week View
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    view === 'list' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  List View
                </button>
              </div>

              {view === 'week' && (
                <div className="flex items-center gap-2">
                  <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-100 rounded-lg">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleThisWeek}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    This Week
                  </button>
                  <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-lg">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl border p-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : view === 'week' ? (
            <WeekView 
              timesheet={timesheet} 
              formatDuration={formatDuration}
              onDelete={handleDeleteEntry}
            />
          ) : (
            <ListView 
              entries={entries} 
              formatDuration={formatDuration}
              onDelete={handleDeleteEntry}
            />
          )}
        </div>
      </div>

      {/* Manual Entry Modal */}
      {showManualEntry && (
        <ManualEntryModal 
          onClose={() => setShowManualEntry(false)}
          onSave={() => {
            setShowManualEntry(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

function WeekView({ timesheet, formatDuration, onDelete }) {
  if (!timesheet) return null;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Week header */}
      <div className="grid grid-cols-8 border-b bg-gray-50">
        <div className="p-3 text-sm font-medium text-gray-500">Date</div>
        {timesheet.days.map((day, i) => (
          <div key={i} className="p-3 text-center border-l">
            <p className="text-sm font-medium text-gray-900">{day.dayName}</p>
            <p className="text-xs text-gray-500">
              {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        ))}
      </div>

      {/* Hours row */}
      <div className="grid grid-cols-8 border-b">
        <div className="p-3 text-sm font-medium text-gray-700">Hours</div>
        {timesheet.days.map((day, i) => (
          <div key={i} className="p-3 text-center border-l">
            <p className={`text-lg font-bold ${day.totalHours > 0 ? 'text-green-600' : 'text-gray-300'}`}>
              {day.totalHours}
            </p>
          </div>
        ))}
      </div>

      {/* Entries */}
      <div className="divide-y max-h-96 overflow-y-auto">
        {timesheet.days.flatMap(day => 
          day.entries.map(entry => (
            <div key={entry.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-20 text-sm text-gray-500">
                  {new Date(entry.startTime).toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {entry.job?.title || entry.project?.name || 'General'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(entry.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {entry.endTime ? new Date(entry.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-900">
                  {formatDuration(entry.workedMinutes)}
                </span>
                <button
                  onClick={() => onDelete(entry.id)}
                  className="p-1 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
        {timesheet.days.every(d => d.entries.length === 0) && (
          <div className="p-8 text-center text-gray-500">
            No time entries this week
          </div>
        )}
      </div>

      {/* Week total */}
      <div className="p-4 bg-gray-50 border-t">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-900">Week Total</span>
          <span className="text-xl font-bold text-green-600">
            {timesheet.totalHours} hours
          </span>
        </div>
      </div>
    </div>
  );
}

function ListView({ entries, formatDuration, onDelete }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="divide-y">
        {entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No time entries found
          </div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center min-w-16">
                    <p className="text-sm font-medium text-gray-900">
                      {new Date(entry.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(entry.startTime).toLocaleDateString('en-US', { weekday: 'short' })}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {entry.job?.title || entry.project?.name || 'General Work'}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>
                        {new Date(entry.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {entry.endTime ? new Date(entry.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'}
                      </span>
                      {entry.user && (
                        <>
                          <span>•</span>
                          <span>{entry.user.firstName} {entry.user.lastName}</span>
                        </>
                      )}
                    </div>
                    {entry.notes && (
                      <p className="text-sm text-gray-500 mt-1">{entry.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{formatDuration(entry.workedMinutes)}</p>
                    {entry.approved && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Approved
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ManualEntryModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '17:00',
    jobId: '',
    projectId: '',
    notes: '',
    breakMinutes: 0,
  });
  const [jobs, setJobs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const [jobsRes, projectsRes] = await Promise.all([
        api.get('/api/jobs?limit=100'),
        api.get('/api/projects?limit=100'),
      ]);
      setJobs(jobsRes.data || []);
      setProjects(projectsRes.data || []);
    } catch (error) {
      console.error('Failed to load options:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/time', form);
      onSave();
    } catch (error) {
      alert(error.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Add Time Entry</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Break (minutes)</label>
              <input
                type="number"
                value={form.breakMinutes}
                onChange={(e) => setForm({ ...form, breakMinutes: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-lg"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job</label>
              <select
                value={form.jobId}
                onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">No specific job</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.number} - {job.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">No specific project</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.number} - {project.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
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
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Entry
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Helper
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}
