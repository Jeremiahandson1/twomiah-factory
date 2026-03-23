import { useState, useEffect, useRef } from 'react';
import { Bot, Settings, MessageSquare, Play, BarChart3, Send, ShoppingCart, Star, TrendingUp, Users, Zap } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const personalities = [
  { value: 'friendly', label: 'Friendly', desc: 'Warm and approachable' },
  { value: 'professional', label: 'Professional', desc: 'Formal and knowledgeable' },
  { value: 'casual', label: 'Casual', desc: 'Relaxed and chill' },
  { value: 'expert', label: 'Expert', desc: 'Detailed and scientific' },
];

const channels = ['pos_kiosk', 'website_chat', 'sms', 'whatsapp'];

export default function AIBudtenderPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('config');

  // Config
  const [config, setConfig] = useState({
    enabled: false,
    personality: 'friendly',
    greeting: 'Hey there! Welcome to the shop. What kind of experience are you looking for today?',
    systemPrompt: '',
    maxRecommendations: 3,
    channels: ['pos_kiosk', 'website_chat'] as string[],
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsTotal, setSessionsTotal] = useState(0);

  // Live Demo
  const [demoMessages, setDemoMessages] = useState<any[]>([]);
  const [demoInput, setDemoInput] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Analytics
  const [analytics, setAnalytics] = useState<any>({
    totalSessions: 0,
    conversionRate: 0,
    avgSatisfaction: 0,
    topProducts: [],
  });
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
    if (tab === 'analytics') loadAnalytics();
  }, [tab, sessionsPage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [demoMessages]);

  const loadConfig = async () => {
    try {
      const data = await api.get('/api/ai-budtender/config');
      if (data) {
        setConfig({
          enabled: data.enabled ?? false,
          personality: data.personality || 'friendly',
          greeting: data.greeting || '',
          systemPrompt: data.systemPrompt || '',
          maxRecommendations: data.maxRecommendations || 3,
          channels: data.channels || ['pos_kiosk', 'website_chat'],
        });
      }
    } catch (err) {
      console.error('Failed to load AI config:', err);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/ai-budtender/config', config);
      toast.success('AI Budtender configuration saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const data = await api.get('/api/ai-budtender/sessions', { page: sessionsPage, limit: 25 });
      setSessions(Array.isArray(data) ? data : data?.data || []);
      setSessionsTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const data = await api.get('/api/ai-budtender/analytics');
      if (data) setAnalytics(data);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const sendDemoMessage = async () => {
    if (!demoInput.trim()) return;
    const userMsg = { role: 'user', content: demoInput, ts: Date.now() };
    setDemoMessages(prev => [...prev, userMsg]);
    setDemoInput('');
    setDemoLoading(true);
    try {
      const result = await api.post('/api/ai-budtender/demo', {
        message: userMsg.content,
        history: demoMessages.map(m => ({ role: m.role, content: m.content })),
      });
      const aiMsg = {
        role: 'assistant',
        content: result?.message || result?.response || 'I can help you find the perfect product!',
        recommendations: result?.recommendations || [],
        ts: Date.now(),
      };
      setDemoMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      toast.error(err.message || 'Demo request failed');
    } finally {
      setDemoLoading(false);
    }
  };

  const toggleChannel = (channel: string) => {
    setConfig(prev => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter(c => c !== channel)
        : [...prev.channels, channel],
    }));
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'sessions', label: 'Sessions', icon: MessageSquare },
    { id: 'demo', label: 'Live Demo', icon: Play },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Budtender</h1>
          <p className="text-gray-600">AI-powered product recommendations and customer assistance</p>
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

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">AI Budtender Settings</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <span className={`text-sm font-medium ${config.enabled ? 'text-green-600' : 'text-gray-500'}`}>
                {config.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Personality</label>
            <div className="grid grid-cols-2 gap-3">
              {personalities.map(p => (
                <button
                  key={p.value}
                  onClick={() => setConfig({ ...config, personality: p.value })}
                  className={`text-left p-3 rounded-lg border-2 transition-colors ${
                    config.personality === p.value
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">{p.label}</p>
                  <p className="text-sm text-gray-500">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Greeting Message</label>
            <textarea
              value={config.greeting}
              onChange={(e) => setConfig({ ...config, greeting: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              rows={3}
              placeholder="Enter the AI's greeting message..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 font-mono text-sm"
              rows={5}
              placeholder="Custom system prompt to guide the AI's behavior and knowledge..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Recommendations per Response</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxRecommendations}
              onChange={(e) => setConfig({ ...config, maxRecommendations: parseInt(e.target.value) || 3 })}
              className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channels</label>
            <div className="flex flex-wrap gap-3">
              {channels.map(ch => (
                <label key={ch} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.channels.includes(ch)}
                    onChange={() => toggleChannel(ch)}
                    className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-700">{ch.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={saveConfig} disabled={savingConfig}>
            {savingConfig ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      )}

      {/* Sessions Tab */}
      {tab === 'sessions' && (
        <div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Messages</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Converted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Satisfaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingSessions ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : sessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No AI sessions found</td>
                    </tr>
                  ) : sessions.map(session => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {session.createdAt ? new Date(session.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{session.customerName || 'Anonymous'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                          {(session.channel || 'unknown').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          session.status === 'active' ? 'bg-green-100 text-green-700' :
                          session.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {session.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{session.messageCount || 0}</td>
                      <td className="px-4 py-3 text-sm">
                        {session.convertedToOrder ? (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {session.satisfaction ? (
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                            <span className="text-gray-900">{session.satisfaction}/5</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sessionsTotal > 25 && (
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {sessionsPage} of {Math.ceil(sessionsTotal / 25)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSessionsPage(p => Math.max(1, p - 1))}
                    disabled={sessionsPage <= 1}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setSessionsPage(p => p + 1)}
                    disabled={sessionsPage >= Math.ceil(sessionsTotal / 25)}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Demo Tab */}
      {tab === 'demo' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Chat Header */}
            <div className="bg-green-600 px-4 py-3 flex items-center gap-3">
              <Bot className="w-6 h-6 text-white" />
              <div>
                <p className="font-semibold text-white">AI Budtender</p>
                <p className="text-xs text-green-200">
                  {config.personality.charAt(0).toUpperCase() + config.personality.slice(1)} mode
                </p>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {/* Greeting */}
              {demoMessages.length === 0 && config.greeting && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm max-w-[80%]">
                    <p className="text-sm text-gray-900">{config.greeting}</p>
                  </div>
                </div>
              )}

              {demoMessages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-green-600 text-white rounded-lg p-3 max-w-[80%]">
                        <p className="text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="space-y-2 max-w-[80%]">
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                          <p className="text-sm text-gray-900">{msg.content}</p>
                        </div>
                        {/* Product Recommendations */}
                        {msg.recommendations?.length > 0 && (
                          <div className="space-y-2">
                            {msg.recommendations.map((rec: any, j: number) => (
                              <div key={j} className="bg-white rounded-lg p-3 shadow-sm border border-green-100">
                                <div className="flex items-start justify-between">
                                  <div>
                                    <p className="font-medium text-gray-900 text-sm">{rec.name || rec.productName}</p>
                                    <p className="text-xs text-gray-500">{rec.category || ''} {rec.thc ? `| THC: ${rec.thc}` : ''}</p>
                                    {rec.price && <p className="text-sm font-semibold text-green-600 mt-1">${Number(rec.price).toFixed(2)}</p>}
                                  </div>
                                  <button
                                    onClick={() => toast.success(`${rec.name || rec.productName} added to cart`)}
                                    className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                                  >
                                    <ShoppingCart className="w-3 h-3" />
                                    Add to Cart
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {demoLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="border-t p-3 flex gap-2">
              <input
                type="text"
                value={demoInput}
                onChange={(e) => setDemoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !demoLoading && sendDemoMessage()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
                placeholder="Ask the AI budtender..."
                disabled={demoLoading}
              />
              <button
                onClick={sendDemoMessage}
                disabled={demoLoading || !demoInput.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={() => setDemoMessages([])}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear conversation
            </button>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {loadingAnalytics ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.totalSessions || 0}</p>
                      <p className="text-sm text-gray-500">Total Sessions</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.conversionRate || 0}%</p>
                      <p className="text-sm text-gray-500">Conversion Rate</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                      <Star className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{Number(analytics.avgSatisfaction || 0).toFixed(1)}/5</p>
                      <p className="text-sm text-gray-500">Avg Satisfaction</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Recommended Products */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b">
                  <h3 className="font-semibold text-gray-900">Top Recommended Products</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Times Recommended</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Conversion Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(analytics.topProducts || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No recommendation data yet</td>
                        </tr>
                      ) : analytics.topProducts.map((product: any, index: number) => (
                        <tr key={product.id || index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-bold text-gray-400">#{index + 1}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{product.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.category || '—'}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{product.recommendCount || 0}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{product.conversionRate || 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
