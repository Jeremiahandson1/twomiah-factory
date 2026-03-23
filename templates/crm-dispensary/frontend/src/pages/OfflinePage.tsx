import { useState, useEffect } from 'react';
import {
  Wifi, WifiOff, RefreshCw, Settings, List, Info, Clock,
  CheckCircle, XCircle, AlertTriangle, RotateCcw, SkipForward
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const SYNC_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  syncing: 'bg-blue-100 text-blue-700',
  synced: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

export default function OfflinePage() {
  const toast = useToast();
  const [tab, setTab] = useState('status');
  const [loading, setLoading] = useState(true);

  // Status
  const [status, setStatus] = useState<any>({
    online: navigator.onLine,
    lastSync: null,
    pendingCount: 0,
    failedCount: 0,
  });

  // Config
  const [config, setConfig] = useState({
    offlineEnabled: true,
    maxQueueSize: '500',
    syncRetrySeconds: '30',
    offlinePOS: true,
    offlineCheckin: true,
    offlineInventoryCount: true,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Queue
  const [queue, setQueue] = useState<any[]>([]);

  useEffect(() => {
    const handleOnline = () => setStatus((s: any) => ({ ...s, online: true }));
    const handleOffline = () => setStatus((s: any) => ({ ...s, online: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (tab === 'status') loadStatus();
    if (tab === 'config') loadConfig();
    if (tab === 'queue') loadQueue();
  }, [tab]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/offline/status');
      if (data) {
        setStatus({
          online: navigator.onLine,
          lastSync: data.lastSync || null,
          pendingCount: data.pendingCount || 0,
          failedCount: data.failedCount || 0,
          syncInProgress: data.syncInProgress || false,
        });
      }
    } catch (err) {
      // May fail if offline, use local state
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/offline/config');
      if (data) {
        setConfig({
          offlineEnabled: data.offlineEnabled ?? true,
          maxQueueSize: String(data.maxQueueSize ?? 500),
          syncRetrySeconds: String(data.syncRetrySeconds ?? 30),
          offlinePOS: data.offlinePOS ?? true,
          offlineCheckin: data.offlineCheckin ?? true,
          offlineInventoryCount: data.offlineInventoryCount ?? true,
        });
      }
    } catch (err) {
      toast.error('Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  const loadQueue = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/offline/queue');
      setQueue(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/offline/config', {
        ...config,
        maxQueueSize: parseInt(config.maxQueueSize) || 500,
        syncRetrySeconds: parseInt(config.syncRetrySeconds) || 30,
      });
      toast.success('Config saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  const forceSync = async () => {
    try {
      await api.post('/api/offline/sync');
      toast.success('Sync initiated');
      loadStatus();
      loadQueue();
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    }
  };

  const retryItem = async (id: string) => {
    try {
      await api.post(`/api/offline/queue/${id}/retry`);
      toast.success('Retrying...');
      loadQueue();
    } catch (err: any) {
      toast.error(err.message || 'Retry failed');
    }
  };

  const skipItem = async (id: string) => {
    try {
      await api.post(`/api/offline/queue/${id}/skip`);
      toast.success('Skipped');
      loadQueue();
    } catch (err: any) {
      toast.error(err.message || 'Skip failed');
    }
  };

  const tabs = [
    { id: 'status', label: 'Status', icon: Wifi },
    { id: 'config', label: 'Config', icon: Settings },
    { id: 'queue', label: 'Queue', icon: List },
    { id: 'instructions', label: 'Help', icon: Info },
  ];

  return (
    <div>
      <PageHeader title="Offline Mode" action={
        <Button onClick={forceSync}><RefreshCw className="w-4 h-4 mr-2 inline" />Force Sync</Button>
      } />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Status Tab */}
      {tab === 'status' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Connection</span>
              {status.online ? <Wifi className="w-5 h-5 text-green-500" /> : <WifiOff className="w-5 h-5 text-red-500" />}
            </div>
            <div className={`text-xl font-bold ${status.online ? 'text-green-600' : 'text-red-600'}`}>
              {status.online ? 'Online' : 'Offline'}
            </div>
            <div className={`w-3 h-3 rounded-full mt-2 ${status.online ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
          </div>

          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Last Sync</span>
              <Clock className="w-5 h-5 text-gray-400" />
            </div>
            <div className="text-lg font-bold">
              {status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}
            </div>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Pending Queue</span>
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
            </div>
            <div className="text-2xl font-bold">{status.pendingCount}</div>
            <div className="text-sm text-gray-400">transactions waiting</div>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Failed Syncs</span>
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
            <div className="text-2xl font-bold text-red-600">{status.failedCount}</div>
            <div className="text-sm text-gray-400">need attention</div>
          </div>
        </div>
      )}

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="max-w-lg">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white border rounded-lg p-6 space-y-5">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-medium">Enable Offline Mode</div>
                  <div className="text-sm text-gray-500">Allow the system to work without internet</div>
                </div>
                <div className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.offlineEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                  onClick={() => setConfig({ ...config, offlineEnabled: !config.offlineEnabled })}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.offlineEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>

              <div>
                <label className="block font-medium mb-1">Max Queue Size</label>
                <div className="text-sm text-gray-500 mb-2">Maximum offline transactions to store</div>
                <input type="number" value={config.maxQueueSize} onChange={e => setConfig({ ...config, maxQueueSize: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>

              <div>
                <label className="block font-medium mb-1">Sync Retry Interval (seconds)</label>
                <div className="text-sm text-gray-500 mb-2">How often to retry failed syncs</div>
                <input type="number" value={config.syncRetrySeconds} onChange={e => setConfig({ ...config, syncRetrySeconds: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>

              <div className="border-t pt-4">
                <div className="font-medium mb-3">Features Available Offline</div>
                <div className="space-y-3">
                  {[
                    { key: 'offlinePOS', label: 'POS / Sales', desc: 'Process transactions offline' },
                    { key: 'offlineCheckin', label: 'Customer Check-In', desc: 'Check in customers without internet' },
                    { key: 'offlineInventoryCount', label: 'Inventory Count', desc: 'Count inventory offline' },
                  ].map(feature => (
                    <label key={feature.key} className="flex items-center justify-between cursor-pointer">
                      <div>
                        <div className="text-sm font-medium">{feature.label}</div>
                        <div className="text-xs text-gray-500">{feature.desc}</div>
                      </div>
                      <input type="checkbox" checked={(config as any)[feature.key]}
                        onChange={e => setConfig({ ...config, [feature.key]: e.target.checked })}
                        className="rounded text-green-600 w-4 h-4" />
                    </label>
                  ))}
                </div>
              </div>

              <Button onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving...' : 'Save Config'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Queue Tab */}
      {tab === 'queue' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : queue.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
              Queue is empty. All transactions synced.
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Created</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Retries</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Error</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(item => (
                    <tr key={item.id} className="border-t">
                      <td className="px-4 py-3 text-sm font-medium">{item.type}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SYNC_STATUS_STYLES[item.status] || 'bg-gray-100 text-gray-700'}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{item.retries || 0}</td>
                      <td className="px-4 py-3 text-sm text-red-500 max-w-xs truncate">{item.error || '-'}</td>
                      <td className="px-4 py-3">
                        {item.status === 'failed' && (
                          <div className="flex gap-2">
                            <button onClick={() => retryItem(item.id)}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                              <RotateCcw className="w-3 h-3" />Retry
                            </button>
                            <button onClick={() => skipItem(item.id)}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                              <SkipForward className="w-3 h-3" />Skip
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Instructions Tab */}
      {tab === 'instructions' && (
        <div className="max-w-2xl">
          <div className="bg-white border rounded-lg p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">How Offline Mode Works</h3>
              <p className="text-sm text-gray-600">
                When your internet connection drops, the system automatically switches to offline mode.
                Transactions are stored locally and synced when connectivity is restored.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-2">What works offline:</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />POS transactions are queued and processed when back online</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />Customer check-ins are stored locally with timestamps</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />Inventory counts can be performed and synced later</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">What requires internet:</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2"><XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />METRC/BioTrack compliance reporting</li>
                <li className="flex items-start gap-2"><XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />Payment processing (card transactions)</li>
                <li className="flex items-start gap-2"><XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />ID verification / age check scans</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-800 flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4" />If Sync Fails
              </h4>
              <ol className="space-y-1 text-sm text-yellow-700 list-decimal list-inside">
                <li>Check your internet connection</li>
                <li>Go to the Queue tab to see failed transactions</li>
                <li>Use "Retry" for individual items or "Force Sync" for all</li>
                <li>If a transaction cannot sync, use "Skip" to move past it and resolve manually</li>
                <li>Contact support if failures persist</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
