import { useState, useEffect } from 'react';
import { 
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Clock, MapPin, Tag, Play, Loader2, Search,
  TrendingUp, Users, DollarSign, BarChart3
} from 'lucide-react';
import api from '../../services/api';

/**
 * Call Tracking Page
 */
export default function CallTrackingPage() {
  const [tab, setTab] = useState('calls'); // calls, numbers, reports
  const [calls, setCalls] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source: '',
    status: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.source) params.set('source', filters.source);
      if (filters.status) params.set('status', filters.status);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);

      const [callsRes, reportRes] = await Promise.all([
        api.get(`/api/calltracking/calls?${params}`),
        api.get(`/api/calltracking/reports/attribution?${params}`),
      ]);
      setCalls(callsRes.data || []);
      setReport(reportRes);
    } catch (error) {
      console.error('Failed to load call data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Tracking</h1>
          <p className="text-gray-500">Track calls and marketing attribution</p>
        </div>
      </div>

      {/* Stats */}
      {report && (
        <div className="grid grid-cols-5 gap-4">
          <StatCard icon={Phone} label="Total Calls" value={report.totals.totalCalls} />
          <StatCard icon={Users} label="First-Time Callers" value={report.totals.firstTimeCallers} color="blue" />
          <StatCard icon={Clock} label="Avg Duration" value={`${Math.round(report.totals.avgDuration / 60)}m`} color="purple" />
          <StatCard icon={Tag} label="Leads" value={report.totals.leads} color="green" />
          <StatCard icon={DollarSign} label="Lead Value" value={`$${report.totals.leadValue}`} color="orange" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'calls', label: 'Call Log', icon: Phone },
          { id: 'attribution', label: 'Attribution', icon: BarChart3 },
          { id: 'numbers', label: 'Tracking Numbers', icon: PhoneIncoming },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${
              tab === t.id
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {tab === 'calls' && (
            <CallsTab
              calls={calls}
              filters={filters}
              setFilters={setFilters}
              onRefresh={loadData}
            />
          )}
          {tab === 'attribution' && report && (
            <AttributionTab report={report} />
          )}
          {tab === 'numbers' && (
            <TrackingNumbersTab />
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function CallsTab({ calls, filters, setFilters, onRefresh }) {
  const sources = ['google_ads', 'facebook', 'yelp', 'website', 'direct_mail', 'organic'];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={filters.source}
          onChange={(e) => setFilters({ ...filters, source: e.target.value })}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Sources</option>
          {sources.map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="voicemail">Voicemail</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          className="px-4 py-2 border rounded-lg"
          placeholder="Start Date"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          className="px-4 py-2 border rounded-lg"
          placeholder="End Date"
        />
      </div>

      {/* Call List */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Caller</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Source</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Date/Time</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Duration</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {calls.map(call => (
              <CallRow key={call.id} call={call} />
            ))}
          </tbody>
        </table>
        {calls.length === 0 && (
          <div className="p-8 text-center text-gray-500">No calls found</div>
        )}
      </div>
    </div>
  );
}

function CallRow({ call }) {
  const StatusIcon = call.status === 'completed' ? PhoneIncoming : 
                     call.status === 'missed' ? PhoneMissed : Phone;
  
  const statusColors = {
    completed: 'text-green-600 bg-green-50',
    missed: 'text-red-600 bg-red-50',
    voicemail: 'text-yellow-600 bg-yellow-50',
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusColors[call.status] || 'bg-gray-100'}`}>
            <StatusIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-gray-900">
              {call.callerName || call.callerNumber}
            </p>
            <p className="text-sm text-gray-500">{call.callerNumber}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">
          {call.source || 'unknown'}
        </span>
        {call.firstTimeCaller && (
          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
            New
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500">
        <p>{new Date(call.startTime).toLocaleDateString()}</p>
        <p className="text-sm">{new Date(call.startTime).toLocaleTimeString()}</p>
      </td>
      <td className="px-4 py-3 text-gray-500">
        {call.duration > 0 ? formatDuration(call.duration) : '-'}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 text-xs rounded-full ${statusColors[call.status] || 'bg-gray-100 text-gray-600'}`}>
          {call.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {call.recordingUrl && (
          <a
            href={call.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            <Play className="w-4 h-4" />
          </a>
        )}
      </td>
    </tr>
  );
}

function AttributionTab({ report }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* By Source */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-medium text-gray-900 mb-4">Calls by Source</h3>
        <div className="space-y-4">
          {report.bySource.map(source => (
            <div key={source.source} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-gray-700 capitalize">
                  {source.source.replace('_', ' ')}
                </span>
              </div>
              <div className="text-right">
                <p className="font-medium">{source.calls} calls</p>
                <p className="text-sm text-gray-500">
                  avg {formatDuration(source.avgDuration)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-medium text-gray-900 mb-4">Summary</h3>
        <div className="space-y-4">
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Total Calls</span>
            <span className="font-bold">{report.totals.totalCalls}</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">First-Time Callers</span>
            <span className="font-bold">{report.totals.firstTimeCallers}</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Total Talk Time</span>
            <span className="font-bold">{formatDuration(report.totals.totalDuration)}</span>
          </div>
          <div className="flex justify-between p-3 bg-green-50 rounded-lg">
            <span className="text-green-700">Leads Generated</span>
            <span className="font-bold text-green-700">{report.totals.leads}</span>
          </div>
          <div className="flex justify-between p-3 bg-orange-50 rounded-lg">
            <span className="text-orange-700">Lead Value</span>
            <span className="font-bold text-orange-700">${report.totals.leadValue}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackingNumbersTab() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNumbers();
  }, []);

  const loadNumbers = async () => {
    try {
      const data = await api.get('/api/calltracking/numbers');
      setNumbers(data || []);
    } catch (error) {
      console.error('Failed to load numbers:', error);
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

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Tracking Numbers</h3>
        <p className="text-sm text-gray-500">
          Configure in CallRail, CTM, or Twilio
        </p>
      </div>
      {numbers.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <Phone className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No tracking numbers configured</p>
          <p className="text-sm mt-2">
            Set up tracking numbers in your call tracking provider
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Number</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Name</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Source</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Forwards To</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Calls</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {numbers.map(num => (
              <tr key={num.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">{num.phoneNumber}</td>
                <td className="px-4 py-3">{num.name || '-'}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">
                    {num.source}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-gray-500">{num.forwardTo}</td>
                <td className="px-4 py-3 text-right font-medium">{num._count?.calls || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
