import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Territory {
  id: string;
  name: string;
  description: string;
  active: boolean;
  reps: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}

interface AvailableRep {
  id: string;
  name: string;
  email: string;
}

export default function TerritoriesPage() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [availableReps, setAvailableReps] = useState<AvailableRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Territory | null>(null);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formActive, setFormActive] = useState(true);

  const [assigningTerritoryId, setAssigningTerritoryId] = useState<string | null>(null);
  const [selectedRepToAssign, setSelectedRepToAssign] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [terrData, repsData] = await Promise.all([
          api.get('/api/territories'),
          api.get('/api/reps'),
        ]);
        setTerritories(terrData);
        setAvailableReps(repsData);
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
    setFormDescription('');
    setFormActive(true);
    setShowForm(true);
  }

  function openEdit(t: Territory) {
    setEditing(t);
    setFormName(t.name);
    setFormDescription(t.description);
    setFormActive(t.active);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = { name: formName, description: formDescription, active: formActive };
    try {
      if (editing) {
        const updated = await api.put(`/api/territories/${editing.id}`, payload);
        setTerritories(territories.map((t) => (t.id === editing.id ? updated : t)));
      } else {
        const created = await api.post('/api/territories', payload);
        setTerritories([...territories, created]);
      }
      setShowForm(false);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function assignRep(territoryId: string) {
    if (!selectedRepToAssign) return;
    try {
      const updated = await api.post(`/api/territories/${territoryId}/assign`, {
        repId: selectedRepToAssign,
      });
      setTerritories(territories.map((t) => (t.id === territoryId ? updated : t)));
      setSelectedRepToAssign('');
      setAssigningTerritoryId(null);
    } catch {
      // handle
    }
  }

  async function removeRep(territoryId: string, repId: string) {
    try {
      const updated = await api.post(`/api/territories/${territoryId}/unassign`, { repId });
      setTerritories(territories.map((t) => (t.id === territoryId ? updated : t)));
    } catch {
      // handle
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
          <h1 className="text-2xl font-bold text-gray-900">Territories</h1>
          <button
            onClick={openCreate}
            className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
          >
            + Create Territory
          </button>
        </div>

        {territories.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg">No territories created yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {territories.map((territory) => (
              <div key={territory.id} className="bg-white rounded-xl shadow-lg p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className={`font-bold text-lg ${territory.active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {territory.name}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        territory.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {territory.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {territory.description && (
                      <p className="text-sm text-gray-500 mt-1">{territory.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => openEdit(territory)}
                    className="p-3 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>

                {/* Assigned Reps */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-700">
                      Assigned Reps ({territory.reps.length})
                    </p>
                    <button
                      onClick={() => setAssigningTerritoryId(
                        assigningTerritoryId === territory.id ? null : territory.id
                      )}
                      className="px-3 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 text-xs min-h-[40px]"
                    >
                      + Assign Rep
                    </button>
                  </div>

                  {assigningTerritoryId === territory.id && (
                    <div className="flex gap-2 mb-3">
                      <select
                        value={selectedRepToAssign}
                        onChange={(e) => setSelectedRepToAssign(e.target.value)}
                        className="flex-1 px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                      >
                        <option value="">Select a rep</option>
                        {availableReps
                          .filter((r) => !territory.reps.some((tr) => tr.id === r.id))
                          .map((r) => (
                            <option key={r.id} value={r.id}>{r.name} ({r.email})</option>
                          ))}
                      </select>
                      <button
                        onClick={() => assignRep(territory.id)}
                        disabled={!selectedRepToAssign}
                        className="px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 text-sm min-h-[48px]"
                      >
                        Assign
                      </button>
                    </div>
                  )}

                  {territory.reps.length === 0 ? (
                    <p className="text-sm text-gray-400">No reps assigned</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {territory.reps.map((rep) => (
                        <div
                          key={rep.id}
                          className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"
                        >
                          <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">
                            {rep.name.split(' ').map((n) => n[0]).join('')}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{rep.name}</p>
                            <p className="text-xs text-gray-500">{rep.email}</p>
                          </div>
                          <button
                            onClick={() => removeRep(territory.id, rep.id)}
                            className="ml-1 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">
                  {editing ? 'Edit Territory' : 'Create Territory'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="East Region"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                    rows={3}
                    placeholder="Coverage area description..."
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
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
