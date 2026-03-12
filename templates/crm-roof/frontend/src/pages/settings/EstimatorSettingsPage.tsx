import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Save, Copy, CheckCircle, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

export default function EstimatorSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [settings, setSettings] = useState({
    estimatorEnabled: false,
    pricePerSquareLow: '350.00',
    pricePerSquareHigh: '550.00',
    estimatorHeadline: 'Get Your Free Roof Estimate',
    estimatorDisclaimer: 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.',
  });
  const [companySlug, setCompanySlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/company', { headers });
      if (res.ok) {
        const data = await res.json();
        setCompanySlug(data.slug || '');
        setSettings({
          estimatorEnabled: data.estimatorEnabled ?? false,
          pricePerSquareLow: data.pricePerSquareLow || '350.00',
          pricePerSquareHigh: data.pricePerSquareHigh || '550.00',
          estimatorHeadline: data.estimatorHeadline || 'Get Your Free Roof Estimate',
          estimatorDisclaimer: data.estimatorDisclaimer || 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.',
        });
      }
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/estimator', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      toast.success('Estimator settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const embedSnippet = `<div id="twomiah-estimator" data-slug="${companySlug}"></div>
<script src="${window.location.origin}/estimator.js"></script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Embed code copied');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <button onClick={() => navigate('/crm/settings')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft className="w-4 h-4" /> Back to Settings
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Instant Estimator</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Embed a roof cost estimator on your website. Visitors enter their address and instantly see an estimated price range.
          </p>
        </div>

        {/* Enable toggle */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Enable Estimator</h2>
              <p className="text-xs text-gray-500 mt-0.5">Allow your website to serve instant estimates</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.estimatorEnabled}
                onChange={(e) => setSettings({ ...settings, estimatorEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-purple-300 rounded-full peer peer-checked:bg-purple-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>
        </div>

        {/* Pricing */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Pricing Range</h2>
          <p className="text-xs text-gray-500 mb-3">Set the per-square price range shown to homeowners.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Low ($/square)</label>
              <input
                type="number"
                step="0.01"
                value={settings.pricePerSquareLow}
                onChange={(e) => setSettings({ ...settings, pricePerSquareLow: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">High ($/square)</label>
              <input
                type="number"
                step="0.01"
                value={settings.pricePerSquareHigh}
                onChange={(e) => setSettings({ ...settings, pricePerSquareHigh: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Example: A 25-square roof at ${settings.pricePerSquareLow}–${settings.pricePerSquareHigh}/sq = ${(25 * Number(settings.pricePerSquareLow)).toLocaleString()}–${(25 * Number(settings.pricePerSquareHigh)).toLocaleString()}
          </p>
        </div>

        {/* Customization */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Customization</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Headline</label>
              <input
                value={settings.estimatorHeadline}
                onChange={(e) => setSettings({ ...settings, estimatorHeadline: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Disclaimer</label>
              <textarea
                value={settings.estimatorDisclaimer}
                onChange={(e) => setSettings({ ...settings, estimatorDisclaimer: e.target.value })}
                rows={3}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
            </div>
          </div>
        </div>

        {/* Embed Code */}
        {settings.estimatorEnabled && companySlug && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Embed Code</h2>
            <p className="text-xs text-gray-500 mb-3">Paste this snippet into your website HTML where you want the estimator to appear.</p>
            <div className="relative">
              <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-x-auto">
                {embedSnippet}
              </pre>
              <button
                onClick={copyEmbed}
                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600"
              >
                {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
