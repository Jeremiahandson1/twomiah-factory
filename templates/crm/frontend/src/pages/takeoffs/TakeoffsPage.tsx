import { useState, useEffect } from 'react';
import { 
  Calculator, Plus, Ruler, Package, Trash2,
  FileText, DollarSign, Loader2, ChevronRight,
  Download, Layers, Square, ArrowRight
} from 'lucide-react';
import api from '../../services/api';

const MEASUREMENT_LABELS = {
  area: 'Square Feet',
  linear: 'Linear Feet',
  count: 'Count',
  volume: 'Cubic Feet',
};

/**
 * Material Takeoff Page
 */
export default function TakeoffsPage({ projectId }) {
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewSheet, setShowNewSheet] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sheetsRes, assembliesRes] = await Promise.all([
        api.get(`/api/takeoffs/project/${projectId}`),
        api.get('/api/takeoffs/assemblies'),
      ]);
      setSheets(sheetsRes || []);
      setAssemblies(assembliesRes || []);
      
      // Auto-select first sheet
      if (sheetsRes?.length > 0 && !selectedSheet) {
        loadSheet(sheetsRes[0].id);
      }
    } catch (error) {
      console.error('Failed to load takeoffs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSheet = async (sheetId) => {
    try {
      const sheet = await api.get(`/api/takeoffs/sheets/${sheetId}`);
      setSelectedSheet(sheet);
    } catch (error) {
      console.error('Failed to load sheet:', error);
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar - Sheets List */}
      <div className="w-64 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-medium text-gray-900">Takeoff Sheets</h3>
          <button
            onClick={() => setShowNewSheet(true)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            New Sheet
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sheets.map(sheet => (
            <button
              key={sheet.id}
              onClick={() => loadSheet(sheet.id)}
              className={`w-full px-4 py-3 text-left hover:bg-gray-100 border-b ${
                selectedSheet?.id === sheet.id ? 'bg-orange-50 border-l-4 border-l-orange-500' : ''
              }`}
            >
              <p className="font-medium text-sm text-gray-900">{sheet.name}</p>
              <p className="text-xs text-gray-500">{sheet._count?.items || 0} items</p>
            </button>
          ))}
          {sheets.length === 0 && !loading && (
            <div className="p-4 text-center text-gray-500 text-sm">
              No takeoff sheets yet
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : selectedSheet ? (
          <>
            {/* Sheet Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedSheet.name}</h2>
                {selectedSheet.planReference && (
                  <p className="text-sm text-gray-500">Plan: {selectedSheet.planReference}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddItem(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
                >
                  <Ruler className="w-4 h-4" />
                  Add Measurement
                </button>
              </div>
            </div>

            {/* Items Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedSheet.items?.length > 0 ? (
                <div className="space-y-4">
                  {selectedSheet.items.map(item => (
                    <TakeoffItemCard
                      key={item.id}
                      item={item}
                      onUpdate={() => loadSheet(selectedSheet.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calculator className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-500">No measurements yet</p>
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="mt-4 text-orange-600 hover:text-orange-700"
                  >
                    Add your first measurement
                  </button>
                </div>
              )}
            </div>

            {/* Totals Footer */}
            {selectedSheet.items?.length > 0 && (
              <TotalsFooter sheetId={selectedSheet.id} />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select or create a takeoff sheet
          </div>
        )}
      </div>

      {/* New Sheet Modal */}
      {showNewSheet && (
        <NewSheetModal
          projectId={projectId}
          onSave={(sheet) => {
            setShowNewSheet(false);
            loadData();
            loadSheet(sheet.id);
          }}
          onClose={() => setShowNewSheet(false)}
        />
      )}

      {/* Add Item Modal */}
      {showAddItem && selectedSheet && (
        <AddItemModal
          sheetId={selectedSheet.id}
          assemblies={assemblies}
          onSave={() => {
            setShowAddItem(false);
            loadSheet(selectedSheet.id);
          }}
          onClose={() => setShowAddItem(false)}
        />
      )}
    </div>
  );
}

function TakeoffItemCard({ item, onUpdate }) {
  const [expanded, setExpanded] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this measurement?')) return;
    try {
      await api.delete(`/api/takeoffs/items/${item.id}`);
      onUpdate();
    } catch (error) {
      alert('Failed to delete');
    }
  };

  const totalCost = item.calculatedMaterials?.reduce(
    (sum, m) => sum + Number(m.totalCost), 0
  ) || 0;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{item.name}</p>
            <p className="text-sm text-gray-500">
              {item.location && `${item.location} • `}
              {item.assembly?.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900">
              {Number(item.measurementValue).toLocaleString()} {MEASUREMENT_LABELS[item.measurementType]?.split(' ')[0]}
            </p>
            <p className="text-sm text-gray-500">${totalCost.toFixed(2)} materials</p>
          </div>
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t">
          {/* Measurements */}
          <div className="p-4 bg-gray-50 grid grid-cols-4 gap-4 text-sm">
            {item.measurementType === 'area' && (
              <>
                <div>
                  <span className="text-gray-500">Length:</span>
                  <span className="ml-2 font-medium">{Number(item.length)} ft</span>
                </div>
                <div>
                  <span className="text-gray-500">Width:</span>
                  <span className="ml-2 font-medium">{Number(item.width)} ft</span>
                </div>
              </>
            )}
            {item.measurementType === 'linear' && (
              <div>
                <span className="text-gray-500">Length:</span>
                <span className="ml-2 font-medium">{Number(item.length)} ft</span>
              </div>
            )}
            {item.measurementType === 'count' && (
              <div>
                <span className="text-gray-500">Quantity:</span>
                <span className="ml-2 font-medium">{item.quantity}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Waste Factor:</span>
              <span className="ml-2 font-medium">{Number(item.wasteFactor || item.assembly?.wasteFactor || 0)}%</span>
            </div>
          </div>

          {/* Materials List */}
          <div className="p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Calculated Materials</p>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2">Material</th>
                  <th className="text-right px-3 py-2">Base Qty</th>
                  <th className="text-right px-3 py-2">Waste</th>
                  <th className="text-right px-3 py-2">Total Qty</th>
                  <th className="text-right px-3 py-2">Unit Cost</th>
                  <th className="text-right px-3 py-2">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {item.calculatedMaterials?.map((mat, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{mat.materialName}</td>
                    <td className="px-3 py-2 text-right">{Number(mat.baseQuantity).toFixed(2)} {mat.unit}</td>
                    <td className="px-3 py-2 text-right text-orange-600">+{Number(mat.wasteQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{Number(mat.totalQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">${Number(mat.unitCost).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">${Number(mat.totalCost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="p-4 border-t flex justify-end">
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TotalsFooter({ sheetId }) {
  const [totals, setTotals] = useState(null);

  useEffect(() => {
    loadTotals();
  }, [sheetId]);

  const loadTotals = async () => {
    try {
      const data = await api.get(`/api/takeoffs/sheets/${sheetId}/totals`);
      setTotals(data);
    } catch (error) {
      console.error('Failed to load totals:', error);
    }
  };

  if (!totals) return null;

  return (
    <div className="border-t bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-sm text-gray-500">Materials</p>
            <p className="text-lg font-bold">{totals.totals.materialCount}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Cost</p>
            <p className="text-lg font-bold text-green-600">${totals.totals.totalCost.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Price</p>
            <p className="text-lg font-bold">${totals.totals.totalPrice.toFixed(2)}</p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-white">
          <Download className="w-4 h-4" />
          Export to PO
        </button>
      </div>
    </div>
  );
}

function NewSheetModal({ projectId, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    planReference: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const sheet = await api.post(`/api/takeoffs/project/${projectId}`, form);
      onSave(sheet);
    } catch (error) {
      alert('Failed to create sheet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">New Takeoff Sheet</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., First Floor Framing"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan Reference</label>
              <input
                type="text"
                value={form.planReference}
                onChange={(e) => setForm({ ...form, planReference: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Sheet A-101"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Creating...' : 'Create Sheet'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AddItemModal({ sheetId, assemblies, onSave, onClose }) {
  const [form, setForm] = useState({
    assemblyId: '',
    name: '',
    location: '',
    length: '',
    width: '',
    height: '',
    quantity: 1,
  });
  const [saving, setSaving] = useState(false);

  const selectedAssembly = assemblies.find(a => a.id === form.assemblyId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/takeoffs/sheets/${sheetId}/items`, {
        ...form,
        name: form.name || selectedAssembly?.name,
      });
      onSave();
    } catch (error) {
      alert('Failed to add measurement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Measurement</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assembly Type</label>
              <select
                value={form.assemblyId}
                onChange={(e) => setForm({ ...form, assemblyId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select assembly...</option>
                {Object.entries(
                  assemblies.reduce((acc, a) => {
                    if (!acc[a.category]) acc[a.category] = [];
                    acc[a.category].push(a);
                    return acc;
                  }, {})
                ).map(([category, items]) => (
                  <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
                    {items.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name (Optional)</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder={selectedAssembly?.name || 'Same as assembly'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Living Room"
                />
              </div>
            </div>

            {selectedAssembly && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700">
                  Measurement type: <strong>{MEASUREMENT_LABELS[selectedAssembly.measurementType]}</strong>
                </p>
              </div>
            )}

            {/* Measurement Fields */}
            {selectedAssembly?.measurementType === 'area' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Length (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.length}
                    onChange={(e) => setForm({ ...form, length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Width (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.width}
                    onChange={(e) => setForm({ ...form, width: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
              </div>
            )}

            {selectedAssembly?.measurementType === 'linear' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Length (ft)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.length}
                  onChange={(e) => setForm({ ...form, length: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
            )}

            {selectedAssembly?.measurementType === 'count' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  min="1"
                  required
                />
              </div>
            )}

            {selectedAssembly?.measurementType === 'volume' && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Length (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.length}
                    onChange={(e) => setForm({ ...form, length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Width (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.width}
                    onChange={(e) => setForm({ ...form, width: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Height (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.height}
                    onChange={(e) => setForm({ ...form, height: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.assemblyId}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Measurement'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
