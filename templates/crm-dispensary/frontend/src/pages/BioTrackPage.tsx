import { useState, useEffect } from 'react';
import { Shield, Settings, History, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';

const US_STATES = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN',
  'KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ',
  'NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA',
  'WI','WV','WY',
];

const initialConfig = {
  username: '',
  password: '',
  licenseNumber: '',
  state: '',
  apiUrl: '',
  autoSync: false,
  syncInterval: 60,
};

export default function BioTrackPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('config');

  // Config
  const [config, setConfig] = useState(initialConfig);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Sync status
  const [syncStatus, setSyncStatus] = useState<any>(null);

  // Sync Log
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadConfig();
    loadSyncStatus();
  }, []);

  useEffect(() => {
    if (tab === 'sync') loadSyncLogs();
  }, [tab]);

  const loadConfig = async () => {
    try {
      const data = await api.get('/api/biotrack/config');
      if (data) {
        setConfig({
          username: data.username || '',
          password: data.password || '',
          licenseNumber: data.licenseNumber || '',
          state: data.state || '',
          apiUrl: data.apiUrl || '',
          autoSync: data.autoSync ?? false,
          syncInterval: data.syncInterval || 60,
        });
      }
    } catch (err) {
      console.error('Failed to load BioTrack config:', err);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const data = await api.get('/api/biotrack/sync/status');
      setSyncStatus(data);
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/biotrack/config', config);
      toast.success('BioTrack configuration saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await api.post('/api/biotrack/config/test', config);
      if (result?.success) {
        toast.success('Connection successful');
      } else {
        toast.error(result?.message || 'Connection failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed');
    } finally {
      setTestingConnection(false);
    }
  };

  const loadSyncLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await api.get('/api/biotrack/sync/log');
      setSyncLogs(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load sync logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await api.post('/api/biotrack/sync');
      toast.success('Sync started');
      loadSyncLogs();
      loadSyncStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start sync');
    } finally {
      setSyncing(false);
    }
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'sync', label: 'Sync Log', icon: History },
  ];

  const syncStatusColor = syncStatus?.status === 'success' ? 'text-green-600' : syncStatus?.status === 'error' ? 'text-red-600' : 'text-gray-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BioTrack Compliance</h1>
          <p className="text-gray-600">Track-and-trace integration with BioTrack THC</p>
        </div>
      </div>

      {/* Sync Status Bar */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {syncStatus?.status === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : syncStatus?.status === 'error' ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${syncStatusColor}`}>
              {syncStatus?.status === 'success' ? 'Synced' : syncStatus?.status === 'error' ? 'Sync Error' : 'Not Synced'}
            </span>
          </div>
          {syncStatus?.lastSyncAt && (
            <span className="text-sm text-gray-500">
              Last sync: {new Date(syncStatus.lastSyncAt).toLocaleString()}
            </span>
          )}
          <span className="text-sm text-gray-500">
            Auto-sync: {config.autoSync ? 'On' : 'Off'}
          </span>
        </div>
        <Button onClick={triggerSync} disabled={syncing} variant="secondary" size="sm">
          <RefreshCw className={`w-4 h-4 mr-2 inline ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
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

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter BioTrack username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={config.password}
              onChange={(e) => setConfig({ ...config, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter BioTrack password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
            <input
              type="text"
              value={config.licenseNumber}
              onChange={(e) => setConfig({ ...config, licenseNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="e.g., 412345"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API URL</label>
            <input
              type="url"
              value={config.apiUrl}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="https://wslcb.mjtraceability.com/serverjson.asp"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select
              value={config.state}
              onChange={(e) => setConfig({ ...config, state: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Select state</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoSync}
                onChange={(e) => setConfig({ ...config, autoSync: e.target.checked })}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Auto-Sync</span>
            </label>
            {config.autoSync && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Interval (min):</label>
                <input
                  type="number"
                  min={5}
                  value={config.syncInterval}
                  onChange={(e) => setConfig({ ...config, syncInterval: parseInt(e.target.value) || 60 })}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </Button>
            <Button onClick={testConnection} disabled={testingConnection} variant="secondary">
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>
        </div>
      )}

      {/* Sync Log Tab */}
      {tab === 'sync' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={triggerSync} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 mr-2 inline ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Manual Sync'}
            </Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Records</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingLogs ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center">
                      <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : syncLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No sync history</td>
                  </tr>
                ) : syncLogs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{log.syncType || log.type || 'Full'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        log.status === 'success' ? 'bg-green-100 text-green-700' :
                        log.status === 'error' ? 'bg-red-100 text-red-700' :
                        log.status === 'running' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {log.status || 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{log.recordCount ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{log.duration ? `${log.duration}s` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">{log.details || log.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
