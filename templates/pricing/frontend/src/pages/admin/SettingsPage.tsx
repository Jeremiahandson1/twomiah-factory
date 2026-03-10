import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Settings {
  presentationText: {
    yr1Explanation: string;
    thirtyDayExplanation: string;
    buyTodayExplanation: string;
    rescissionLanguage: string;
  };
  defaults: {
    yr1MarkupPercent: number;
    thirtyDayMarkupPercent: number;
    todayDiscountPercent: number;
    commissionBasePercent: number;
    commissionBonusPercent: number;
    quoteExpiryDays: number;
  };
  demoMode: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get('/api/settings');
        setSettings(data);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/api/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      window.open('/api/settings/export', '_blank');
    } finally {
      setExporting(false);
    }
  }

  function updatePresentationText(field: keyof Settings['presentationText'], value: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      presentationText: { ...settings.presentationText, [field]: value },
    });
  }

  function updateDefault(field: keyof Settings['defaults'], value: number) {
    if (!settings) return;
    setSettings({
      ...settings,
      defaults: { ...settings.defaults, [field]: value },
    });
  }

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-green-600 font-semibold text-sm">Saved!</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Presentation Text Editor */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Presentation Text</h2>
          <p className="text-sm text-gray-500 mb-6">
            Customize the text shown during price presentations to explain each pricing tier.
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                1-Year Price Explanation
              </label>
              <textarea
                value={settings.presentationText.yr1Explanation}
                onChange={(e) => updatePresentationText('yr1Explanation', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                rows={3}
                placeholder="Explain what the 1-year price means..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                30-Day Price Explanation
              </label>
              <textarea
                value={settings.presentationText.thirtyDayExplanation}
                onChange={(e) => updatePresentationText('thirtyDayExplanation', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                rows={3}
                placeholder="Explain what the 30-day price means..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Buy Today Explanation
              </label>
              <textarea
                value={settings.presentationText.buyTodayExplanation}
                onChange={(e) => updatePresentationText('buyTodayExplanation', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[140px]"
                rows={5}
                placeholder="Explain the buy today offer and why it's the best value..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Rescission Language
              </label>
              <textarea
                value={settings.presentationText.rescissionLanguage}
                onChange={(e) => updatePresentationText('rescissionLanguage', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[120px]"
                rows={4}
                placeholder="Right of rescission legal language..."
              />
            </div>
          </div>
        </div>

        {/* Defaults */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Default Values</h2>
          <p className="text-sm text-gray-500 mb-6">
            These defaults are used when creating new products and quotes.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                1-Year Markup %
              </label>
              <input
                type="number"
                value={settings.defaults.yr1MarkupPercent}
                onChange={(e) => updateDefault('yr1MarkupPercent', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                30-Day Markup %
              </label>
              <input
                type="number"
                value={settings.defaults.thirtyDayMarkupPercent}
                onChange={(e) => updateDefault('thirtyDayMarkupPercent', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Today Discount %
              </label>
              <input
                type="number"
                value={settings.defaults.todayDiscountPercent}
                onChange={(e) => updateDefault('todayDiscountPercent', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Commission Base %
              </label>
              <input
                type="number"
                value={settings.defaults.commissionBasePercent}
                onChange={(e) => updateDefault('commissionBasePercent', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Commission Bonus %
              </label>
              <input
                type="number"
                value={settings.defaults.commissionBonusPercent}
                onChange={(e) => updateDefault('commissionBonusPercent', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Quote Expiry (days)
              </label>
              <input
                type="number"
                value={settings.defaults.quoteExpiryDays}
                onChange={(e) => updateDefault('quoteExpiryDays', Number(e.target.value))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
          </div>
        </div>

        {/* Demo Mode & Export */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">System</h2>

          <div className="flex items-center justify-between py-4 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-900">Demo Mode</h3>
              <p className="text-sm text-gray-500">Enable demo mode for training and demonstrations</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, demoMode: !settings.demoMode })}
              className={`relative w-16 h-9 rounded-full transition-colors ${
                settings.demoMode ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute top-1.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                settings.demoMode ? 'left-8' : 'left-1.5'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between py-4">
            <div>
              <h3 className="font-semibold text-gray-900">Data Export</h3>
              <p className="text-sm text-gray-500">Download a full export of your account data</p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-5 py-3 bg-gray-800 text-white font-semibold rounded-lg hover:bg-gray-900 disabled:bg-gray-300 transition-colors text-sm min-h-[48px]"
            >
              {exporting ? 'Exporting...' : 'Export Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
