import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function SchedulePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  // Native HTML5 drag-and-drop (same pattern as the CVHC scheduler): the block
  // being dragged, and the cell currently hovered for a highlight.
  const [dragJob, setDragJob] = useState<any>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const load = useCallback(() => {
    const sow = new Date(currentDate);
    sow.setDate(sow.getDate() - sow.getDay());
    const eow = new Date(sow);
    eow.setDate(eow.getDate() + 6);
    setLoading(true);
    api.jobs.list({ startDate: sow.toISOString(), endDate: eow.toISOString(), limit: 100 })
      .then((res) => setJobs(res.data || []))
      .catch(() => toast.error('Failed to load schedule'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  useEffect(() => { load(); }, [load]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  // scheduledDate is a calendar date stored at UTC midnight; compare on the UTC
  // date portion so a local-time conversion doesn't shift it a day.
  const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const getJobsForDay = (date: Date) => jobs.filter(j => j.scheduledDate && String(j.scheduledDate).slice(0, 10) === localKey(date));

  // Drop a job onto a day → reschedule it to that date. Optimistic, then persist.
  const handleDrop = async (day: Date) => {
    const job = dragJob;
    setDragJob(null);
    setDragOverKey(null);
    if (!job) return;
    const target = localKey(day);
    if (String(job.scheduledDate).slice(0, 10) === target) return; // no move
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, scheduledDate: target } : j)));
    try {
      await api.jobs.update(job.id, { scheduledDate: target });
      toast.success(`Moved to ${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
      load();
    } catch {
      toast.error('Could not reschedule');
      load();
    }
  };

  const isToday = (day: Date) => day.toDateString() === new Date().toDateString();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">Drag a job to another day to reschedule it.</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-medium">{startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="grid grid-cols-7 gap-4">
          {days.map((day, i) => {
            const cellKey = localKey(day);
            return (
              <div
                key={i}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(cellKey); }}
                onDragLeave={() => { if (dragOverKey === cellKey) setDragOverKey(null); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(day); }}
                className={`bg-white rounded-lg shadow-sm overflow-hidden transition ${isToday(day) ? 'ring-2 ring-orange-500' : ''} ${dragOverKey === cellKey ? 'ring-2 ring-blue-400 bg-blue-50/40' : ''}`}
              >
                <div className={`px-3 py-2 text-center border-b ${isToday(day) ? 'bg-orange-500 text-white' : 'bg-gray-50'}`}>
                  <p className="text-xs font-medium">{weekDays[i]}</p>
                  <p className="text-lg font-bold">{day.getDate()}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[200px]">
                  {getJobsForDay(day).map(job => (
                    <div
                      key={job.id}
                      draggable
                      onDragStart={(e) => { setDragJob(job); try { e.dataTransfer.setData('text/plain', job.id); } catch {} e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDragJob(null); setDragOverKey(null); }}
                      onClick={() => navigate(`/crm/jobs/${job.id}`)}
                      title="Drag to reschedule · click to open"
                      className={`p-2 rounded text-xs cursor-move hover:shadow-sm ${job.status === 'completed' ? 'bg-green-50 border-l-2 border-green-500' : job.status === 'in_progress' ? 'bg-blue-50 border-l-2 border-blue-500' : 'bg-gray-50 border-l-2 border-gray-300'}`}
                    >
                      <p className="font-medium truncate">{job.title}</p>
                      {job.scheduledTime && <p className="text-gray-500 dark:text-slate-400">{job.scheduledTime}</p>}
                    </div>
                  ))}
                  {getJobsForDay(day).length === 0 && (
                    <p className="text-[11px] text-gray-300 text-center pt-4 select-none">Drop a job here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
