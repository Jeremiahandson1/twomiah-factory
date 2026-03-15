import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Save, ToggleLeft, ToggleRight, ExternalLink, FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function EstimatorPage() {
  const { company, hasFeature } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState({
    estimatorEnabled: false,
    pricePerSquareLow: '350.00',
    pricePerSquareHigh: '550.00',
    estimatorHeadline: 'Get Your Free Roof Estimate',
    estimatorDisclaimer: 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.company.get();
        applyData(data);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const applyData = (data: any) => {
    setSettings({
      estimatorEnabled: data.estimatorEnabled ?? false,
      pricePerSquareLow: data.pricePerSquareLow || '350.00',
      pricePerSquareHigh: data.pricePerSquareHigh || '550.00',
      estimatorHeadline: data.estimatorHeadline || 'Get Your Free Roof Estimate',
      estimatorDisclaimer: data.estimatorDisclaimer || 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.',
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.request('/api/company/estimator', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      toast.success('Estimator settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally { setSaving(false); }
  };

  if (!hasFeature('instant_estimator')) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Instant Estimator</h2>
        <p className="text-gray-500 mb-4">The Instant Estimator uses Google satellite data to measure roofs and provide homeowners with an instant price range.</p>
        <p className="text-gray-400 text-sm">This feature is not enabled on your plan. Contact support to add it.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const siteUrl = company?.settings?.siteUrl;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roof Estimator</h1>
          <p className="text-sm text-gray-500 mt-1">Configure the instant estimator on your website. Homeowners enter their address and get a satellite-based price range.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/roof-reports" className="flex items-center gap-1.5 px-4 py-2.5 border text-sm font-medium rounded-lg hover:bg-gray-50">
            <FileBarChart className="w-4 h-4" /> Roof Reports
          </Link>
          {siteUrl && (
            <a href={siteUrl + '/estimate'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2.5 border text-sm font-medium rounded-lg hover:bg-gray-50">
              <ExternalLink className="w-4 h-4" /> View on Website
            </a>
          )}
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Enable Estimator</h2>
          <p className="text-xs text-gray-500 mt-0.5">When disabled, visitors who go to the estimate page will be redirected to your contact page instead.</p>
        </div>
        <button onClick={() => setSettings(s => ({ ...s, estimatorEnabled: !s.estimatorEnabled }))} className="flex items-center">
          {settings.estimatorEnabled
            ? <ToggleRight className="w-10 h-10 text-green-500" />
            : <ToggleLeft className="w-10 h-10 text-gray-300" />}
        </button>
      </div>

      {/* Pricing */}
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Price Per Square</h2>
        <p className="text-xs text-gray-500 mb-3">Set the cost range per roofing square (100 sqft). This determines the estimate shown to homeowners.</p>
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Low ($/square)</label>
            <input type="number" step="0.01" value={settings.pricePerSquareLow} onChange={(e) => setSettings({ ...settings, pricePerSquareLow: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">High ($/square)</label>
            <input type="number" step="0.01" value={settings.pricePerSquareHigh} onChange={(e) => setSettings({ ...settings, pricePerSquareHigh: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Example: A 25-square roof at ${settings.pricePerSquareLow}–${settings.pricePerSquareHigh}/sq = ${(25 * Number(settings.pricePerSquareLow)).toLocaleString()}–${(25 * Number(settings.pricePerSquareHigh)).toLocaleString()}
        </p>
      </div>

      {/* Customization */}
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Customization</h2>
        <div className="space-y-3 max-w-lg">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Headline</label>
            <input value={settings.estimatorHeadline} onChange={(e) => setSettings({ ...settings, estimatorHeadline: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Disclaimer</label>
            <textarea value={settings.estimatorDisclaimer} onChange={(e) => setSettings({ ...settings, estimatorDisclaimer: e.target.value })} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
        <h2 className="text-sm font-semibold text-blue-900 mb-2">How It Works</h2>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
          <li>Homeowner visits the "Free Estimate" page on your website</li>
          <li>They enter their address</li>
          <li>Google Solar API measures their roof via satellite imagery</li>
          <li>An instant price range is shown based on your per-square pricing above</li>
          <li>If they enter contact info, they're automatically added as a lead in your CRM</li>
        </ol>
      </div>
    </div>
  );
}
