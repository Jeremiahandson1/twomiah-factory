import { useState, useEffect, useCallback } from 'react';
import { 
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon,
  Clock, MapPin, User, Loader2, GripVertical
} from 'lucide-react';
import api from '../../services/api';

/**
 * Drag and Drop Calendar
 * 
 * Features:
 * - Month/Week/Day views
 * - Drag jobs to reschedule
 * - Drop zones for each day
 * - Visual time slots
 */
export default function DragDropCalendar() {
  const [view, setView] = useState('week'); // month, week, day
  const [currentDate, setCurrentDate] = useState(new Date());
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draggingJob, setDraggingJob] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  useEffect(() => {
    loadJobs();
  }, [currentDate, view]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: '200',
      });
      const response = await api.get(`/jobs?${params}`);
      setJobs(response.data || response || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = () => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);

    if (view === 'month') {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
    } else if (view === 'week') {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      end.setDate(end.getDate() + (6 - day));
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const handleDragStart = (e, job) => {
    setDraggingJob(job);
    e.dataTransfer.setData('text/plain', job.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, date) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(date.toDateString());
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e, date) => {
    e.preventDefault();
    setDropTarget(null);

    if (!draggingJob) return;

    // Preserve original time if exists, just change date
    const newDate = new Date(date);
    if (draggingJob.scheduledDate) {
      const oldDate = new Date(draggingJob.scheduledDate);
      newDate.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0);
    } else {
      newDate.setHours(9, 0, 0, 0); // Default to 9 AM
    }

    try {
      await api.put(`/jobs/${draggingJob.id}`, {
        scheduledDate: newDate.toISOString(),
      });

      // Update local state
      setJobs(prev => prev.map(j => 
        j.id === draggingJob.id 
          ? { ...j, scheduledDate: newDate.toISOString() }
          : j
      ));
    } catch (error) {
      alert('Failed to reschedule job');
    }

    setDraggingJob(null);
  };

  const navigate = (direction) => {
    const newDate = new Date(currentDate);
    if (view === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else if (view === 'week') {
      newDate.setDate(newDate.getDate() + (7 * direction));
    } else {
      newDate.setDate(newDate.getDate() + direction);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getJobsForDate = (date) => {
    return jobs.filter(job => {
      if (!job.scheduledDate) return false;
      const jobDate = new Date(job.scheduledDate);
      return jobDate.toDateString() === date.toDateString();
    });
  };

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            Today
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 hover:bg-gray-100 rounded"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigate(1)}
              className="p-1.5 hover:bg-gray-100 rounded"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <h2 className="text-lg font-semibold">
            {currentDate.toLocaleDateString('en-US', { 
              month: 'long', 
              year: 'numeric',
              ...(view === 'day' ? { day: 'numeric' } : {}),
            })}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          <div className="flex border rounded-lg overflow-hidden">
            {['month', 'week', 'day'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${
                  view === v ? 'bg-orange-500 text-white' : 'hover:bg-gray-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      {view === 'month' && (
        <MonthView
          currentDate={currentDate}
          jobs={jobs}
          getJobsForDate={getJobsForDate}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          dropTarget={dropTarget}
        />
      )}

      {view === 'week' && (
        <WeekView
          currentDate={currentDate}
          jobs={jobs}
          getJobsForDate={getJobsForDate}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          dropTarget={dropTarget}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          jobs={getJobsForDate(currentDate)}
          onDragStart={handleDragStart}
        />
      )}
    </div>
  );
}

function MonthView({ currentDate, getJobsForDate, onDragStart, onDragOver, onDragLeave, onDrop, dropTarget }) {
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];

    // Add padding for first week
    for (let i = 0; i < firstDay.getDay(); i++) {
      const date = new Date(year, month, -i);
      days.unshift({ date, isCurrentMonth: false });
    }

    // Add days of month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    // Add padding for last week
    const remaining = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  };

  const days = getDaysInMonth();
  const today = new Date().toDateString();

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7">
        {days.map(({ date, isCurrentMonth }, i) => {
          const dateStr = date.toDateString();
          const dayJobs = getJobsForDate(date);
          const isToday = dateStr === today;
          const isDropTarget = dropTarget === dateStr;

          return (
            <div
              key={i}
              className={`min-h-24 border-b border-r p-1 transition-colors ${
                !isCurrentMonth ? 'bg-gray-50' : ''
              } ${isDropTarget ? 'bg-orange-100' : ''}`}
              onDragOver={(e) => onDragOver(e, date)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, date)}
            >
              <div className={`text-sm mb-1 ${
                isToday 
                  ? 'w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center' 
                  : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
              }`}>
                {date.getDate()}
              </div>
              <div className="space-y-1">
                {dayJobs.slice(0, 3).map((job) => (
                  <JobChip 
                    key={job.id} 
                    job={job} 
                    onDragStart={onDragStart}
                    compact
                  />
                ))}
                {dayJobs.length > 3 && (
                  <div className="text-xs text-gray-500 px-1">
                    +{dayJobs.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ currentDate, getJobsForDate, onDragStart, onDragOver, onDragLeave, onDrop, dropTarget }) {
  const getWeekDays = () => {
    const days = [];
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());

    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      days.push(date);
    }

    return days;
  };

  const days = getWeekDays();
  const today = new Date().toDateString();

  return (
    <div className="grid grid-cols-7 min-h-96">
      {days.map((date, i) => {
        const dateStr = date.toDateString();
        const dayJobs = getJobsForDate(date);
        const isToday = dateStr === today;
        const isDropTarget = dropTarget === dateStr;

        return (
          <div
            key={i}
            className={`border-r last:border-r-0 flex flex-col ${
              isDropTarget ? 'bg-orange-50' : ''
            }`}
            onDragOver={(e) => onDragOver(e, date)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, date)}
          >
            {/* Day header */}
            <div className={`p-3 text-center border-b ${isToday ? 'bg-orange-50' : ''}`}>
              <div className="text-xs text-gray-500 uppercase">
                {date.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className={`text-lg font-semibold ${
                isToday ? 'text-orange-600' : 'text-gray-900'
              }`}>
                {date.getDate()}
              </div>
            </div>

            {/* Jobs */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {dayJobs.map((job) => (
                <JobChip 
                  key={job.id} 
                  job={job} 
                  onDragStart={onDragStart}
                />
              ))}
              {dayJobs.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-4">
                  No jobs
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ currentDate, jobs, onDragStart }) {
  // Time slots from 6 AM to 8 PM
  const hours = Array.from({ length: 15 }, (_, i) => i + 6);

  const getJobsForHour = (hour) => {
    return jobs.filter(job => {
      const jobDate = new Date(job.scheduledDate);
      return jobDate.getHours() === hour;
    });
  };

  return (
    <div className="max-h-[600px] overflow-y-auto">
      {hours.map((hour) => {
        const hourJobs = getJobsForHour(hour);
        const timeLabel = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`;

        return (
          <div key={hour} className="flex border-b min-h-16">
            <div className="w-20 p-2 text-sm text-gray-500 text-right border-r flex-shrink-0">
              {timeLabel}
            </div>
            <div className="flex-1 p-2">
              <div className="space-y-2">
                {hourJobs.map((job) => (
                  <JobChip 
                    key={job.id} 
                    job={job} 
                    onDragStart={onDragStart}
                    detailed
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JobChip({ job, onDragStart, compact = false, detailed = false }) {
  const statusColors = {
    pending: 'bg-gray-100 border-gray-300',
    scheduled: 'bg-blue-100 border-blue-300',
    in_progress: 'bg-yellow-100 border-yellow-300',
    completed: 'bg-green-100 border-green-300',
    cancelled: 'bg-red-100 border-red-300',
  };

  const time = job.scheduledDate 
    ? new Date(job.scheduledDate).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
      })
    : null;

  if (compact) {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, job)}
        className={`px-1.5 py-0.5 text-xs rounded truncate cursor-move border ${
          statusColors[job.status] || 'bg-gray-100'
        }`}
        title={job.title}
      >
        {job.title}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      className={`p-2 rounded-lg border cursor-move hover:shadow transition-shadow ${
        statusColors[job.status] || 'bg-gray-100'
      }`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{job.title}</p>
          {detailed && (
            <div className="mt-1 space-y-1 text-xs text-gray-500">
              {time && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {time}
                </div>
              )}
              {job.address && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  <span className="truncate">{job.address}</span>
                </div>
              )}
              {job.assignedTo && (
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {job.assignedTo.firstName}
                </div>
              )}
            </div>
          )}
          {!detailed && time && (
            <p className="text-xs text-gray-500">{time}</p>
          )}
        </div>
      </div>
    </div>
  );
}
