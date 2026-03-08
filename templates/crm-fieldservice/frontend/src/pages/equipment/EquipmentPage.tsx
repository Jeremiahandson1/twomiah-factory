import { useState, useEffect } from 'react';
import { 
  Wrench, Plus, Search, Filter, AlertTriangle, Shield,
  Calendar, Clock, Edit2, History, Loader2, ChevronRight,
  ThermometerSun, Droplets, Zap, Home
} from 'lucide-react';
import api from '../../services/api';

const CATEGORIES = [
  { id: 'HVAC', name: 'HVAC', icon: ThermometerSun, color: 'blue' },
  { id: 'Plumbing', name: 'Plumbing', icon: Droplets, color: 'cyan' },
  { id: 'Electrical', name: 'Electrical', icon: Zap, color: 'yellow' },
  { id: 'Appliance', name: 'Appliance', icon: Home, color: 'gray' },
];

/**
 * Equipment Tracking Page
 */
export default function EquipmentPage() {
  const [equipment, setEquipment] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState(''); // needsMaintenance, warrantyExpiring
  const [showForm, setShowForm] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadData();
  }, [search, category, filter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (filter === 'needsMaintenance') params.set('needsMaintenance', 'true');
      if (filter === 'warrantyExpiring') params.set('warrantyExpiring', 'true');

      const [equipmentRes, statsRes] = await Promise.all([
        api.get(`/api/equipment?${params}`),
        api.get('/api/equipment/stats'),
      ]);
      setEquipment(equipmentRes.data || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load equipment:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipment</h1>
          <p className="text-gray-500">Track customer equipment and service history</p>
        </div>
        <button
          onClick={() => { setSelectedEquipment(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Equipment
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Wrench} label="Total Equipment" value={stats.total} />
          <StatCard 
            icon={Calendar} 
            label="Maintenance Due" 
            value={stats.needsMaintenance}
            color={stats.needsMaintenance > 0 ? 'orange' : 'gray'}
          />
          <StatCard 
            icon={Shield} 
            label="Warranty Expiring" 
            value={stats.warrantyExpiring}
            color={stats.warrantyExpiring > 0 ? 'yellow' : 'gray'}
          />
          <StatCard 
            icon={AlertTriangle} 
            label="Needs Repair" 
            value={stats.needsRepair}
            color={stats.needsRepair > 0 ? 'red' : 'gray'}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search equipment..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Status</option>
          <option value="needsMaintenance">Maintenance Due</option>
          <option value="warrantyExpiring">Warranty Expiring</option>
        </select>
      </div>

      {/* Equipment List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : equipment.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <Wrench className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No equipment found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Equipment</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Install Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {equipment.map(eq => (
                <EquipmentRow
                  key={eq.id}
                  equipment={eq}
                  onEdit={() => { setSelectedEquipment(eq); setShowForm(true); }}
                  onHistory={() => { setSelectedEquipment(eq); setShowHistory(true); }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <EquipmentFormModal
          equipment={selectedEquipment}
          onSave={() => { setShowForm(false); loadData(); }}
          onClose={() => setShowForm(false)}
        />
      )}

      {showHistory && selectedEquipment && (
        <ServiceHistoryModal
          equipment={selectedEquipment}
          onClose={() => setShowHistory(false)}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    orange: 'bg-orange-50 text-orange-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function EquipmentRow({ equipment, onEdit, onHistory }) {
  const CategoryIcon = CATEGORIES.find(c => c.id === equipment.category)?.icon || Wrench;

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
            <CategoryIcon className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{equipment.name}</p>
            <p className="text-sm text-gray-500">{equipment.brand} {equipment.model}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-gray-900">{equipment.contact?.name}</p>
        {equipment.location && (
          <p className="text-sm text-gray-500">{equipment.location}</p>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500">{equipment.category}</td>
      <td className="px-4 py-3">
        {equipment.installDate ? (
          <div>
            <p className="text-gray-900">
              {new Date(equipment.installDate).toLocaleDateString()}
            </p>
            {equipment.age !== null && (
              <p className="text-sm text-gray-500">{equipment.age} years old</p>
            )}
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {equipment.maintenanceDue && (
            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
              Maintenance Due
            </span>
          )}
          {equipment.warrantyActive && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
              Under Warranty
            </span>
          )}
          {equipment.status === 'needs_repair' && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
              Needs Repair
            </span>
          )}
          {!equipment.maintenanceDue && !equipment.warrantyActive && equipment.status === 'active' && (
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
              {equipment.condition}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onHistory}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            title="Service History"
          >
            <History className="w-4 h-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function EquipmentFormModal({ equipment, onSave, onClose }) {
  const [form, setForm] = useState({
    name: equipment?.name || '',
    category: equipment?.category || 'HVAC',
    brand: equipment?.brand || '',
    model: equipment?.model || '',
    serialNumber: equipment?.serialNumber || '',
    location: equipment?.location || '',
    installDate: equipment?.installDate?.split('T')[0] || '',
    warrantyMonths: equipment?.warrantyMonths || 12,
    maintenanceIntervalMonths: equipment?.maintenanceIntervalMonths || 12,
    condition: equipment?.condition || 'good',
    contactId: equipment?.contactId || '',
    notes: equipment?.notes || '',
  });
  const [contacts, setContacts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const data = await api.get('/api/contacts?limit=100');
      setContacts(data.data || []);
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (equipment) {
        await api.put(`/api/equipment/${equipment.id}`, form);
      } else {
        await api.post('/api/equipment', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save equipment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          <h2 className="text-lg font-bold mb-4">
            {equipment ? 'Edit Equipment' : 'Add Equipment'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <select
                  value={form.contactId}
                  onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                >
                  <option value="">Select customer...</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Equipment Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Main AC Unit"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Carrier"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
                <input
                  type="text"
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Basement, Attic"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Install Date</label>
                <input
                  type="date"
                  value={form.installDate}
                  onChange={(e) => setForm({ ...form, installDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warranty (months)</label>
                <input
                  type="number"
                  value={form.warrantyMonths}
                  onChange={(e) => setForm({ ...form, warrantyMonths: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Maintenance Interval (months)</label>
                <input
                  type="number"
                  value={form.maintenanceIntervalMonths}
                  onChange={(e) => setForm({ ...form, maintenanceIntervalMonths: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
                <select
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ServiceHistoryModal({ equipment, onClose, onRefresh }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await api.get(`/api/equipment/${equipment.id}/history`);
      setHistory(data || []);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">Service History</h2>
              <p className="text-gray-500">{equipment.name}</p>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg"
            >
              Add Service Record
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No service history yet
            </div>
          ) : (
            <div className="space-y-4">
              {history.map(record => (
                <div key={record.id} className="p-4 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{record.serviceType}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(record.serviceDate).toLocaleDateString()}
                        {record.technician && ` • ${record.technician.firstName} ${record.technician.lastName}`}
                      </p>
                    </div>
                    {record.cost > 0 && (
                      <span className="text-gray-900 font-medium">${record.cost}</span>
                    )}
                  </div>
                  {record.description && (
                    <p className="mt-2 text-gray-600">{record.description}</p>
                  )}
                  {record.recommendations && (
                    <p className="mt-2 text-sm text-orange-600">
                      Recommendation: {record.recommendations}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <button onClick={onClose} className="w-full mt-4 px-4 py-2 border rounded-lg">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
