import { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';

export default function SchedulePage() {
  const toast = useToast();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    
    api.jobs.list({ startDate: startOfWeek.toISOString(), endDate: endOfWeek.toISOString(), limit: 100 })
      .then(res => setJobs(res.data))
      .catch(() => toast.error('Failed to load schedule'))
      .finally(() => setLoading(false));
  }, [currentDate]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const getJobsForDay = (date) => jobs.filter(j => j.scheduledDate && new Date(j.scheduledDate).toDateString() === date.toDateString());

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-medium">{startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="grid grid-cols-7 gap-4">
          {days.map((day, i) => (
            <div key={i} className={`bg-white rounded-lg shadow-sm overflow-hidden ${day.toDateString() === new Date().toDateString() ? 'ring-2 ring-orange-500' : ''}`}>
              <div className={`px-3 py-2 text-center border-b ${day.toDateString() === new Date().toDateString() ? 'bg-orange-500 text-white' : 'bg-gray-50'}`}>
                <p className="text-xs font-medium">{weekDays[i]}</p>
                <p className="text-lg font-bold">{day.getDate()}</p>
              </div>
              <div className="p-2 space-y-2 min-h-[200px]">
                {getJobsForDay(day).map(job => (
                  <div key={job.id} className={`p-2 rounded text-xs ${job.status === 'completed' ? 'bg-green-50 border-l-2 border-green-500' : job.status === 'in_progress' ? 'bg-blue-50 border-l-2 border-blue-500' : 'bg-gray-50 border-l-2 border-gray-300'}`}>
                    <p className="font-medium truncate">{job.title}</p>
                    {job.scheduledTime && <p className="text-gray-500">{job.scheduledTime}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
