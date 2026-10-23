// Moved from templates/crm-roof/frontend/src/pages/EstimatorPage.tsx — the CRM's Roof Estimator page: the settings of
// the instant estimator a homeowner uses on the roofer's website (the website's estimator section; the public API is
// /api/estimator). Changes: Save writes PUT /api/settings/estimator (server/crm/roof/reports/estimator.ts) — the
// template called PUT /api/company/estimator, which never existed, so every save failed; Save is offered to whoever
// holds company:update (the permission that route asks) and a refusal says the server's sentence. The page's own
// "not enabled on your plan" screen is the shell's now: the menu item's instant_estimator gates /crm/estimator.
import { useState, useEffect } from 'react';
import { Save, ToggleLeft, ToggleRight, ExternalLink } from 'lucide-react';
import { useAuth, useMayWrite, useToast, errorText } from '../../../../shared';
import { api } from '../../../../api';
import { money } from '@twomiah/tenant-ui/src/money'

/** The estimator's columns on the company (GET /api/company). */
interface EstimatorSettings {
  estimatorEnabled: boolean;
  pricePerSquareLow: string;
  pricePerSquareHigh: string;
  estimatorHeadline: string;
  estimatorDisclaimer: string;
}

const DEFAULT_HEADLINE = 'Get Your Free Roof Estimate';
const DEFAULT_DISCLAIMER = 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.';

export default function EstimatorPage() {
  const { company } = useAuth();
  const toast = useToast();
  const maySave = useMayWrite('company:update');
  const [settings, setSettings] = useState<EstimatorSettings>({
    estimatorEnabled: false,
    pricePerSquareLow: '350.00',
    pricePerSquareHigh: '550.00',
    estimatorHeadline: DEFAULT_HEADLINE,
    estimatorDisclaimer: DEFAULT_DISCLAIMER,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data: Partial<EstimatorSettings> = await api.get('/api/company');
        applyData(data);
      } catch { /* the defaults stand */ } finally { setLoading(false); }
    })();
  }, []);

  const applyData = (data: Partial<EstimatorSettings>) => {
    setSettings({
      estimatorEnabled: data.estimatorEnabled ?? false,
      pricePerSquareLow: data.pricePerSquareLow || '350.00',
      pricePerSquareHigh: data.pricePerSquareHigh || '550.00',
      estimatorHeadline: data.estimatorHeadline || DEFAULT_HEADLINE,
      estimatorDisclaimer: data.estimatorDisclaimer || DEFAULT_DISCLAIMER,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/estimator', settings);
      toast.success('Estimator settings saved');
    } catch (err) {
      toast.error(errorText(err, 'Failed to save settings'));
    } finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" /></div>;
  }

  const siteUrl = typeof company?.settings?.siteUrl === 'string' ? company.settings.siteUrl : '';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Roof Estimator</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Configure the instant estimator on your website. Homeowners enter their address and get a satellite-based price range.</p>
        </div>
        <div className="flex items-center gap-3">
          {siteUrl && (
            <a href={siteUrl + '/estimate'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2.5 border text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
              <ExternalLink className="w-4 h-4" /> View on Website
            </a>
          )}
          {maySave && (
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>
      {!maySave && <p className="text-xs text-gray-500 dark:text-slate-400">Only an owner or administrator can change the estimator settings.</p>}

      {/* Enable toggle */}
      <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center justify-between dark:bg-slate-900">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Enable Estimator</h2>
          <p className="text-xs text-gray-500 mt-0.5 dark:text-slate-400">When disabled, visitors who go to the estimate page will be redirected to your contact page instead.</p>
        </div>
        <button onClick={() => setSettings(s => ({ ...s, estimatorEnabled: !s.estimatorEnabled }))} aria-label="Enable Estimator" aria-pressed={!!settings.estimatorEnabled} className="flex items-center">
          {settings.estimatorEnabled
            ? <ToggleRight className="w-10 h-10 text-green-500 dark:text-green-300" />
            : <ToggleLeft className="w-10 h-10 text-gray-300" />}
        </button>
      </div>

      {/* Pricing */}
      <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-slate-100">Price Per Square</h2>
        <p className="text-xs text-gray-500 mb-3 dark:text-slate-400">Set the cost range per roofing square (100 sqft). This determines the estimate shown to homeowners.</p>
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Low ($/square)</label>
            <input type="number" step="0.01" value={settings.pricePerSquareLow} onChange={(e) => setSettings({ ...settings, pricePerSquareLow: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">High ($/square)</label>
            <input type="number" step="0.01" value={settings.pricePerSquareHigh} onChange={(e) => setSettings({ ...settings, pricePerSquareHigh: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
          Example: A 25-square roof at ${settings.pricePerSquareLow}–${settings.pricePerSquareHigh}/sq = {money((25 * Number(settings.pricePerSquareLow)))}–{money((25 * Number(settings.pricePerSquareHigh)))}
        </p>
      </div>

      {/* Customization */}
      <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 dark:text-slate-100">Customization</h2>
        <div className="space-y-3 max-w-lg">
          <div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Headline</label>
            <input value={settings.estimatorHeadline} onChange={(e) => setSettings({ ...settings, estimatorHeadline: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Disclaimer</label>
            <textarea value={settings.estimatorDisclaimer} onChange={(e) => setSettings({ ...settings, estimatorDisclaimer: e.target.value })} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" />
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-5 text-gray-900 dark:text-slate-100 dark:bg-blue-950/40 dark:border-blue-900">
        <h2 className="text-sm font-semibold text-blue-900 mb-2 dark:text-blue-300">How It Works</h2>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside dark:text-blue-300">
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
