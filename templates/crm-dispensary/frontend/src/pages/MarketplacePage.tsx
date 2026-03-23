import { useState, useEffect } from 'react';
import { Store, Search, Download, Settings, CheckCircle, AlertTriangle, XCircle, RefreshCw, Zap, Star } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const categoryColors: Record<string, string> = {
  pos: 'bg-blue-100 text-blue-700',
  payments: 'bg-green-100 text-green-700',
  compliance: 'bg-purple-100 text-purple-700',
  delivery: 'bg-orange-100 text-orange-700',
  marketing: 'bg-pink-100 text-pink-700',
  analytics: 'bg-indigo-100 text-indigo-700',
  inventory: 'bg-yellow-100 text-yellow-700',
  ecommerce: 'bg-teal-100 text-teal-700',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  configuring: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  disabled: 'bg-gray-100 text-gray-500',
};

export default function MarketplacePage() {
  const toast = useToast();
  const [tab, setTab] = useState('browse');
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [installed, setInstalled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);

  // Config modal
  const [configModal, setConfigModal] = useState(false);
  const [configIntegration, setConfigIntegration] = useState<any>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (tab === 'browse') loadIntegrations();
    if (tab === 'installed') loadInstalled();
  }, [tab]);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/marketplace/integrations');
      setIntegrations(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const loadInstalled = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/marketplace/installed');
      setInstalled(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load installed integrations');
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (integrationId: string) => {
    setInstalling(integrationId);
    try {
      await api.post(`/api/marketplace/integrations/${integrationId}/install`);
      toast.success('Integration installed');
      loadIntegrations();
    } catch (err: any) {
      toast.error(err.message || 'Failed to install');
    } finally {
      setInstalling(null);
    }
  };

  const openConfig = (integration: any) => {
    setConfigIntegration(integration);
    setConfigValues(integration.config || {});
    setConfigModal(true);
  };

  const handleSaveConfig = async () => {
    if (!configIntegration) return;
    setSavingConfig(true);
    try {
      await api.put(`/api/marketplace/installed/${configIntegration.id}/config`, { config: configValues });
      toast.success('Configuration saved');
      setConfigModal(false);
      loadInstalled();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    try {
      await api.post(`/api/marketplace/installed/${id}/test`);
      toast.success('Connection test passed');
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed');
    }
  };

  const handleSync = async (id: string) => {
    try {
      await api.post(`/api/marketplace/installed/${id}/sync`);
      toast.success('Sync initiated');
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    }
  };

  const handleDisable = async (id: string) => {
    try {
      await api.put(`/api/marketplace/installed/${id}/disable`);
      toast.success('Integration disabled');
      loadInstalled();
    } catch (err: any) {
      toast.error(err.message || 'Failed to disable');
    }
  };

  const filteredIntegrations = integrations.filter(i => {
    const matchSearch = !searchQuery || i.name?.toLowerCase().includes(searchQuery.toLowerCase()) || i.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = !categoryFilter || i.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const featured = integrations.filter(i => i.featured);
  const categories = [...new Set(integrations.map(i => i.category).filter(Boolean))];

  const tabs = [
    { id: 'browse', label: 'Browse', icon: Store },
    { id: 'installed', label: 'Installed', icon: Download },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations Marketplace</h1>
          <p className="text-gray-600">Connect with third-party services and partners</p>
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
            {tab === 'installed' && t.id === 'installed' && installed.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">{installed.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Browse Tab */}
      {tab === 'browse' && (
        <div>
          {/* Featured Section */}
          {featured.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500" />
                Featured Partners
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {featured.map(integration => (
                  <div key={integration.id} className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg shadow-sm p-5 border border-green-200">
                    <div className="flex items-start gap-3 mb-3">
                      {integration.logoUrl ? (
                        <img src={integration.logoUrl} alt={integration.name} className="w-10 h-10 rounded-lg object-contain" />
                      ) : (
                        <div className="w-10 h-10 bg-green-200 rounded-lg flex items-center justify-center">
                          <Zap className="w-5 h-5 text-green-700" />
                        </div>
                      )}
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${categoryColors[integration.category] || 'bg-gray-100 text-gray-600'}`}>
                          {integration.category || 'other'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">{integration.description || 'No description available'}</p>
                    <Button
                      onClick={() => handleInstall(integration.id)}
                      disabled={installing === integration.id || integration.installed}
                    >
                      {integration.installed ? 'Installed' : installing === integration.id ? 'Installing...' : 'Install'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search & Filter */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredIntegrations.map(integration => (
                <div key={integration.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    {integration.logoUrl ? (
                      <img src={integration.logoUrl} alt={integration.name} className="w-10 h-10 rounded-lg object-contain" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <Zap className="w-5 h-5 text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${categoryColors[integration.category] || 'bg-gray-100 text-gray-600'}`}>
                        {integration.category || 'other'}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{integration.description || 'No description available'}</p>
                  <button
                    onClick={() => handleInstall(integration.id)}
                    disabled={installing === integration.id || integration.installed}
                    className={`w-full px-4 py-2 text-sm font-medium rounded-lg ${
                      integration.installed
                        ? 'bg-gray-100 text-gray-500 cursor-default'
                        : 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                    }`}
                  >
                    {integration.installed ? 'Installed' : installing === integration.id ? 'Installing...' : 'Install'}
                  </button>
                </div>
              ))}
              {filteredIntegrations.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <Store className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No integrations found</p>
                  {searchQuery && <p className="text-sm mt-1">Try adjusting your search</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Installed Tab */}
      {tab === 'installed' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {installed.map(integration => (
                <div key={integration.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {integration.logoUrl ? (
                      <img src={integration.logoUrl} alt={integration.name} className="w-10 h-10 rounded-lg object-contain" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <Zap className="w-5 h-5 text-gray-400" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[integration.status] || 'bg-gray-100 text-gray-500'}`}>
                          {integration.status || 'active'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">{integration.category || '—'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestConnection(integration.id)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleSync(integration.id)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"
                    >
                      <RefreshCw className="w-3 h-3 inline mr-1" />
                      Sync
                    </button>
                    <button
                      onClick={() => openConfig(integration)}
                      className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100"
                    >
                      <Settings className="w-3 h-3 inline mr-1" />
                      Config
                    </button>
                    <button
                      onClick={() => handleDisable(integration.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              ))}
              {installed.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Download className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No integrations installed</p>
                  <p className="text-sm mt-1">Browse the marketplace to find integrations for your dispensary</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Config Modal */}
      <Modal
        isOpen={configModal}
        onClose={() => setConfigModal(false)}
        title={`Configure ${configIntegration?.name || 'Integration'}`}
      >
        <div className="space-y-4">
          {configIntegration?.configFields && Array.isArray(configIntegration.configFields) ? (
            configIntegration.configFields.map((field: any) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label || field.key}</label>
                <input
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={configValues[field.key] || ''}
                  onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder={field.placeholder || ''}
                />
                {field.help && <p className="text-xs text-gray-400 mt-1">{field.help}</p>}
              </div>
            ))
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                <input
                  type="password"
                  value={configValues.apiKey || ''}
                  onChange={(e) => setConfigValues({ ...configValues, apiKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Enter API key..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                <input
                  type="text"
                  value={configValues.webhookUrl || ''}
                  onChange={(e) => setConfigValues({ ...configValues, webhookUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="https://..."
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConfigModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveConfig} disabled={savingConfig}>
            {savingConfig ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
