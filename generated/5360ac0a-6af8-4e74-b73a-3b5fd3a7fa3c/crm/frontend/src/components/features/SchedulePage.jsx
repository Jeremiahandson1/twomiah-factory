import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin, User } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { Card, CardHeader, CardBody, Button, StatusBadge } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

export function SchedulePage() {
  const { instance } = useOutletContext();
  const { jobs } = useCRMDataStore();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const primaryColor = instance.primaryColor || '#ec7619';

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const jobsByDate = useMemo(() => {
    const map = {};
    jobs.forEach(job => {
      if (job.scheduledDate) {
        const dateKey = format(new Date(job.scheduledDate), 'yyyy-MM-dd');
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(job);
      }
    });
    return map;
  }, [jobs]);

  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedJobs = jobsByDate[selectedDateKey] || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Schedule</h1><p className="text-slate-400 mt-1">View and manage your calendar</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{format(currentMonth, 'MMMM yyyy')}</h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} icon={ChevronLeft} />
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} icon={ChevronRight} />
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-slate-500 py-2">{day}</div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayJobs = jobsByDate[dateKey] || [];
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isSelected = isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());
                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDate(day)}
                    className={`
                      min-h-[80px] p-2 rounded-lg text-left transition-colors border
                      ${isCurrentMonth ? 'bg-slate-800/50' : 'bg-slate-900/50'}
                      ${isSelected ? 'border-2' : 'border-transparent hover:border-slate-700'}
                    `}
                    style={isSelected ? { borderColor: primaryColor } : {}}
                  >
                    <div className={`text-sm font-medium mb-1 ${isToday ? 'w-6 h-6 rounded-full flex items-center justify-center text-white' : ''} ${isCurrentMonth ? 'text-slate-300' : 'text-slate-600'}`} style={isToday ? { backgroundColor: primaryColor } : {}}>
                      {format(day, 'd')}
                    </div>
                    {dayJobs.slice(0, 2).map((job, i) => (
                      <div key={i} className="text-xs truncate rounded px-1 py-0.5 mb-0.5" style={{ backgroundColor: `${primaryColor}30`, color: primaryColor }}>{job.title}</div>
                    ))}
                    {dayJobs.length > 2 && <div className="text-xs text-slate-500">+{dayJobs.length - 2} more</div>}
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Selected Day Detail */}
        <Card>
          <CardHeader title={format(selectedDate, 'EEEE, MMMM d')} subtitle={`${selectedJobs.length} jobs scheduled`} />
          <CardBody className="p-0">
            {selectedJobs.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {selectedJobs.map((job) => (
                  <div key={job.id} className="p-4 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-1 h-12 rounded-full" style={{ backgroundColor: primaryColor }} />
                      <div className="flex-1">
                        <p className="font-medium text-white">{job.title}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                          {job.assignee && <div className="flex items-center gap-1"><User className="w-3 h-3" />{job.assignee}</div>}
                          {job.estimatedHours && <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{job.estimatedHours}h</div>}
                        </div>
                        <div className="mt-2"><StatusBadge status={job.status} /></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No jobs scheduled</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
