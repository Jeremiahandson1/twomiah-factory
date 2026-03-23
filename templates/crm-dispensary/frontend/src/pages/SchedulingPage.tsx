import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Clock, Users, Plus, ChevronLeft, ChevronRight, Download,
  RefreshCw, Check, X, Copy, Save, BarChart3, ArrowLeftRight
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const ROLE_COLORS: Record<string, string> = {
  budtender: 'bg-green-200 text-green-800 border-green-300',
  manager: 'bg-blue-200 text-blue-800 border-blue-300',
  security: 'bg-red-200 text-red-800 border-red-300',
  driver: 'bg-purple-200 text-purple-800 border-purple-300',
  inventory: 'bg-yellow-200 text-yellow-800 border-yellow-300',
  receptionist: 'bg-pink-200 text-pink-800 border-pink-300',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(offset: number): Date[] {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

export default function SchedulingPage() {
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('calendar');
  const [weekOffset, setWeekOffset] = useState(0);
  const [shifts, setShifts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Shift modal
  const [shiftModal, setShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [shiftForm, setShiftForm] = useState({
    userId: '', role: 'budtender', date: '', startTime: '09:00', endTime: '17:00',
    breakMinutes: '30', locationId: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Swap requests
  const [swapRequests, setSwapRequests] = useState<any[]>([]);

  // Time tracking
  const [timeEntries, setTimeEntries] = useState<any[]>([]);

  // Payroll export
  const [exportStart, setExportStart] = useState('');
  const [exportEnd, setExportEnd] = useState('');
  const [exporting, setExporting] = useState(false);

  const weekDates = getWeekDates(weekOffset);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const start = formatDate(weekDates[0]);
      const end = formatDate(weekDates[6]);
      const [shiftData, empData] = await Promise.all([
        api.get('/api/scheduling/shifts', { startDate: start, endDate: end }),
        api.get('/api/team', { limit: 100 }),
      ]);
      setShifts(Array.isArray(shiftData) ? shiftData : shiftData?.data || []);
      const emps = Array.isArray(empData) ? empData : empData?.data || [];
      setEmployees(emps);
    } catch (err) {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  const loadSwapRequests = async () => {
    try {
      const data = await api.get('/api/scheduling/shifts', { swapRequested: 'true' });
      setSwapRequests(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load swap requests');
    }
  };

  const loadTimeEntries = async () => {
    try {
      const start = formatDate(weekDates[0]);
      const end = formatDate(weekDates[6]);
      const data = await api.get('/api/scheduling/time-entries', { startDate: start, endDate: end });
      setTimeEntries(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load time entries');
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await api.get('/api/scheduling/templates');
      setTemplates(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load templates');
    }
  };

  useEffect(() => {
    if (tab === 'calendar') loadShifts();
    if (tab === 'swaps') loadSwapRequests();
    if (tab === 'time') loadTimeEntries();
    if (tab === 'templates') { loadTemplates(); loadShifts(); }
  }, [tab, weekOffset]);

  const openCreateShift = (date?: string, userId?: string) => {
    setEditingShift(null);
    setShiftForm({
      userId: userId || '', role: 'budtender', date: date || formatDate(weekDates[0]),
      startTime: '09:00', endTime: '17:00', breakMinutes: '30', locationId: '', notes: '',
    });
    setShiftModal(true);
  };

  const openEditShift = (shift: any) => {
    setEditingShift(shift);
    setShiftForm({
      userId: shift.userId || '', role: shift.role || 'budtender', date: shift.date || '',
      startTime: shift.startTime || '09:00', endTime: shift.endTime || '17:00',
      breakMinutes: String(shift.breakMinutes || 30), locationId: shift.locationId || '', notes: shift.notes || '',
    });
    setShiftModal(true);
  };

  const handleSaveShift = async () => {
    if (!shiftForm.userId || !shiftForm.date) { toast.error('Employee and date required'); return; }
    setSaving(true);
    try {
      const payload = { ...shiftForm, breakMinutes: parseInt(shiftForm.breakMinutes) || 0 };
      if (editingShift) {
        await api.put(`/api/scheduling/shifts/${editingShift.id}`, payload);
        toast.success('Shift updated');
      } else {
        await api.post('/api/scheduling/shifts', payload);
        toast.success('Shift created');
      }
      setShiftModal(false);
      loadShifts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (id: string) => {
    try {
      await api.delete(`/api/scheduling/shifts/${id}`);
      toast.success('Shift deleted');
      loadShifts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete shift');
    }
  };

  const handleSwapAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      await api.post(`/api/scheduling/swap-requests/${id}/${action}`);
      toast.success(`Swap ${action}d`);
      loadSwapRequests();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} swap`);
    }
  };

  const approveTimeEntry = async (id: string) => {
    try {
      await api.put(`/api/scheduling/time-entries/${id}/approve`);
      toast.success('Time entry approved');
      loadTimeEntries();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    }
  };

  const exportPayroll = async () => {
    if (!exportStart || !exportEnd) { toast.error('Select date range'); return; }
    setExporting(true);
    try {
      const data = await api.get('/api/scheduling/payroll-export', { startDate: exportStart, endDate: exportEnd, format: 'csv' });
      const blob = new Blob([data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll_${exportStart}_${exportEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Payroll exported');
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateName) { toast.error('Template name required'); return; }
    try {
      const start = formatDate(weekDates[0]);
      const end = formatDate(weekDates[6]);
      await api.post('/api/scheduling/templates', { name: templateName, startDate: start, endDate: end });
      toast.success('Template saved');
      setTemplateModal(false);
      setTemplateName('');
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template');
    }
  };

  const applyTemplate = async (templateId: string) => {
    try {
      const start = formatDate(weekDates[0]);
      await api.post(`/api/scheduling/templates/${templateId}/apply`, { startDate: start });
      toast.success('Template applied');
      loadShifts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply template');
    }
  };

  const getShiftsForCell = (employeeId: string, date: string) => {
    return shifts.filter(s => s.userId === employeeId && s.date === date);
  };

  const tabs = [
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'swaps', label: 'Swap Requests', icon: ArrowLeftRight },
    { id: 'time', label: 'Time Tracking', icon: Clock },
    { id: 'payroll', label: 'Payroll Export', icon: Download },
    { id: 'templates', label: 'Templates', icon: Copy },
    { id: 'forecast', label: 'Labor Forecast', icon: BarChart3 },
  ];

  return (
    <div>
      <PageHeader title="Employee Scheduling" action={
        <Button onClick={() => openCreateShift()}><Plus className="w-4 h-4 mr-2 inline" />Add Shift</Button>
      } />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Calendar Tab */}
      {tab === 'calendar' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-lg font-semibold">
              {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setWeekOffset(0)} className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">Today</button>
              <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 hover:bg-gray-100 rounded-lg">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Role legend */}
          <div className="flex gap-3 mb-4 flex-wrap">
            {Object.entries(ROLE_COLORS).map(([role, color]) => (
              <span key={role} className={`text-xs px-2 py-1 rounded ${color}`}>{role}</span>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-40">Employee</th>
                    {weekDates.map((d, i) => (
                      <th key={i} className="px-2 py-3 text-center text-sm font-medium text-gray-600">
                        <div>{DAYS[i]}</div>
                        <div className="text-xs text-gray-400">{d.getMonth() + 1}/{d.getDate()}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm font-medium">{emp.name}</td>
                      {weekDates.map((d, i) => {
                        const dateStr = formatDate(d);
                        const cellShifts = getShiftsForCell(emp.id, dateStr);
                        return (
                          <td key={i} className="px-1 py-1 text-center cursor-pointer hover:bg-green-50 min-w-[100px]"
                            onClick={() => cellShifts.length === 0 && openCreateShift(dateStr, emp.id)}>
                            {cellShifts.map(s => (
                              <div key={s.id}
                                className={`text-xs px-1 py-1 rounded border mb-1 cursor-pointer ${ROLE_COLORS[s.role] || 'bg-gray-100 text-gray-700'}`}
                                onClick={(e) => { e.stopPropagation(); openEditShift(s); }}>
                                {formatTime(s.startTime)}-{formatTime(s.endTime)}
                              </div>
                            ))}
                            {cellShifts.length === 0 && (
                              <div className="text-gray-300 text-xs">+</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-500">No employees found. Add team members first.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Swap Requests Tab */}
      {tab === 'swaps' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" />Pending Swap Requests</h3>
          {swapRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No pending swap requests</div>
          ) : (
            <div className="space-y-3">
              {swapRequests.map(req => (
                <div key={req.id} className="border rounded-lg p-4 flex items-center justify-between bg-white">
                  <div>
                    <div className="font-medium">{req.requesterName} <span className="text-gray-400 mx-2">&harr;</span> {req.targetName}</div>
                    <div className="text-sm text-gray-500">
                      {req.shiftDate} &middot; {formatTime(req.startTime)}-{formatTime(req.endTime)}
                    </div>
                    {req.reason && <div className="text-sm text-gray-600 mt-1">{req.reason}</div>}
                  </div>
                  {isManager && (
                    <div className="flex gap-2">
                      <button onClick={() => handleSwapAction(req.id, 'approve')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                        <Check className="w-4 h-4" />Approve
                      </button>
                      <button onClick={() => handleSwapAction(req.id, 'reject')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
                        <X className="w-4 h-4" />Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Time Tracking Tab */}
      {tab === 'time' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Clock className="w-5 h-5" />Time Entries</h3>
            <button onClick={loadTimeEntries} className="p-2 hover:bg-gray-100 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
          </div>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Clock In</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Clock Out</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Hours</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                  {isManager && <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {timeEntries.map(entry => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-4 py-3 text-sm font-medium">{entry.employeeName}</td>
                    <td className="px-4 py-3 text-sm">{entry.date}</td>
                    <td className="px-4 py-3 text-sm">{formatTime(entry.clockIn)}</td>
                    <td className="px-4 py-3 text-sm">{entry.clockOut ? formatTime(entry.clockOut) : <span className="text-yellow-600">Active</span>}</td>
                    <td className="px-4 py-3 text-sm font-medium">{entry.hours ? `${Number(entry.hours).toFixed(1)}h` : '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${entry.approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {entry.approved ? 'Approved' : 'Pending'}
                      </span>
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 text-sm">
                        {!entry.approved && (
                          <button onClick={() => approveTimeEntry(entry.id)} className="text-green-600 hover:text-green-800 text-sm font-medium">
                            Approve
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {timeEntries.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-500">No time entries for this week</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payroll Export Tab */}
      {tab === 'payroll' && (
        <div className="max-w-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><Download className="w-5 h-5" />Payroll Export</h3>
          <div className="bg-white border rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input type="date" value={exportStart} onChange={e => setExportStart(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <Button onClick={exportPayroll} disabled={exporting}>
              <Download className="w-4 h-4 mr-2 inline" />{exporting ? 'Exporting...' : 'Export to CSV'}
            </Button>
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Copy className="w-5 h-5" />Schedule Templates</h3>
            <Button onClick={() => setTemplateModal(true)}><Save className="w-4 h-4 mr-2 inline" />Save Current Week as Template</Button>
          </div>
          {templates.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No saved templates. Save your current week schedule as a template to reuse it.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(t => (
                <div key={t.id} className="border rounded-lg p-4 bg-white">
                  <div className="font-medium mb-1">{t.name}</div>
                  <div className="text-sm text-gray-500 mb-3">{t.shiftCount || 0} shifts &middot; Created {new Date(t.createdAt).toLocaleDateString()}</div>
                  <Button onClick={() => applyTemplate(t.id)}>Apply to Current Week</Button>
                </div>
              ))}
            </div>
          )}

          <Modal isOpen={templateModal} onClose={() => setTemplateModal(false)} title="Save Schedule Template" size="sm">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Template Name *</label>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Standard Week" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setTemplateModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
              <Button onClick={saveTemplate}>Save Template</Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Labor Forecast Tab */}
      {tab === 'forecast' && (
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5" />Labor Forecast</h3>
          <div className="border rounded-lg bg-white p-6">
            <div className="text-center text-gray-500 mb-4">Optimal Staffing by Hour</div>
            <div className="h-64 flex items-end justify-between gap-1 px-4">
              {Array.from({ length: 14 }, (_, i) => {
                const hour = i + 8; // 8am to 10pm
                const heights = [30, 35, 45, 55, 70, 85, 95, 100, 90, 80, 85, 95, 75, 50];
                return (
                  <div key={i} className="flex flex-col items-center flex-1">
                    <div className="bg-green-500 rounded-t w-full transition-all" style={{ height: `${heights[i]}%` }} />
                    <div className="text-xs text-gray-500 mt-1">{hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}</div>
                  </div>
                );
              })}
            </div>
            <div className="text-center text-sm text-gray-400 mt-4">
              Based on historical sales data and foot traffic patterns. Connect POS data for accurate forecasting.
            </div>
          </div>
        </div>
      )}

      {/* Shift Modal */}
      <Modal isOpen={shiftModal} onClose={() => setShiftModal(false)} title={editingShift ? 'Edit Shift' : 'Add Shift'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Employee *</label>
            <select value={shiftForm.userId} onChange={e => setShiftForm({ ...shiftForm, userId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg">
              <option value="">Select employee...</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select value={shiftForm.role} onChange={e => setShiftForm({ ...shiftForm, role: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg">
                {Object.keys(ROLE_COLORS).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date *</label>
              <input type="date" value={shiftForm.date} onChange={e => setShiftForm({ ...shiftForm, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Time</label>
              <input type="time" value={shiftForm.startTime} onChange={e => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Time</label>
              <input type="time" value={shiftForm.endTime} onChange={e => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Break (min)</label>
              <input type="number" value={shiftForm.breakMinutes} onChange={e => setShiftForm({ ...shiftForm, breakMinutes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <input value={shiftForm.locationId} onChange={e => setShiftForm({ ...shiftForm, locationId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Location ID" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={shiftForm.notes} onChange={e => setShiftForm({ ...shiftForm, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" rows={2} />
          </div>
        </div>
        <div className="flex justify-between mt-6">
          <div>
            {editingShift && (
              <button onClick={() => { handleDeleteShift(editingShift.id); setShiftModal(false); }}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm">Delete Shift</button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShiftModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
            <Button onClick={handleSaveShift} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
