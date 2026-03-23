import { useState, useEffect } from 'react';
import { Monitor, Plus, Edit, Eye, RefreshCw, Wifi, WifiOff, Image, List, Clock } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const screenTypeColors: Record<string, string> = {
  menu_board: 'bg-blue-100 text-blue-700',
  promo: 'bg-purple-100 text-purple-700',
  wait_time: 'bg-orange-100 text-orange-700',
  custom: 'bg-gray-100 text-gray-700',
};

const screenTypeLabels: Record<string, string> = {
  menu_board: 'Menu Board',
  promo: 'Promo',
  wait_time: 'Wait Time',
  custom: 'Custom',
};

export default function SignagePage() {
  const toast = useToast();
  const [tab, setTab] = useState('screens');
  const [screens, setScreens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Screen modal
  const [screenModal, setScreenModal] = useState(false);
  const [editingScreen, setEditingScreen] = useState<any>(null);
  const [screenForm, setScreenForm] = useState({ name: '', type: 'menu_board', location: '' });
  const [saving, setSaving] = useState(false);

  // Content
  const [selectedScreen, setSelectedScreen] = useState<any>(null);
  const [contentItems, setContentItems] = useState<any[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  // Preview
  const [previewScreen, setPreviewScreen] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    loadScreens();
  }, []);

  const loadScreens = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/signage/screens');
      setScreens(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load screens');
    } finally {
      setLoading(false);
    }
  };

  const loadContent = async (screenId: string) => {
    setLoadingContent(true);
    try {
      const data = await api.get(`/api/signage/screens/${screenId}/content`);
      setContentItems(Array.isArray(data) ? data : data?.data || data?.items || []);
    } catch (err) {
      toast.error('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const loadPreview = async (screenId: string) => {
    setLoadingPreview(true);
    try {
      const data = await api.get(`/api/signage/screens/${screenId}/preview`);
      setPreviewData(data);
    } catch (err) {
      toast.error('Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const openCreateScreen = () => {
    setEditingScreen(null);
    setScreenForm({ name: '', type: 'menu_board', location: '' });
    setScreenModal(true);
  };

  const openEditScreen = (screen: any) => {
    setEditingScreen(screen);
    setScreenForm({
      name: screen.name || '',
      type: screen.type || 'menu_board',
      location: screen.location || '',
    });
    setScreenModal(true);
  };

  const handleSaveScreen = async () => {
    if (!screenForm.name.trim()) {
      toast.error('Screen name is required');
      return;
    }
    setSaving(true);
    try {
      if (editingScreen) {
        await api.put(`/api/signage/screens/${editingScreen.id}`, screenForm);
        toast.success('Screen updated');
      } else {
        await api.post('/api/signage/screens', screenForm);
        toast.success('Screen created');
      }
      setScreenModal(false);
      loadScreens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save screen');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'screens', label: 'Screens', icon: Monitor },
    { id: 'content', label: 'Content', icon: List },
    { id: 'preview', label: 'Preview', icon: Eye },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Digital Signage</h1>
          <p className="text-gray-600">Manage menu boards, promos, and in-store displays</p>
        </div>
        <button onClick={loadScreens} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
          <RefreshCw className="w-5 h-5" />
        </button>
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

      {/* Screens Tab */}
      {tab === 'screens' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateScreen}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Screen
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {screens.map(screen => (
                <div key={screen.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Monitor className="w-5 h-5 text-green-600" />
                      <h3 className="font-semibold text-gray-900">{screen.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {screen.online !== false ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <span className="w-2 h-2 bg-green-500 rounded-full" />
                          Online
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-500">
                          <span className="w-2 h-2 bg-red-500 rounded-full" />
                          Offline
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${screenTypeColors[screen.type] || 'bg-gray-100 text-gray-600'}`}>
                        {screenTypeLabels[screen.type] || screen.type || 'Custom'}
                      </span>
                    </div>
                    {screen.location && (
                      <p className="text-gray-600">Location: {screen.location}</p>
                    )}
                    {screen.lastHeartbeat && (
                      <p className="text-gray-400 text-xs flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Last heartbeat: {new Date(screen.lastHeartbeat).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 mt-4 pt-3 border-t">
                    <button onClick={() => openEditScreen(screen)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => { setSelectedScreen(screen); loadContent(screen.id); setTab('content'); }}
                      className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1"
                    >
                      <List className="w-3 h-3" /> Content
                    </button>
                    <button
                      onClick={() => { setPreviewScreen(screen); loadPreview(screen.id); setTab('preview'); }}
                      className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                  </div>
                </div>
              ))}
              {screens.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No screens configured</p>
                  <p className="text-sm mt-1">Add a screen to get started with digital signage</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content Tab */}
      {tab === 'content' && (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Screen</label>
            <select
              value={selectedScreen?.id || ''}
              onChange={(e) => {
                const s = screens.find(sc => sc.id === e.target.value);
                setSelectedScreen(s || null);
                if (s) loadContent(s.id);
              }}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Choose a screen...</option>
              {screens.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({screenTypeLabels[s.type] || s.type})</option>
              ))}
            </select>
          </div>

          {selectedScreen ? (
            <div>
              {loadingContent ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedScreen.type === 'menu_board' && (
                    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                      <h3 className="font-semibold text-gray-900 mb-3">Menu Board Content</h3>
                      <p className="text-sm text-gray-600 mb-4">Auto-populated from your product catalog. Items update automatically when products change.</p>
                      <div className="space-y-2">
                        {contentItems.map((item, i) => (
                          <div key={item.id || i} className="flex items-center justify-between py-2 border-b border-gray-50">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{item.name || item.productName}</p>
                              <p className="text-xs text-gray-500">{item.category || '—'}</p>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{item.price ? `$${Number(item.price).toFixed(2)}` : '—'}</span>
                          </div>
                        ))}
                        {contentItems.length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">No products to display</p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedScreen.type === 'promo' && (
                    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                      <h3 className="font-semibold text-gray-900 mb-3">Promotional Content</h3>
                      <p className="text-sm text-gray-600 mb-4">Select active promotions to display on this screen.</p>
                      <div className="space-y-2">
                        {contentItems.map((item, i) => (
                          <div key={item.id || i} className="flex items-center justify-between py-2 border-b border-gray-50">
                            <div className="flex items-center gap-3">
                              <Image className="w-8 h-8 text-gray-300" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">{item.title || item.name}</p>
                                <p className="text-xs text-gray-500">{item.description || '—'}</p>
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${item.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {item.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        ))}
                        {contentItems.length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">No promotions configured</p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedScreen.type === 'wait_time' && (
                    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                      <h3 className="font-semibold text-gray-900 mb-3">Wait Time Display</h3>
                      <p className="text-sm text-gray-600 mb-4">Automatically updates from the queue system.</p>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="bg-green-50 rounded-lg p-4 text-center">
                          <p className="text-3xl font-bold text-green-700">{contentItems[0]?.currentWait || '—'}</p>
                          <p className="text-sm text-green-600 mt-1">Current Wait</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-4 text-center">
                          <p className="text-3xl font-bold text-blue-700">{contentItems[0]?.queueSize || '—'}</p>
                          <p className="text-sm text-blue-600 mt-1">In Queue</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedScreen.type === 'custom' && (
                    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                      <h3 className="font-semibold text-gray-900 mb-3">Custom Content</h3>
                      <div className="space-y-2">
                        {contentItems.map((item, i) => (
                          <div key={item.id || i} className="py-2 border-b border-gray-50">
                            <p className="text-sm font-medium text-gray-900">{item.title || item.name || `Item ${i + 1}`}</p>
                            <p className="text-xs text-gray-500">{item.content || item.description || '—'}</p>
                          </div>
                        ))}
                        {contentItems.length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">No content configured</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Select a screen to manage its content</p>
            </div>
          )}
        </div>
      )}

      {/* Preview Tab */}
      {tab === 'preview' && (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Screen</label>
            <select
              value={previewScreen?.id || ''}
              onChange={(e) => {
                const s = screens.find(sc => sc.id === e.target.value);
                setPreviewScreen(s || null);
                if (s) loadPreview(s.id);
              }}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Choose a screen...</option>
              {screens.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {previewScreen ? (
            <div className="bg-gray-900 rounded-lg p-8 max-w-3xl mx-auto">
              <div className="bg-black rounded-lg p-6 min-h-[400px] flex flex-col items-center justify-center text-white">
                {loadingPreview ? (
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Monitor className="w-16 h-16 text-gray-600 mb-4" />
                    <h3 className="text-xl font-bold mb-2">{previewScreen.name}</h3>
                    <p className="text-sm text-gray-400 mb-4">{screenTypeLabels[previewScreen.type] || previewScreen.type}</p>
                    {previewData?.html ? (
                      <div className="w-full text-left" dangerouslySetInnerHTML={{ __html: previewData.html }} />
                    ) : previewData?.items ? (
                      <div className="w-full space-y-2">
                        {previewData.items.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-gray-700">
                            <span>{item.name}</span>
                            <span className="text-green-400">{item.price ? `$${Number(item.price).toFixed(2)}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500">Preview will appear here when content is configured</p>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Eye className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Select a screen to preview its display</p>
            </div>
          )}
        </div>
      )}

      {/* Screen Modal */}
      <Modal
        isOpen={screenModal}
        onClose={() => setScreenModal(false)}
        title={editingScreen ? 'Edit Screen' : 'Add Screen'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Screen Name *</label>
            <input
              type="text"
              value={screenForm.name}
              onChange={(e) => setScreenForm({ ...screenForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Main Menu Board"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={screenForm.type}
              onChange={(e) => setScreenForm({ ...screenForm, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="menu_board">Menu Board</option>
              <option value="promo">Promotional</option>
              <option value="wait_time">Wait Time</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={screenForm.location}
              onChange={(e) => setScreenForm({ ...screenForm, location: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Front counter, Waiting room, etc."
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setScreenModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveScreen} disabled={saving}>
            {saving ? 'Saving...' : editingScreen ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
