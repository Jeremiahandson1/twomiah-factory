import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Rep {
  id: string;
  name: string;
  email: string;
  role: 'rep' | 'senior_rep' | 'manager' | 'admin';
  territory: string;
  territoryId: string;
  active: boolean;
  stats?: {
    totalRevenue: number;
    closeRate: number;
    quotesCreated: number;
  };
  commissionOverrides?: {
    basePercent?: number;
    bonusPercent?: number;
  };
}

interface Territory {
  id: string;
  name: string;
}

const ROLES = [
  { value: 'rep', label: 'Sales Rep' },
  { value: 'senior_rep', label: 'Senior Rep' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

export default function RepsPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRep, setEditingRep] = useState<Rep | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<Rep['role']>('rep');
  const [formTerritory, setFormTerritory] = useState('');
  const [formBaseOverride, setFormBaseOverride] = useState('');
  const [formBonusOverride, setFormBonusOverride] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [repsData, terrData] = await Promise.all([
          api.get('/api/reps'),
          api.get('/api/territories'),
        ]);
        setReps(repsData);
        setTerritories(terrData);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function openAddModal() {
    setEditingRep(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('rep');
    setFormTerritory('');
    setFormBaseOverride('');
    setFormBonusOverride('');
    setShowModal(true);
  }

  function openEditModal(rep: Rep) {
    setEditingRep(rep);
    setFormName(rep.name);
    setFormEmail(rep.email);
    setFormPassword('');
    setFormRole(rep.role);
    setFormTerritory(rep.territoryId);
    setFormBaseOverride(rep.commissionOverrides?.basePercent?.toString() || '');
    setFormBonusOverride(rep.commissionOverrides?.bonusPercent?.toString() || '');
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      name: formName,
      email: formEmail,
      password: formPassword || undefined,
      role: formRole,
      territoryId: formTerritory,
      commissionOverrides: {
        basePercent: formBaseOverride ? Number(formBaseOverride) : undefined,
        bonusPercent: formBonusOverride ? Number(formBonusOverride) : undefined,
      },
    };
    try {
      if (editingRep) {
        const updated = await api.put(`/api/reps/${editingRep.id}`, payload);
        setReps(reps.map((r) => (r.id === editingRep.id ? updated : r)));
      } else {
        const created = await api.post('/api/reps', payload);
        setReps([...reps, created]);
      }
      setShowModal(false);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rep: Rep) {
    try {
      const updated = await api.put(`/api/reps/${rep.id}`, { active: !rep.active });
      setReps(reps.map((r) => (r.id === rep.id ? updated : r)));
    } catch {
      // handle
    }
  }

  function getRoleBadge(role: Rep['role']) {
    const styles: Record<string, string> = {
      rep: 'bg-gray-100 text-gray-700',
      senior_rep: 'bg-blue-100 text-blue-700',
      manager: 'bg-purple-100 text-purple-700',
      admin: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      rep: 'Rep',
      senior_rep: 'Senior Rep',
      manager: 'Manager',
      admin: 'Admin',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-bold ${styles[role]}`}>
        {labels[role]}
      </span>
    );
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
          <h1 className="text-2xl font-bold text-gray-900">Sales Reps</h1>
          <button
            onClick={openAddModal}
            className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
          >
            + Add Rep
          </button>
        </div>

        {/* Reps List */}
        <div className="space-y-3">
          {reps.map((rep) => (
            <div key={rep.id} className="bg-white rounded-xl shadow-lg p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                    rep.active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {rep.name.split(' ').map((n) => n[0]).join('')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold text-lg ${rep.active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {rep.name}
                      </h3>
                      {!rep.active && (
                        <span className="px-2 py-0.5 bg-gray-200 text-gray-500 rounded text-xs font-medium">Inactive</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{rep.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {getRoleBadge(rep.role)}
                      {rep.territory && (
                        <span className="text-xs text-gray-500">{rep.territory}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(rep)}
                    className="p-3 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => toggleActive(rep)}
                    className={`relative w-14 h-8 rounded-full transition-colors min-h-[32px] ${
                      rep.active ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                      rep.active ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* Quick Stats */}
              {rep.stats && (
                <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="font-bold text-gray-900">${rep.stats.totalRevenue.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Close Rate</p>
                    <p className="font-bold text-gray-900">{rep.stats.closeRate}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Quotes</p>
                    <p className="font-bold text-gray-900">{rep.stats.quotesCreated}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingRep ? 'Edit Rep' : 'Add New Rep'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="john@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Password {editingRep && <span className="text-gray-400 font-normal">(leave blank to keep current)</span>}
                  </label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="********"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Role</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as Rep['role'])}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Territory</label>
                  <select
                    value={formTerritory}
                    onChange={(e) => setFormTerritory(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                  >
                    <option value="">No Territory</option>
                    {territories.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3">Commission Overrides</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Base Commission %</label>
                      <input
                        type="number"
                        value={formBaseOverride}
                        onChange={(e) => setFormBaseOverride(e.target.value)}
                        placeholder="Default"
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Bonus Commission %</label>
                      <input
                        type="number"
                        value={formBonusOverride}
                        onChange={(e) => setFormBonusOverride(e.target.value)}
                        placeholder="Default"
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-gray-200 flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formName || !formEmail}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
                >
                  {saving ? 'Saving...' : editingRep ? 'Update Rep' : 'Create Rep'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
