import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Lender {
  id: string;
  name: string;
  apiKey: string;
  priority: number;
  minAmount: number;
  maxAmount: number;
  termsAvailable: number[];
  active: boolean;
  isWisetack?: boolean;
}

export default function FinancingPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lender | null>(null);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formMinAmount, setFormMinAmount] = useState(0);
  const [formMaxAmount, setFormMaxAmount] = useState(100000);
  const [formTerms, setFormTerms] = useState('12,24,36,48,60');
  const [formActive, setFormActive] = useState(true);

  // Wisetack config
  const [wisetackApiKey, setWisetackApiKey] = useState('');
  const [wisetackMerchantId, setWisetackMerchantId] = useState('');
  const [wisetackSaving, setWisetackSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [lenderData, wisetackData] = await Promise.all([
          api.get('/api/financing/lenders'),
          api.get('/api/financing/wisetack-config'),
        ]);
        setLenders(lenderData.sort((a: Lender, b: Lender) => a.priority - b.priority));
        if (wisetackData) {
          setWisetackApiKey(wisetackData.apiKey || '');
          setWisetackMerchantId(wisetackData.merchantId || '');
        }
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormApiKey('');
    setFormMinAmount(0);
    setFormMaxAmount(100000);
    setFormTerms('12,24,36,48,60');
    setFormActive(true);
    setShowForm(true);
  }

  function openEdit(lender: Lender) {
    setEditing(lender);
    setFormName(lender.name);
    setFormApiKey(lender.apiKey);
    setFormMinAmount(lender.minAmount);
    setFormMaxAmount(lender.maxAmount);
    setFormTerms(lender.termsAvailable.join(','));
    setFormActive(lender.active);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    const terms = formTerms.split(',').map((t) => parseInt(t.trim())).filter((t) => !isNaN(t));
    const payload = {
      name: formName,
      apiKey: formApiKey,
      minAmount: formMinAmount,
      maxAmount: formMaxAmount,
      termsAvailable: terms,
      active: formActive,
    };
    try {
      if (editing) {
        const updated = await api.put(`/api/financing/lenders/${editing.id}`, payload);
        setLenders(lenders.map((l) => (l.id === editing.id ? updated : l)));
      } else {
        const created = await api.post('/api/financing/lenders', {
          ...payload,
          priority: lenders.length + 1,
        });
        setLenders([...lenders, created]);
      }
      setShowForm(false);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  function moveLender(index: number, direction: 'up' | 'down') {
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= lenders.length) return;
    const updated = [...lenders];
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    // Update priorities
    const reordered = updated.map((l, i) => ({ ...l, priority: i + 1 }));
    setLenders(reordered);
    api.post('/api/financing/lenders/reorder', {
      order: reordered.map((l) => l.id),
    });
  }

  async function handleSaveWisetack() {
    setWisetackSaving(true);
    try {
      await api.put('/api/financing/wisetack-config', {
        apiKey: wisetackApiKey,
        merchantId: wisetackMerchantId,
      });
    } catch {
      // handle
    } finally {
      setWisetackSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Financing / Lenders</h1>
          <button
            onClick={openCreate}
            className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
          >
            + Add Lender
          </button>
        </div>

        {/* Lender List */}
        {lenders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center mb-6">
            <p className="text-gray-500 text-lg">No lenders configured yet.</p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {lenders.map((lender, i) => (
              <div key={lender.id} className="bg-white rounded-xl shadow-lg p-5">
                <div className="flex items-center gap-4">
                  {/* Priority order controls */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveLender(i, 'up')}
                      disabled={i === 0}
                      className="p-2 text-gray-400 hover:text-gray-700 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <span className="text-center text-xs font-bold text-gray-400">#{lender.priority}</span>
                    <button
                      onClick={() => moveLender(i, 'down')}
                      disabled={i === lenders.length - 1}
                      className="p-2 text-gray-400 hover:text-gray-700 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className={`font-bold text-lg ${lender.active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {lender.name}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        lender.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {lender.active ? 'Active' : 'Inactive'}
                      </span>
                      {lender.isWisetack && (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                          Wisetack
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Amount Range</p>
                        <p className="text-sm font-semibold text-gray-700">
                          ${lender.minAmount.toLocaleString()} - ${lender.maxAmount.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Terms Available</p>
                        <p className="text-sm font-semibold text-gray-700">
                          {lender.termsAvailable.map((t) => `${t}mo`).join(', ')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">API Key</p>
                        <p className="text-sm font-mono text-gray-500">
                          {lender.apiKey ? '****' + lender.apiKey.slice(-4) : 'Not set'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => openEdit(lender)}
                    className="p-3 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Wisetack Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Wisetack Configuration</h2>
              <p className="text-sm text-gray-500">Configure your Wisetack integration settings</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
              <input
                type="password"
                value={wisetackApiKey}
                onChange={(e) => setWisetackApiKey(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono min-h-[48px]"
                placeholder="wt_live_..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Merchant ID</label>
              <input
                value={wisetackMerchantId}
                onChange={(e) => setWisetackMerchantId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono min-h-[48px]"
                placeholder="merch_..."
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSaveWisetack}
                disabled={wisetackSaving}
                className="px-8 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
              >
                {wisetackSaving ? 'Saving...' : 'Save Wisetack Config'}
              </button>
            </div>
          </div>
        </div>

        {/* Lender Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">
                  {editing ? 'Edit Lender' : 'Add Lender'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Lender Name</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="GreenSky"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
                  <input
                    type="password"
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono min-h-[48px]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Min Amount ($)</label>
                    <input
                      type="number"
                      value={formMinAmount}
                      onChange={(e) => setFormMinAmount(Number(e.target.value))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Max Amount ($)</label>
                    <input
                      type="number"
                      value={formMaxAmount}
                      onChange={(e) => setFormMaxAmount(Number(e.target.value))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Terms Available (months, comma-separated)
                  </label>
                  <input
                    value={formTerms}
                    onChange={(e) => setFormTerms(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="12,24,36,48,60"
                  />
                </div>
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer min-h-[48px]">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="w-5 h-5 rounded text-blue-600"
                  />
                  <span className="font-semibold text-gray-700">Active</span>
                </label>
              </div>
              <div className="p-6 border-t border-gray-200 flex gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formName}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
                >
                  {saving ? 'Saving...' : editing ? 'Update' : 'Add Lender'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
