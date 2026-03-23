import { useState, useEffect } from 'react';
import {
  Globe, Link, Unlink, RefreshCw, Settings, Eye, Clock, Check,
  X, AlertTriangle, ExternalLink, Zap, List
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const PLATFORMS = [
  { id: 'weedmaps', name: 'Weedmaps', color: 'bg-green-500', description: 'Largest cannabis marketplace' },
  { id: 'leafly', name: 'Leafly', color: 'bg-emerald-500', description: 'Strain reviews & ordering' },
  { id: 'jane', name: 'Jane', color: 'bg-purple-500', description: 'Online ordering platform' },
  { id: 'dutchie', name: 'Dutchie Marketplace', color: 'bg-blue-500', description: 'E-commerce marketplace' },
];

const SYNC_STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  in_progress: 'bg-blue-100 text-blue-700',
  partial: 'bg-yellow-100 text-yellow-700',
};

export default function MenuSyncPage() {
  const toast = useToast();
  const [tab, setTab] = useState('platforms');
  const [loading, setLoading] = useState(true);

  // Platforms
  const [connections, setConnections] = useState<Record<string, any>>({});
  const [configModal, setConfigModal] = useState(false);
  const [configPlatform, setConfigPlatform] = useState<any>(null);
  const [configForm, setConfigForm] = useState({
    apiKey: '', storeId: '', syncProducts: true, syncPricing: true,
    syncInventory: true, syncImages: true, autoSync: false,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Sync
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  // Preview
  const [previewPlatform, setPreviewPlatform] = useState('');
  const [previewProducts, setPreviewProducts] = useState<any[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (tab === 'platforms') loadConnections();
    if (tab === 'sync') loadSyncLogs();
  }, [tab]);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/menu-sync/connections');
      const conns: Record<string, any> = {};
      const items = Array.isArray(data) ? data : data?.data || [];
      items.forEach((c: any) => { conns[c.platformId] = c; });
      setConnections(conns);
    } catch (err) {
      toast.error('Failed to load connections');
    } finally {
      setLoading(false);
    }
  };

  const loadSyncLogs = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/menu-sync/logs', { limit: 50 });
      setSyncLogs(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load sync logs');
    } finally {
      setLoading(false);
    }
  };

  const openConfig = (platform: any) => {
    setConfigPlatform(platform);
    const existing = connections[platform.id];
    if (existing) {
      setConfigForm({
        apiKey: existing.apiKey || '',
        storeId: existing.storeId || '',
        syncProducts: existing.syncProducts ?? true,
        syncPricing: existing.syncPricing ?? true,
        syncInventory: existing.syncInventory ?? true,
        syncImages: existing.syncImages ?? true,
        autoSync: existing.autoSync ?? false,
      });
    } else {
      setConfigForm({ apiKey: '', storeId: '', syncProducts: true, syncPricing: true, syncInventory: true, syncImages: true, autoSync: false });
    }
    setConfigModal(true);
  };

  const saveConnection = async () => {
    if (!configPlatform) return;
    if (!configForm.apiKey) { toast.error('API key required'); return; }
    setSavingConfig(true);
    try {
      await api.post(`/api/menu-sync/connections/${configPlatform.id}`, configForm);
      toast.success(`${configPlatform.name} connected`);
      setConfigModal(false);
      loadConnections();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save connection');
    } finally {
      setSavingConfig(false);
    }
  };

  const disconnectPlatform = async (platformId: string) => {
    try {
      await api.delete(`/api/menu-sync/connections/${platformId}`);
      toast.success('Disconnected');
      loadConnections();
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    }
  };

  const syncPlatform = async (platformId: string) => {
    setSyncing({ ...syncing, [platformId]: true });
    try {
      await api.post(`/api/menu-sync/${platformId}/sync`);
      toast.success('Sync started');
      loadSyncLogs();
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncing({ ...syncing, [platformId]: false });
    }
  };

  const loadPreview = async (platformId: string) => {
    setPreviewPlatform(platformId);
    setLoadingPreview(true);
    try {
      const data = await api.get(`/api/menu-sync/${platformId}/preview`);
      setPreviewProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const connectedCount = Object.keys(connections).length;

  const tabs = [
    { id: 'platforms', label: 'Platforms', icon: Globe },
    { id: 'sync', label: 'Sync Log', icon: RefreshCw },
    { id: 'preview', label: 'Preview', icon: Eye },
  ];

  return (
    <div>
      <PageHeader title="Marketplace Menu Sync" />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Platforms Tab */}
      {tab === 'platforms' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLATFORMS.map(platform => {
                const conn = connections[platform.id];
                const isConnected = !!conn;
                return (
                  <div key={platform.id} className="border rounded-lg p-5 bg-white">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 ${platform.color} rounded-lg flex items-center justify-center`}>
                          <Globe className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{platform.name}</h3>
                          <p className="text-sm text-gray-500">{platform.description}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${isConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {isConnected ? <><Link className="w-3 h-3" />Connected</> : <><Unlink className="w-3 h-3" />Disconnected</>}
                      </span>
                    </div>

                    {isConnected && (
                      <div className="text-sm text-gray-500 mb-3">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last sync: {conn.lastSync ? new Date(conn.lastSync).toLocaleString() : 'Never'}
                        </div>
                        {conn.autoSync && (
                          <div className="flex items-center gap-1 text-green-600 mt-1">
                            <Zap className="w-3 h-3" />Auto-sync enabled
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {isConnected ? (
                        <>
                          <Button onClick={() => syncPlatform(platform.id)} disabled={syncing[platform.id]}>
                            <RefreshCw className={`w-4 h-4 mr-1 inline ${syncing[platform.id] ? 'animate-spin' : ''}`} />
                            {syncing[platform.id] ? 'Syncing...' : 'Sync Now'}
                          </Button>
                          <button onClick={() => openConfig(platform)}
                            className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
                            <Settings className="w-4 h-4" />
                          </button>
                          <button onClick={() => disconnectPlatform(platform.id)}
                            className="px-3 py-2 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-50">
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <Button onClick={() => openConfig(platform)}>
                          <Link className="w-4 h-4 mr-1 inline" />Connect
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sync Log Tab */}
      {tab === 'sync' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Sync History</h3>
            <div className="flex gap-2">
              {PLATFORMS.filter(p => connections[p.id]).map(p => (
                <Button key={p.id} onClick={() => syncPlatform(p.id)} disabled={syncing[p.id]}>
                  <RefreshCw className={`w-4 h-4 mr-1 inline ${syncing[p.id] ? 'animate-spin' : ''}`} />
                  Sync {p.name}
                </Button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : syncLogs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No sync history yet. Connect a platform and sync.</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Platform</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Products Synced</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Errors</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Duration</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map(log => (
                    <tr key={log.id} className="border-t">
                      <td className="px-4 py-3 text-sm font-medium">{log.platformName || log.platformId}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SYNC_STATUS_STYLES[log.status] || 'bg-gray-100 text-gray-700'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{log.productsSynced || 0}</td>
                      <td className="px-4 py-3 text-sm">
                        {log.errors > 0 ? (
                          <span className="text-red-600 font-medium">{log.errors}</span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.duration || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Preview Tab */}
      {tab === 'preview' && (
        <div>
          <div className="flex items-center gap-4 mb-6">
            <label className="text-sm font-medium">Preview Platform:</label>
            <select value={previewPlatform} onChange={e => { setPreviewPlatform(e.target.value); if (e.target.value) loadPreview(e.target.value); }}
              className="px-3 py-2 border rounded-lg">
              <option value="">Select platform...</option>
              {PLATFORMS.filter(p => connections[p.id]).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {!previewPlatform ? (
            <div className="text-center py-12 text-gray-500">
              <Eye className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              Select a connected platform to preview your menu
            </div>
          ) : loadingPreview ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : previewProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No products to preview. Run a sync first.</div>
          ) : (
            <div>
              <div className="text-sm text-gray-500 mb-4">Showing how your menu appears on {PLATFORMS.find(p => p.id === previewPlatform)?.name}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {previewProducts.map(product => (
                  <div key={product.id} className="border rounded-lg overflow-hidden bg-white">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-full h-40 object-cover" />
                    ) : (
                      <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
                        <Package className="w-8 h-8 text-gray-300" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-semibold">{product.name}</h3>
                        <span className="text-green-600 font-bold">${(product.price || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2 mb-2">
                        {product.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{product.category}</span>
                        )}
                        {product.strain && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{product.strain}</span>
                        )}
                      </div>
                      {product.thc && <div className="text-xs text-gray-500">THC: {product.thc}%{product.cbd ? ` | CBD: ${product.cbd}%` : ''}</div>}
                      <div className="text-sm text-gray-500 mt-2 line-clamp-2">{product.description}</div>
                      {product.inStock === false && (
                        <div className="text-xs text-red-600 font-medium mt-2 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />Out of Stock
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Config Modal */}
      <Modal isOpen={configModal} onClose={() => setConfigModal(false)}
        title={`${connections[configPlatform?.id] ? 'Edit' : 'Connect'} ${configPlatform?.name || ''}`} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">API Key *</label>
            <input type="password" value={configForm.apiKey} onChange={e => setConfigForm({ ...configForm, apiKey: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="Enter API key" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Store ID</label>
            <input value={configForm.storeId} onChange={e => setConfigForm({ ...configForm, storeId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="Your store ID on the platform" />
          </div>

          <div className="border-t pt-4">
            <div className="font-medium mb-3">Sync Options</div>
            <div className="space-y-3">
              {[
                { key: 'syncProducts', label: 'Products', desc: 'Sync product names, descriptions, categories' },
                { key: 'syncPricing', label: 'Pricing', desc: 'Sync prices and sale prices' },
                { key: 'syncInventory', label: 'Inventory', desc: 'Sync stock levels in real-time' },
                { key: 'syncImages', label: 'Images', desc: 'Sync product photos' },
                { key: 'autoSync', label: 'Auto-Sync', desc: 'Automatically sync changes every 15 minutes' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-gray-500">{opt.desc}</div>
                  </div>
                  <input type="checkbox" checked={(configForm as any)[opt.key]}
                    onChange={e => setConfigForm({ ...configForm, [opt.key]: e.target.checked })}
                    className="rounded text-green-600 w-4 h-4" />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConfigModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={saveConnection} disabled={savingConfig}>
            {savingConfig ? 'Saving...' : connections[configPlatform?.id] ? 'Update' : 'Connect'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
