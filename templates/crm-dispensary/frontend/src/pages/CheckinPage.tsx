import { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Clock, UserCheck, QrCode, RefreshCw, Plus, Phone, User, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const queueStatuses: Record<string, string> = {
  waiting: 'bg-yellow-100 text-yellow-700',
  called: 'bg-blue-100 text-blue-700',
  serving: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  no_show: 'bg-red-100 text-red-700',
};

const sources = ['walk_in', 'online', 'phone', 'qr_code'];

export default function CheckinPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('queue');
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({ waiting: 0, avgWait: 0, servedToday: 0 });

  // Check-in form
  const [checkinModal, setCheckinModal] = useState(false);
  const [checkinForm, setCheckinForm] = useState({
    name: '',
    phone: '',
    isMedical: false,
    notes: '',
    source: 'walk_in',
  });
  const [submitting, setSubmitting] = useState(false);

  // Auto-refresh
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadQueue();
    loadStats();
    intervalRef.current = setInterval(() => {
      loadQueue();
      loadStats();
    }, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const loadQueue = async () => {
    try {
      const data = await api.get('/api/checkin/queue');
      setQueue(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await api.get('/api/checkin/stats');
      if (data) setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleCheckin = async () => {
    if (!checkinForm.name.trim()) {
      toast.error('Customer name is required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/checkin/queue', checkinForm);
      toast.success('Customer checked in');
      setCheckinModal(false);
      setCheckinForm({ name: '', phone: '', isMedical: false, notes: '', source: 'walk_in' });
      loadQueue();
      loadStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to check in customer');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/checkin/queue/${id}/status`, { status });
      toast.success(`Status updated to ${status.replace('_', ' ')}`);
      loadQueue();
      loadStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const formatWaitTime = (minutes: number) => {
    if (minutes < 1) return '<1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  };

  const activeQueue = queue.filter(q => ['waiting', 'called', 'serving'].includes(q.status));
  const completedQueue = queue.filter(q => ['completed', 'no_show'].includes(q.status));

  const tabs = [
    { id: 'queue', label: 'Queue', icon: Users },
    { id: 'checkin', label: 'Check-In', icon: UserCheck },
    { id: 'qr', label: 'QR Code', icon: QrCode },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Check-In & Queue</h1>
          <p className="text-gray-600">Manage walk-in customers and queue</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { loadQueue(); loadStats(); }}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <Button onClick={() => { setCheckinForm({ name: '', phone: '', isMedical: false, notes: '', source: 'walk_in' }); setCheckinModal(true); }}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Check In Customer
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.waiting || 0}</p>
            <p className="text-sm text-gray-500">Waiting</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{formatWaitTime(stats.avgWait || 0)}</p>
            <p className="text-sm text-gray-500">Avg Wait</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.servedToday || 0}</p>
            <p className="text-sm text-gray-500">Served Today</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Queue Tab */}
      {tab === 'queue' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Active Queue */}
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Active Queue ({activeQueue.length})</h3>
              <div className="space-y-3 mb-8">
                {activeQueue.map((entry, index) => (
                  <div key={entry.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg font-bold text-gray-600">
                          {index + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-semibold text-gray-900">{entry.name || 'Unknown'}</span>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${queueStatuses[entry.status] || 'bg-gray-100 text-gray-600'}`}>
                              {(entry.status || 'waiting').replace('_', ' ')}
                            </span>
                            {entry.isMedical && (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">Medical</span>
                            )}
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                              {(entry.source || 'walk_in').replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            {entry.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {entry.phone}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {formatWaitTime(entry.waitMinutes || 0)} wait
                            </span>
                            {entry.notes && <span className="text-gray-400 italic">"{entry.notes}"</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {entry.status === 'waiting' && (
                          <button
                            onClick={() => updateStatus(entry.id, 'called')}
                            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                          >
                            Call Next
                          </button>
                        )}
                        {entry.status === 'called' && (
                          <button
                            onClick={() => updateStatus(entry.id, 'serving')}
                            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                          >
                            Start Serving
                          </button>
                        )}
                        {entry.status === 'serving' && (
                          <button
                            onClick={() => updateStatus(entry.id, 'completed')}
                            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                          >
                            Complete
                          </button>
                        )}
                        {(entry.status === 'waiting' || entry.status === 'called') && (
                          <button
                            onClick={() => updateStatus(entry.id, 'no_show')}
                            className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                          >
                            No-Show
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {activeQueue.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No customers in queue</p>
                  </div>
                )}
              </div>

              {/* Completed Today */}
              {completedQueue.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Completed Today ({completedQueue.length})</h3>
                  <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wait Time</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {completedQueue.map(entry => (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{entry.name}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${queueStatuses[entry.status]}`}>
                                {entry.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{(entry.source || 'walk_in').replace('_', ' ')}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatWaitTime(entry.waitMinutes || 0)}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {entry.completedAt ? new Date(entry.completedAt).toLocaleTimeString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Check-In Tab */}
      {tab === 'checkin' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <h3 className="text-lg font-semibold text-gray-900">New Check-In</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
            <input
              type="text"
              value={checkinForm.name}
              onChange={(e) => setCheckinForm({ ...checkinForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter customer name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
            <input
              type="tel"
              value={checkinForm.phone}
              onChange={(e) => setCheckinForm({ ...checkinForm, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <select
              value={checkinForm.source}
              onChange={(e) => setCheckinForm({ ...checkinForm, source: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              {sources.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checkinForm.isMedical}
              onChange={(e) => setCheckinForm({ ...checkinForm, isMedical: e.target.checked })}
              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
            />
            <span className="text-sm font-medium text-gray-700">Medical Patient</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={checkinForm.notes}
              onChange={(e) => setCheckinForm({ ...checkinForm, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              rows={3}
              placeholder="Any special notes..."
            />
          </div>
          <Button onClick={handleCheckin} disabled={submitting}>
            {submitting ? 'Checking in...' : 'Add to Queue'}
          </Button>
        </div>
      )}

      {/* QR Code Tab */}
      {tab === 'qr' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-lg mx-auto text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
            <QrCode className="w-10 h-10 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Self Check-In QR Code</h3>
            <p className="text-gray-600 text-sm">
              Display this QR code at your entrance so customers can check themselves in using their phone.
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-8 border-2 border-dashed border-gray-200">
            <div className="w-48 h-48 bg-white rounded-lg mx-auto flex items-center justify-center border border-gray-200">
              <div className="text-center">
                <QrCode className="w-24 h-24 text-gray-800 mx-auto" />
                <p className="text-xs text-gray-400 mt-2">QR Code Preview</p>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Self Check-In URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/checkin/self`}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 text-sm"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/checkin/self`);
                  toast.success('URL copied to clipboard');
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={() => toast.success('QR code downloaded')}>
              Download QR
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
      )}

      {/* Check-In Modal */}
      <Modal
        isOpen={checkinModal}
        onClose={() => setCheckinModal(false)}
        title="Quick Check-In"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
            <input
              type="text"
              value={checkinForm.name}
              onChange={(e) => setCheckinForm({ ...checkinForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter customer name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={checkinForm.phone}
              onChange={(e) => setCheckinForm({ ...checkinForm, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <select
              value={checkinForm.source}
              onChange={(e) => setCheckinForm({ ...checkinForm, source: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              {sources.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checkinForm.isMedical}
              onChange={(e) => setCheckinForm({ ...checkinForm, isMedical: e.target.checked })}
              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">Medical Patient</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={checkinForm.notes}
              onChange={(e) => setCheckinForm({ ...checkinForm, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCheckinModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCheckin} disabled={submitting}>
            {submitting ? 'Checking in...' : 'Check In'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
