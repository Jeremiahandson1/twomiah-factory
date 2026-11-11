// Moved from templates/crm-roof/frontend/src/pages/EstimatorPage.tsx — the CRM's Roof Estimator page: the settings of
// the instant estimator a homeowner uses on the roofer's website (the website's estimator section; the public API is
// /api/estimator). Changes: Save writes PUT /api/settings/estimator (server/crm/roof/reports/estimator.ts) — the
// template called PUT /api/company/estimator, which never existed, so every save failed; Save is offered to whoever
// holds company:update (the permission that route asks) and a refusal says the server's sentence. The page's own
// "not enabled on your plan" screen is the shell's now: the menu item's instant_estimator gates /crm/estimator.
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, ToggleLeft, ToggleRight, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
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
  /** The roofs the business sells, each priced on its own (company.settings.estimator.options); none = the one range above. */
  options: EstimatorOption[];
  /** Miles from the business's own address it gives estimates within; '' = anywhere. */
  serviceRadiusMiles: string;
}

/** One roof the business sells, as the estimator prices it (server: EstimatorOption). */
interface EstimatorOption { id?: string; name: string; description: string; pricePerSquareLow: string; pricePerSquareHigh: string; imageUrl: string }
const MAX_OPTIONS = 6;

/** GET /api/roof-reports/credits: the balance the estimator spends from — one roof report for each new house. */
interface Balance { credits: number; pack: { roofs: number; priceCents: number }; lowAt: number }

/** GET /api/company, as far as this page reads it. */
type CompanyRecord = Partial<Omit<EstimatorSettings, 'options' | 'serviceRadiusMiles'>> & {
  settings?: { estimator?: { options?: Array<Partial<EstimatorOption>>; serviceRadiusMiles?: number | null } };
};

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
    options: [],
    serviceRadiusMiles: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const mayBuyPack = useMayWrite('roof-reports:purchase');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [buying, setBuying] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadBalance = async () => {
    try { setBalance(await api.get('/api/roof-reports/credits')); } catch { /* the page works without the count */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const data: CompanyRecord = await api.get('/api/company');
        applyData(data);
      } catch { /* the defaults stand */ } finally { setLoading(false); }
    })();
    loadBalance();
  }, []);

  // Back from Stripe after buying a pack (server: success_url ?pack_session=…, cancel_url ?pack_cancelled=true).
  useEffect(() => {
    const session = searchParams.get('pack_session');
    const cancelled = searchParams.get('pack_cancelled');
    if (!session && !cancelled) return;
    const next = new URLSearchParams(searchParams); next.delete('pack_session'); next.delete('pack_cancelled');
    setSearchParams(next, { replace: true });
    if (!session) { toast.error('The purchase was cancelled. No roof reports were added.'); return; }
    api.post('/api/roof-reports/credits/confirm', { sessionId: session })
      .then((r: any) => { toast.success(r?.added ? `${r.added} roof reports added. You have ${r.credits}.` : `Those roof reports were already added. You have ${r?.credits}.`); })
      .catch((err: unknown) => toast.error(errorText(err, 'The roof reports could not be added.')))
      .finally(loadBalance);
  }, [searchParams]);

  const buyPack = async () => {
    setBuying(true);
    try {
      const r: { checkoutUrl?: string } = await api.post('/api/roof-reports/credits/checkout', { from: 'estimator' });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else { toast.error('The payment page could not be opened.'); setBuying(false); }
    } catch (err) { toast.error(errorText(err, 'The payment page could not be opened.')); setBuying(false); }
  };

  const applyData = (data: CompanyRecord) => {
    const extras = data.settings?.estimator || {};
    setSettings({
      options: (extras.options || []).map((o) => ({ id: o.id, name: o.name || '', description: o.description || '', pricePerSquareLow: String(o.pricePerSquareLow ?? ''), pricePerSquareHigh: String(o.pricePerSquareHigh ?? ''), imageUrl: o.imageUrl || '' })),
      serviceRadiusMiles: extras.serviceRadiusMiles ? String(extras.serviceRadiusMiles) : '',
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
      await api.put('/api/settings/estimator', { ...settings, serviceRadiusMiles: settings.serviceRadiusMiles.trim() === '' ? null : settings.serviceRadiusMiles.trim() });
      toast.success('Estimator settings saved');
    } catch (err) {
      toast.error(errorText(err, 'Failed to save settings'));
    } finally { setSaving(false); }
  };

  const setOption = (i: number, patch: Partial<EstimatorOption>) => setSettings((s) => ({ ...s, options: s.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) }));
  const addOption = () => setSettings((s) => ({ ...s, options: [...s.options, { name: '', description: '', pricePerSquareLow: s.pricePerSquareLow, pricePerSquareHigh: s.pricePerSquareHigh, imageUrl: '' }] }));
  const removeOption = (i: number) => setSettings((s) => ({ ...s, options: s.options.filter((_, k) => k !== i) }));

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

      {/* Roof reports left: the estimator uses one for each new house, and is off the website at none */}
      {balance && (() => {
        const out = balance.credits <= 0, low = !out && balance.credits <= balance.lowAt;
        return (
          <div role="status" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${out ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : low ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'bg-white dark:bg-slate-900'}`}>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                {out ? 'You have no roof reports left, so the estimator is off your website' : `${balance.credits.toLocaleString()} roof ${balance.credits === 1 ? 'report' : 'reports'} left`}
                {low && <span className="ml-2 text-amber-800 dark:text-amber-300">— running low</span>}
              </p>
              <p className="text-xs text-gray-600 mt-0.5 dark:text-slate-400">
                {out ? 'It comes back by itself when you buy more. ' : 'The estimator uses one for each new house it measures; the same house again uses none. At none left it comes off your website until you buy more. '}
                A pack of {balance.pack.roofs} is {money(balance.pack.priceCents / 100, balance.pack.priceCents % 100 ? 2 : 0)}, with no monthly charge.
                {!mayBuyPack && (out || low) ? ' Ask an owner or admin to buy more.' : ''}
              </p>
            </div>
            {mayBuyPack && (
              <button type="button" onClick={buyPack} disabled={buying}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors ${out || low ? 'bg-orange-600 text-white hover:bg-orange-700' : 'border text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Buy {balance.pack.roofs} roof reports
              </button>
            )}
          </div>
        );
      })()}

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

      {/* The roofs the business sells: each priced on its own */}
      <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Roof Options</h2>
          {maySave && settings.options.length < MAX_OPTIONS && (
            <button type="button" onClick={addOption} className="flex items-center gap-1.5 px-3 py-1.5 border text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800">
              <Plus className="w-4 h-4" /> Add an option
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-3 dark:text-slate-400">
          Add each roof you sell (asphalt shingles, metal, and so on) with its own price range. Homeowners see a price for each one and can say which they are interested in, which is noted on the lead. With no options here, they see the one range from the prices above. Up to {MAX_OPTIONS}.
        </p>
        {settings.options.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No options yet: homeowners see one price range.</p>}
        <div className="space-y-4">
          {settings.options.map((o, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2 dark:border-slate-700">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor={`option-name-${i}`} className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Name</label>
                  <input id={`option-name-${i}`} value={o.name} maxLength={60} placeholder="Architectural shingles" onChange={(e) => setOption(i, { name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label htmlFor={`option-low-${i}`} className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Low ($/square)</label>
                  <input id={`option-low-${i}`} type="number" step="0.01" min="0" value={o.pricePerSquareLow} onChange={(e) => setOption(i, { pricePerSquareLow: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label htmlFor={`option-high-${i}`} className="text-xs text-gray-500 block mb-1 dark:text-slate-400">High ($/square)</label>
                  <input id={`option-high-${i}`} type="number" step="0.01" min="0" value={o.pricePerSquareHigh} onChange={(e) => setOption(i, { pricePerSquareHigh: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div>
                <label htmlFor={`option-about-${i}`} className="text-xs text-gray-500 block mb-1 dark:text-slate-400">A line about it (optional)</label>
                <input id={`option-about-${i}`} value={o.description} maxLength={240} placeholder="30-year warranty, most popular" onChange={(e) => setOption(i, { description: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label htmlFor={`option-picture-${i}`} className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Picture address (optional, starts with https://)</label>
                  <input id={`option-picture-${i}`} value={o.imageUrl} maxLength={500} placeholder="https://…" onChange={(e) => setOption(i, { imageUrl: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                {maySave && (
                  <button type="button" onClick={() => removeOption(i)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40">
                    <Trash2 className="w-4 h-4" /> Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The service area */}
      <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-gray-900 mb-1 dark:text-slate-100">Service Area</h2>
        <p className="text-xs text-gray-500 mb-3 dark:text-slate-400">
          Give estimates only within this many miles of your business address (Company settings). An address further away is told you do not serve it: it is not measured, uses no roof report, and is not added as a lead. Leave empty to give estimates anywhere.
        </p>
        <div className="max-w-[180px]">
          <label htmlFor="service-radius" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Miles (empty = anywhere)</label>
          <input id="service-radius" type="number" step="1" min="1" max="500" value={settings.serviceRadiusMiles} onChange={(e) => setSettings({ ...settings, serviceRadiusMiles: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
        </div>
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
          <li>They enter their address, their name, and a phone number or an email</li>
          <li>Their roof is measured from aerial data, using one of your roof reports</li>
          <li>They see their roof outlined on the aerial picture, and can drag a corner or tap the right building if it is off</li>
          <li>An instant price range is shown for each roof option above</li>
          <li>They are added as a lead in your CRM, also when the roof could not be measured, so you can follow up</li>
        </ol>
      </div>
    </div>
  );
}
