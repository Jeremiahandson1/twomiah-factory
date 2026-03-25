import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import {
  BarChart3, Eye, MousePointer, DollarSign, Users, Target,
  TrendingUp, Pause, Play, ExternalLink, X, Send, Check,
  AlertCircle, Filter, Clock, Settings, Link, Unlink,
  Plus, Image, Layout, MapPin, Calendar, Sparkles, ArrowLeft, ArrowRight, Loader2
} from 'lucide-react';

// ─── Feature gate ────────────────────────────────────────────────────────────
export default function AdsPage() {
  const { hasFeature } = useAuth();

  if (!hasFeature('paid_ads')) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-4">
        <p className="text-gray-500 dark:text-slate-400">This feature is not included in your plan.</p>
        <a href="https://twomiah.com/ads" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1">
          Learn more <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    );
  }

  return <AdsContent />;
}

// ─── Main content ────────────────────────────────────────────────────────────
function AdsContent() {
  const [tab, setTab] = useState<'performance' | 'campaigns' | 'approvals' | 'settings'>('performance');
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ads Management</h1>
        <p className="text-gray-500 dark:text-slate-400">
          Monitor and manage your Google & Meta ad campaigns
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800">
        {([
          { id: 'performance' as const, label: 'Performance', icon: BarChart3 },
          { id: 'campaigns' as const, label: 'My Ads', icon: Target },
          { id: 'approvals' as const, label: 'Ad Approval', icon: Check, badge: pendingCount },
          { id: 'settings' as const, label: 'Settings', icon: Settings },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.badge ? (
              <span className="ml-1 px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'performance' && <PerformanceTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'approvals' && <ApprovalsTab onCountChange={setPendingCount} />}
      {tab === 'settings' && <AdsSettingsTab />}
    </div>
  );
}

// ─── Ads Settings (Mode + Connection) ────────────────────────────────────────
function AdsSettingsTab() {
  const [mode, setMode] = useState<'managed' | 'connected'>('managed');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<any>({});
  const [connectingPlatform, setConnectingPlatform] = useState('');

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const [modeRes, statusRes] = await Promise.all([
        api.get('/api/ads/auth/mode'),
        api.get('/api/ads/auth/status'),
      ]);
      setMode(modeRes?.mode || 'managed');
      setStatus(statusRes?.status || {});
    } catch {} finally { setLoading(false); }
  };

  const switchMode = async (newMode: 'managed' | 'connected') => {
    setSaving(true);
    try {
      await api.put('/api/ads/auth/mode', { mode: newMode });
      setMode(newMode);
    } catch {} finally { setSaving(false); }
  };

  const connectPlatform = (platform: string) => {
    setConnectingPlatform(platform);
    // Open the backend URL directly — it redirects to the OAuth provider.
    // No async/await needed, so Safari/iOS won't block the popup.
    window.open(`/api/ads/auth/connect-url/${platform}`, '_blank');
    // Poll for connection status after a delay to detect when OAuth completes
    const poll = setInterval(async () => {
      try {
        const res = await api.get('/api/ads/auth/status');
        if (res?.status?.[platform]) {
          setStatus(res.status);
          setConnectingPlatform('');
          clearInterval(poll);
        }
      } catch {}
    }, 3000);
    // Stop polling after 2 minutes
    setTimeout(() => { clearInterval(poll); setConnectingPlatform(''); }, 120000);
  };

  const disconnectPlatform = async (platform: string) => {
    try {
      await api.delete(`/api/ads/auth/${platform}`);
      setStatus((prev: any) => ({ ...prev, [platform]: false }));
    } catch {}
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-8">
      {/* Mode Selector */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Ads Mode</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
          Choose how your ad campaigns are managed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => switchMode('managed')}
            disabled={saving}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              mode === 'managed'
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
            }`}
          >
            <div className="font-bold text-gray-900 dark:text-white">Managed by Twomiah</div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              We handle everything. AI creates and optimizes your ads using our ad accounts. No Google Ads experience needed.
            </p>
            {mode === 'managed' && <span className="inline-block mt-2 text-xs font-bold text-orange-600">ACTIVE</span>}
          </button>
          <button
            onClick={() => switchMode('connected')}
            disabled={saving}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              mode === 'connected'
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
            }`}
          >
            <div className="font-bold text-gray-900 dark:text-white">Connect My Account</div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Link your existing Google Ads or Meta account. Keep your history, quality scores, and audiences. We optimize within your account.
            </p>
            {mode === 'connected' && <span className="inline-block mt-2 text-xs font-bold text-orange-600">ACTIVE</span>}
          </button>
        </div>
      </div>

      {/* Platform Connections (show when connected mode) */}
      {mode === 'connected' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Connected Accounts</h3>
          <div className="space-y-3">
            {(['google', 'meta', 'tiktok'] as const).map(platform => {
              const info = status[platform];
              const connected = info?.connected;
              const labels: any = { google: 'Google Ads', meta: 'Meta (Facebook/Instagram)', tiktok: 'TikTok Ads' };
              return (
                <div key={platform} className="flex items-center justify-between p-4 rounded-lg border dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{labels[platform]}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">
                        {connected ? (info.hasAccountId ? 'Connected' : 'Connected — needs account ID') : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {connected ? (
                    <button onClick={() => disconnectPlatform(platform)} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600">
                      <Unlink className="w-4 h-4" /> Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectPlatform(platform)}
                      disabled={connectingPlatform === platform}
                      className="flex items-center gap-1 text-sm text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Link className="w-4 h-4" /> {connectingPlatform === platform ? 'Opening...' : 'Connect'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'managed' && (
        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-6 border border-blue-200 dark:border-blue-500/20">
          <h3 className="font-bold text-blue-900 dark:text-blue-300">How Managed Ads Work</h3>
          <ul className="mt-2 space-y-1 text-sm text-blue-800 dark:text-blue-400">
            <li>1. Set your budget and target area</li>
            <li>2. AI generates ad copy and selects images</li>
            <li>3. You review and approve the ads</li>
            <li>4. We launch and optimize automatically</li>
            <li>5. You see performance in the dashboard</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── PERFORMANCE TAB ─────────────────────────────────────────────────────────
function PerformanceTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('30');

  useEffect(() => { loadData(); }, [range]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/api/ads/performance', { range });
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!data) return null;

  const summary = data?.summary || { impressions: 0, clicks: 0, ctr: 0, spend: 0, leads: 0, costPerLead: 0 };
  const daily = data?.daily || [];
  const campaigns = data?.campaigns || [];

  const statCards = [
    { label: 'Impressions', value: (summary.impressions || 0).toLocaleString(), icon: Eye, color: 'blue' },
    { label: 'Clicks', value: (summary.clicks || 0).toLocaleString(), icon: MousePointer, color: 'purple' },
    { label: 'CTR', value: ((summary.ctr || 0) * 100).toFixed(2) + '%', icon: TrendingUp, color: 'green' },
    { label: 'Total Spend', value: '$' + (summary.spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }), icon: DollarSign, color: 'orange' },
    { label: 'Leads', value: (summary.leads || 0).toLocaleString(), icon: Users, color: 'emerald' },
    { label: 'Cost/Lead', value: '$' + (summary.costPerLead || 0).toFixed(2), icon: Target, color: 'red' },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map(stat => (
          <div key={stat.label} className="bg-white dark:bg-slate-900 rounded-lg p-4 shadow-sm border border-gray-100 dark:border-slate-800">
            <div className={`w-10 h-10 rounded-lg ${colorClasses[stat.color]} flex items-center justify-center mb-3`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-100 dark:border-slate-800 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-gray-900 dark:text-white">Impressions & Clicks</h3>
          <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
            {['7', '30', '90'].map(d => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === d
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-slate-400 hover:text-gray-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <MiniChart data={daily} />
        <div className="flex items-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 rounded-full bg-blue-500" />
            <span className="text-xs text-gray-500 dark:text-slate-400">Impressions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 rounded-full bg-orange-500" />
            <span className="text-xs text-gray-500 dark:text-slate-400">Clicks</span>
          </div>
        </div>
      </div>

      {/* Campaign table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-100 dark:border-slate-800">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">Active Campaigns</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Campaign</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Platform</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Impressions</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Clicks</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">CTR</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Spend</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {campaigns.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{c.name}</span>
                  </td>
                  <td className="px-4 py-3"><PlatformBadge platform={c.platform} /></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-300">{(c.impressions || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-300">{(c.clicks || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-300">{((c.ctr || 0) * 100).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-300">${(c.spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">{c.leads || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── CAMPAIGNS (MY ADS) TAB ──────────────────────────────────────────────────
function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selectedAd, setSelectedAd] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadData(); }, [filter]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/api/ads/campaigns', { status: filter });
      setCampaigns(result?.campaigns || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  const allAds = campaigns.flatMap(camp =>
    camp.ads.map((ad: any) => ({ ...ad, campaignName: camp.name, campaignId: camp.id, platform: camp.platform }))
  );

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        {['all', 'active', 'paused', 'draft'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
              filter === f
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{allAds.length} ads</span>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-2 flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Campaign
        </button>
      </div>

      {/* Ad cards grid */}
      {allAds.length === 0 ? (
        <div className="text-center py-12">
          <Target className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-slate-400">No ads found for this filter.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allAds.map((ad: any) => (
            <div
              key={ad.id}
              className="bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden"
            >
              {/* Ad preview */}
              <div className="bg-gray-50 dark:bg-slate-800 p-4 border-b border-gray-100 dark:border-slate-700">
                <div className="bg-gray-200 dark:bg-slate-700 rounded-lg h-24 flex items-center justify-center mb-3">
                  <span className="text-xs text-gray-400 dark:text-slate-500">Ad Creative Preview</span>
                </div>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">{ad.headline}</p>
                <p className="text-gray-500 dark:text-slate-400 text-xs mt-1 line-clamp-2">{ad.body}</p>
                {ad.cta && (
                  <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium bg-blue-500 text-white rounded">
                    {ad.cta}
                  </span>
                )}
              </div>

              {/* Ad meta */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <PlatformBadge platform={ad.platform} />
                  <StatusBadge status={ad.status} />
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{ad.campaignName}</p>
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => setSelectedAd(ad)}
                    className="text-xs font-medium text-orange-500 hover:text-orange-600 flex items-center gap-1"
                  >
                    View Details <ExternalLink className="w-3 h-3" />
                  </button>
                  {ad.status === 'active' && (
                    <button className="text-xs text-gray-400 hover:text-yellow-500 flex items-center gap-1">
                      <Pause className="w-3 h-3" /> Pause
                    </button>
                  )}
                  {ad.status === 'paused' && (
                    <button className="text-xs text-gray-400 hover:text-green-500 flex items-center gap-1">
                      <Play className="w-3 h-3" /> Resume
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-over detail */}
      {selectedAd && <AdDetailSlideOver ad={selectedAd} onClose={() => setSelectedAd(null)} />}

      {/* Create Campaign Wizard */}
      {showCreate && <CreateCampaignWizard onClose={() => { setShowCreate(false); loadData(); }} />}
    </div>
  );
}

// ─── CREATE CAMPAIGN WIZARD ─────────────────────────────────────────────────
function CreateCampaignWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<'google' | 'meta' | ''>('');
  const [objective, setObjective] = useState<'leads' | 'traffic' | 'awareness' | ''>('');
  const [campaignName, setCampaignName] = useState('');
  const [dailyBudget, setDailyBudget] = useState(25);
  const [duration, setDuration] = useState<'ongoing' | 'fixed'>('ongoing');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [radiusMiles, setRadiusMiles] = useState(15);
  const [zipCodes, setZipCodes] = useState('');
  const [targetHomeowners, setTargetHomeowners] = useState(false);
  const [ageMin, setAgeMin] = useState(25);
  const [ageMax, setAgeMax] = useState(65);
  const [photoTab, setPhotoTab] = useState<'photos' | 'templates'>('photos');
  const [photos, setPhotos] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [editingPreview, setEditingPreview] = useState(false);
  const [previewHeadline, setPreviewHeadline] = useState('');
  const [previewDescription, setPreviewDescription] = useState('');
  const [previewCta, setPreviewCta] = useState('');
  const [launching, setLaunching] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Auto-generate campaign name when platform/objective change
  useEffect(() => {
    if (platform && objective) {
      const platLabel = platform === 'google' ? 'Google Search' : 'Meta Social';
      const objLabel = objective.charAt(0).toUpperCase() + objective.slice(1);
      setCampaignName(`${platLabel} — ${objLabel}`);
    }
  }, [platform, objective]);

  // Load photos and templates when entering step 3
  useEffect(() => {
    if (step === 3) {
      loadPhotos();
      loadTemplates();
    }
  }, [step]);

  // Generate preview when entering step 4
  useEffect(() => {
    if (step === 4) generatePreview();
  }, [step]);

  const loadPhotos = async () => {
    setLoadingPhotos(true);
    try {
      const res = await api.get('/api/ads/photos');
      setPhotos(res?.photos || []);
    } catch {} finally { setLoadingPhotos(false); }
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await api.get('/api/ads/templates');
      setTemplates(res?.templates || []);
    } catch {} finally { setLoadingTemplates(false); }
  };

  const generatePreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await api.post('/api/ads/campaigns/preview', {
        platforms: [platform],
        objective,
        budget: dailyBudget,
        targeting: {
          radiusMiles,
          zipCodes: zipCodes ? zipCodes.split(',').map(z => z.trim()) : [],
          homeowners: targetHomeowners,
          ageMin,
          ageMax,
        },
      });
      const p = res?.preview || { headline: campaignName, description: 'Your AI-generated ad copy will appear here.', cta: 'Learn More' };
      setPreview(p);
      setPreviewHeadline(p.headline || '');
      setPreviewDescription(p.description || '');
      setPreviewCta(p.cta || 'Learn More');
    } catch {
      setPreview({ headline: campaignName, description: 'Your AI-generated ad copy will appear here.', cta: 'Learn More' });
      setPreviewHeadline(campaignName);
      setPreviewDescription('Your AI-generated ad copy will appear here.');
      setPreviewCta('Learn More');
    } finally { setLoadingPreview(false); }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await api.post('/api/ads/campaigns/launch', buildPayload('active'));
      onClose();
    } catch {} finally { setLaunching(false); }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      await api.post('/api/ads/campaigns/launch', buildPayload('draft'));
      onClose();
    } catch {} finally { setSavingDraft(false); }
  };

  const buildPayload = (status: string) => ({
    name: campaignName,
    platform,
    objective,
    status,
    budget: { daily: dailyBudget, duration, startDate: duration === 'fixed' ? startDate : undefined, endDate: duration === 'fixed' ? endDate : undefined },
    targeting: { radiusMiles, zipCodes: zipCodes ? zipCodes.split(',').map(z => z.trim()) : [], homeowners: targetHomeowners, ageMin, ageMax },
    creative: { photoId: selectedPhoto, templateId: selectedTemplate, headline: previewHeadline, description: previewDescription, cta: previewCta },
  });

  const canNext = () => {
    if (step === 1) return !!platform && !!objective && !!campaignName.trim();
    if (step === 2) return dailyBudget >= 10 && (duration === 'ongoing' || (!!startDate && !!endDate));
    if (step === 3) return !!(selectedPhoto || selectedTemplate);
    return true;
  };

  const stepLabels = ['Platform', 'Budget', 'Creative', 'Review'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-xl border dark:border-slate-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b dark:border-slate-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Create Campaign</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center justify-between">
            {stepLabels.map((label, i) => {
              const num = i + 1;
              const isActive = step === num;
              const isComplete = step > num;
              return (
                <div key={num} className="flex items-center flex-1 last:flex-initial">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                      isActive ? 'bg-orange-500 text-white' : isComplete ? 'bg-orange-500 text-white' : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                    }`}>
                      {isComplete ? <Check className="w-4 h-4" /> : num}
                    </div>
                    <span className={`text-xs mt-1 ${isActive ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
                      {label}
                    </span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 mb-5 ${isComplete ? 'bg-orange-500' : 'bg-gray-200 dark:bg-slate-700'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="p-5">
          {/* Step 1: Platform & Objective */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Select Platform</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'google' as const, label: 'Google Ads', desc: 'Search, display & YouTube ads', icon: '🔍' },
                    { id: 'meta' as const, label: 'Meta', desc: 'Facebook & Instagram ads', icon: '📱' },
                  ].map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        platform === p.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="text-2xl mb-2">{p.icon}</div>
                      <div className="font-semibold text-gray-900 dark:text-white">{p.label}</div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{p.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Campaign Objective</h4>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'leads' as const, label: 'Leads', desc: 'Phone calls & form fills', icon: Users },
                    { id: 'traffic' as const, label: 'Traffic', desc: 'Website visits', icon: MousePointer },
                    { id: 'awareness' as const, label: 'Awareness', desc: 'Brand visibility', icon: Eye },
                  ].map(o => (
                    <button
                      key={o.id}
                      onClick={() => setObjective(o.id)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        objective === o.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <o.icon className={`w-6 h-6 mb-2 ${objective === o.id ? 'text-orange-500' : 'text-gray-400 dark:text-slate-500'}`} />
                      <div className="font-semibold text-gray-900 dark:text-white text-sm">{o.label}</div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{o.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">Campaign Name</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder="e.g., Google Search — Spring Leads"
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>
            </div>
          )}

          {/* Step 2: Budget & Targeting */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                  Daily Budget: <span className="text-orange-500 font-bold">${dailyBudget}</span>/day
                </label>
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={5}
                  value={dailyBudget}
                  onChange={e => setDailyBudget(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 mt-1">
                  <span>$10/day</span>
                  <span>~${(dailyBudget * 30).toLocaleString()}/mo</span>
                  <span>$500/day</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Duration</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDuration('ongoing')}
                    className={`flex-1 p-3 rounded-lg border-2 text-left text-sm transition-all ${
                      duration === 'ongoing'
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                        : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-900 dark:text-white">Ongoing</div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Runs until you pause</p>
                  </button>
                  <button
                    onClick={() => setDuration('fixed')}
                    className={`flex-1 p-3 rounded-lg border-2 text-left text-sm transition-all ${
                      duration === 'fixed'
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                        : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-1"><Calendar className="w-4 h-4" /> Fixed Dates</div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Set start & end dates</p>
                  </button>
                </div>
                {duration === 'fixed' && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" /> Target Area
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Radius (miles)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={radiusMiles}
                      onChange={e => setRadiusMiles(Number(e.target.value))}
                      className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Or zip codes (comma-separated)</label>
                    <input
                      type="text"
                      value={zipCodes}
                      onChange={e => setZipCodes(e.target.value)}
                      placeholder="e.g., 90210, 90211"
                      className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Target Audience (optional)</label>
                <div className="space-y-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={targetHomeowners}
                      onChange={e => setTargetHomeowners(e.target.checked)}
                      className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-slate-300">Homeowners only</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Min Age</label>
                      <input
                        type="number"
                        min={18}
                        max={65}
                        value={ageMin}
                        onChange={e => setAgeMin(Number(e.target.value))}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Max Age</label>
                      <input
                        type="number"
                        min={18}
                        max={80}
                        value={ageMax}
                        onChange={e => setAgeMax(Number(e.target.value))}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Photos & Templates */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
                <button
                  onClick={() => setPhotoTab('photos')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    photoTab === 'photos'
                      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-slate-400 hover:text-gray-700'
                  }`}
                >
                  <Image className="w-4 h-4" /> My Photos
                </button>
                <button
                  onClick={() => setPhotoTab('templates')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    photoTab === 'templates'
                      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-slate-400 hover:text-gray-700'
                  }`}
                >
                  <Layout className="w-4 h-4" /> Templates
                </button>
              </div>

              {photoTab === 'photos' && (
                <div>
                  {loadingPhotos ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
                    </div>
                  ) : photos.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-lg">
                      <Image className="w-10 h-10 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-slate-400">No photos yet.</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Upload photos in the CRM first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {photos.map((photo: any) => (
                        <button
                          key={photo.id}
                          onClick={() => { setSelectedPhoto(photo.id); setSelectedTemplate(null); }}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            selectedPhoto === photo.id
                              ? 'border-green-500 ring-2 ring-green-500/30'
                              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                          }`}
                        >
                          <img src={photo.url} alt={photo.name || 'Photo'} className="w-full h-full object-cover" />
                          {selectedPhoto === photo.id && (
                            <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                                <Check className="w-5 h-5 text-white" />
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {photoTab === 'templates' && (
                <div>
                  {loadingTemplates ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-lg">
                      <Layout className="w-10 h-10 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-slate-400">No templates available.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {templates.map((tpl: any) => (
                        <button
                          key={tpl.id}
                          onClick={() => { setSelectedTemplate(tpl.id); setSelectedPhoto(null); }}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            selectedTemplate === tpl.id
                              ? 'border-green-500 bg-green-50 dark:bg-green-500/10 ring-2 ring-green-500/30'
                              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                          }`}
                        >
                          <div className="bg-gray-100 dark:bg-slate-800 rounded-lg h-24 flex items-center justify-center mb-3">
                            <Layout className="w-8 h-8 text-gray-300 dark:text-slate-600" />
                          </div>
                          <div className="font-semibold text-gray-900 dark:text-white text-sm">{tpl.name}</div>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 line-clamp-2">{tpl.description}</p>
                          {selectedTemplate === tpl.id && (
                            <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-green-600 dark:text-green-400">
                              <Check className="w-3 h-3" /> Selected
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Review & Launch */}
          {step === 4 && (
            <div className="space-y-5">
              {loadingPreview ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-3" />
                  <p className="text-sm text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-orange-500" /> AI is generating your ad preview...
                  </p>
                </div>
              ) : (
                <>
                  {/* Ad preview card */}
                  <div className="bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                    <div className="p-1.5">
                      <div className="flex items-center justify-between px-3 pt-2 pb-1">
                        <PlatformBadge platform={platform} />
                        <button
                          onClick={() => setEditingPreview(!editingPreview)}
                          className="text-xs font-medium text-orange-500 hover:text-orange-600"
                        >
                          {editingPreview ? 'Done Editing' : 'Edit'}
                        </button>
                      </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-slate-700 h-40 flex items-center justify-center">
                      {selectedPhoto ? (
                        <span className="text-xs text-gray-400 dark:text-slate-500">Selected photo preview</span>
                      ) : selectedTemplate ? (
                        <span className="text-xs text-gray-400 dark:text-slate-500">Template preview</span>
                      ) : (
                        <Image className="w-10 h-10 text-gray-300 dark:text-slate-600" />
                      )}
                    </div>
                    <div className="p-4">
                      {editingPreview ? (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Headline</label>
                            <input
                              type="text"
                              value={previewHeadline}
                              onChange={e => setPreviewHeadline(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Description</label>
                            <textarea
                              rows={3}
                              value={previewDescription}
                              onChange={e => setPreviewDescription(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">CTA Button</label>
                            <input
                              type="text"
                              value={previewCta}
                              onChange={e => setPreviewCta(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <h4 className="font-bold text-gray-900 dark:text-white text-lg">{previewHeadline}</h4>
                          <p className="text-gray-600 dark:text-slate-300 text-sm mt-2">{previewDescription}</p>
                          <span className="inline-block mt-3 px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded-lg">
                            {previewCta}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-4 space-y-2">
                    <DetailRow label="Campaign" value={campaignName} />
                    <DetailRow label="Platform" value={<PlatformBadge platform={platform} />} />
                    <DetailRow label="Objective" value={<span className="capitalize text-sm">{objective}</span>} />
                    <DetailRow label="Daily Budget" value={<span className="font-semibold text-sm">${dailyBudget}/day</span>} />
                    <DetailRow label="Duration" value={<span className="capitalize text-sm">{duration}{duration === 'fixed' ? ` (${startDate} - ${endDate})` : ''}</span>} />
                    <DetailRow label="Target Area" value={<span className="text-sm">{zipCodes ? `Zips: ${zipCodes}` : `${radiusMiles} mi radius`}</span>} />
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSaveDraft}
                      disabled={savingDraft || launching}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Save as Draft
                    </button>
                    <button
                      onClick={handleLaunch}
                      disabled={launching || savingDraft}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Launch Campaign
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation (steps 1-3) */}
        {step < 4 && (
          <div className="flex items-center justify-between p-5 border-t dark:border-slate-800">
            <button
              onClick={() => step > 1 ? setStep(step - 1) : onClose()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === 3 ? 'Generate Preview' : 'Next'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Footer navigation (step 4 - back only) */}
        {step === 4 && !loadingPreview && (
          <div className="flex items-center p-5 border-t dark:border-slate-800">
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AD APPROVAL TAB ─────────────────────────────────────────────────────────
function ApprovalsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changesModal, setChangesModal] = useState<any>(null);
  const [feedback, setFeedback] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/api/ads/pending-approvals');
      setApprovals(result?.approvals || []);
      onCountChange(result?.count || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/api/ads/${id}/approve`);
      setApprovals(prev => prev.filter(a => a.id !== id));
      onCountChange(Math.max(0, approvals.length - 1));
    } catch (err: any) {
      console.error('Failed to approve:', err);
    } finally {
      setActing(null);
    }
  };

  const handleRequestChanges = async () => {
    if (!changesModal || !feedback.trim()) return;
    setActing(changesModal.id);
    try {
      await api.post(`/api/ads/${changesModal.id}/request-changes`, { feedback });
      setApprovals(prev => prev.filter(a => a.id !== changesModal.id));
      onCountChange(Math.max(0, approvals.length - 1));
      setChangesModal(null);
      setFeedback('');
    } catch (err: any) {
      console.error('Failed to request changes:', err);
    } finally {
      setActing(null);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <div className="space-y-4">
      {approvals.length === 0 ? (
        <div className="text-center py-16">
          <Check className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">All caught up!</h3>
          <p className="text-gray-500 dark:text-slate-400 text-sm max-w-md mx-auto">
            No ads pending approval. We'll notify you when new ads are ready for review.
          </p>
        </div>
      ) : (
        approvals.map(item => (
          <div
            key={item.id}
            className="bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden"
          >
            <div className="p-5">
              <div className="flex items-start gap-5">
                {/* Ad preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <PlatformBadge platform={item.platform} />
                    <span className="text-xs text-gray-400 dark:text-slate-500">•</span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">{item.campaignName}</span>
                  </div>

                  {/* Ad creative card */}
                  <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4 border border-gray-100 dark:border-slate-700">
                    <div className="bg-gray-200 dark:bg-slate-700 rounded-lg h-32 flex items-center justify-center mb-3">
                      <span className="text-xs text-gray-400 dark:text-slate-500">Ad Image Preview</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">{item.headline}</h4>
                    <p className="text-gray-600 dark:text-slate-300 text-sm mt-1">{item.body}</p>
                    {item.cta && (
                      <span className="inline-block mt-3 px-3 py-1 text-xs font-semibold bg-blue-500 text-white rounded-md">
                        {item.cta}
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 mt-3">
                    <span className="inline-flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-full">
                      <Clock className="w-3 h-3" />
                      Requested by Twomiah
                    </span>
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleApprove(item.id)}
                    disabled={acting === item.id}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    Approve & Go Live
                  </button>
                  <button
                    onClick={() => setChangesModal(item)}
                    disabled={acting === item.id}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    Request Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Changes request modal */}
      {changesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => { setChangesModal(null); setFeedback(''); }} />
          <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-xl border dark:border-slate-800 w-full max-w-lg">
            <div className="flex items-center justify-between p-4 border-b dark:border-slate-800">
              <h3 className="font-semibold text-gray-900 dark:text-white">Request Changes</h3>
              <button onClick={() => { setChangesModal(null); setFeedback(''); }} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">
                Describe what changes you'd like made to "<span className="font-medium text-gray-900 dark:text-white">{changesModal.headline}</span>"
              </p>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                rows={4}
                placeholder="e.g., Change the headline to mention our spring special, use a different image..."
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t dark:border-slate-800">
              <button
                onClick={() => { setChangesModal(null); setFeedback(''); }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={!feedback.trim() || acting === changesModal.id}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50"
              >
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: string }) {
  const config: Record<string, { label: string; className: string }> = {
    google: { label: 'Google', className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
    meta: { label: 'Meta', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
    tiktok: { label: 'TikTok', className: 'bg-pink-50 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400' },
  };
  const c = config[platform] || { label: platform, className: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400' };
  return <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${c.className}`}>{c.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    active: { label: 'Active', className: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' },
    paused: { label: 'Paused', className: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400' },
    draft: { label: 'Draft', className: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400' },
    ended: { label: 'Ended', className: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
  };
  const c = config[status] || { label: status, className: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${c.className}`}>{c.label}</span>;
}

function AdDetailSlideOver({ ad, onClose }: { ad: any; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-slate-900 shadow-xl border-l dark:border-slate-800 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b dark:border-slate-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">Ad Details</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Preview */}
          <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
            <div className="bg-gray-200 dark:bg-slate-700 rounded-lg h-40 flex items-center justify-center mb-3">
              <span className="text-xs text-gray-400 dark:text-slate-500">Ad Creative</span>
            </div>
            <h4 className="font-semibold text-gray-900 dark:text-white text-lg">{ad.headline}</h4>
            <p className="text-gray-600 dark:text-slate-300 text-sm mt-2">{ad.body}</p>
            {ad.cta && (
              <span className="inline-block mt-3 px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded-lg">
                {ad.cta}
              </span>
            )}
          </div>

          {/* Details */}
          <div className="space-y-3">
            <DetailRow label="Campaign" value={ad.campaignName} />
            <DetailRow label="Platform" value={<PlatformBadge platform={ad.platform} />} />
            <DetailRow label="Status" value={<StatusBadge status={ad.status} />} />
            <DetailRow label="Ad ID" value={<span className="font-mono text-xs">{ad.id}</span>} />
          </div>
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-slate-800">
      <span className="text-sm text-gray-500 dark:text-slate-400">{label}</span>
      <span className="text-sm text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

// ─── SVG Mini Chart (no recharts dependency) ─────────────────────────────────
function MiniChart({ data }: { data: { date: string; impressions: number; clicks: number }[] }) {
  if (!data || data.length === 0) return null;

  const W = 800;
  const H = 200;
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const maxImp = Math.max(...data.map(d => d.impressions), 1);
  const maxClicks = Math.max(...data.map(d => d.clicks), 1);

  const xScale = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const yScaleImp = (v: number) => pad.top + chartH - (v / maxImp) * chartH;
  const yScaleClicks = (v: number) => pad.top + chartH - (v / maxClicks) * chartH;

  const pathImp = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScaleImp(d.impressions)}`).join(' ');
  const pathClicks = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScaleClicks(d.clicks)}`).join(' ');

  // Area fill for impressions
  const areaImp = pathImp + ` L${xScale(data.length - 1)},${pad.top + chartH} L${xScale(0)},${pad.top + chartH} Z`;

  // X-axis labels (show ~6 evenly spaced)
  const labelCount = Math.min(6, data.length);
  const step = Math.max(1, Math.floor(data.length / labelCount));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = pad.top + chartH * (1 - pct);
        return (
          <g key={pct}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="currentColor" className="text-gray-100 dark:text-slate-800" strokeWidth={1} />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" className="text-gray-400 dark:text-slate-500 fill-current" fontSize={9}>
              {Math.round(maxImp * pct).toLocaleString()}
            </text>
          </g>
        );
      })}

      {/* Impression area */}
      <path d={areaImp} fill="rgba(59, 130, 246, 0.08)" />
      <path d={pathImp} fill="none" stroke="#3b82f6" strokeWidth={2} />

      {/* Clicks line */}
      <path d={pathClicks} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="4 2" />

      {/* X-axis labels */}
      {data.map((d, i) => {
        if (i % step !== 0 && i !== data.length - 1) return null;
        const date = new Date(d.date + 'T00:00:00');
        const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return (
          <text key={i} x={xScale(i)} y={H - 5} textAnchor="middle" className="text-gray-400 dark:text-slate-500 fill-current" fontSize={9}>
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-100 dark:border-slate-800">
            <div className="w-10 h-10 bg-gray-200 dark:bg-slate-800 rounded-lg mb-3" />
            <div className="h-7 w-20 bg-gray-200 dark:bg-slate-800 rounded mb-2" />
            <div className="h-4 w-16 bg-gray-100 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-100 dark:border-slate-800">
        <div className="h-48 bg-gray-100 dark:bg-slate-800 rounded-lg" />
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800">
        <div className="p-4 border-b dark:border-slate-800">
          <div className="h-5 w-32 bg-gray-200 dark:bg-slate-800 rounded" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-4 border-b border-gray-50 dark:border-slate-800">
            <div className="h-4 w-48 bg-gray-100 dark:bg-slate-800 rounded" />
            <div className="h-4 w-16 bg-gray-100 dark:bg-slate-800 rounded" />
            <div className="h-4 w-16 bg-gray-100 dark:bg-slate-800 rounded" />
            <div className="h-4 w-20 bg-gray-100 dark:bg-slate-800 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-12">
      <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Something went wrong</h3>
      <p className="text-gray-500 dark:text-slate-400 text-sm mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
