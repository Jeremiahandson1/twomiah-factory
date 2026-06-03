import { useState, useEffect } from 'react';
import { 
  Truck, Plus, MapPin, Navigation, Fuel, Wrench,
  Clock, User, AlertTriangle, Loader2, Calendar,
  TrendingUp, DollarSign, MoreVertical, RefreshCw
} from 'lucide-react';
import api from '../../services/api';

/**
 * Fleet Management Page
 */
export default function FleetPage() {
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showFuel, setShowFuel] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [tab, setTab] = useState('vehicles'); // vehicles, map, trips

  useEffect(() => {
    loadData();
    // Refresh locations every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [vehiclesRes, statsRes] = await Promise.all([
        api.get('/api/fleet/vehicles'),
        api.get('/api/fleet/stats'),
      ]);
      setVehicles(vehiclesRes || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load fleet:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fleet</h1>
          <p className="text-gray-500">Track vehicles, trips, and maintenance</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => { setSelectedVehicle(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            Add Vehicle
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <StatCard icon={Truck} label="Vehicles" value={stats.totalVehicles} />
          <StatCard icon={Navigation} label="Trips (30d)" value={stats.tripsThisMonth} color="blue" />
          <StatCard icon={TrendingUp} label="Miles (30d)" value={`${Math.round(stats.milesThisMonth)}`} color="green" />
          <StatCard icon={Fuel} label="Fuel Cost" value={`$${stats.fuelCostThisMonth?.toFixed(0) || 0}`} color="purple" />
          <StatCard icon={DollarSign} label="Gallons" value={stats.gallonsThisMonth?.toFixed(0) || 0} color="cyan" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'vehicles', label: 'Vehicles', icon: Truck },
          { id: 'map', label: 'Live Map', icon: MapPin },
          { id: 'trips', label: 'Trips', icon: Navigation },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${
              tab === t.id
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {tab === 'vehicles' && (
            <VehiclesGrid
              vehicles={vehicles}
              onSelect={(v) => { setSelectedVehicle(v); }}
              onEdit={(v) => { setSelectedVehicle(v); setShowForm(true); }}
              onFuel={(v) => { setSelectedVehicle(v); setShowFuel(true); }}
              onMaintenance={(v) => { setSelectedVehicle(v); setShowMaintenance(true); }}
            />
          )}

          {tab === 'map' && (
            <FleetMap vehicles={vehicles} />
          )}

          {tab === 'trips' && (
            <TripsTab />
          )}
        </>
      )}

      {/* Modals */}
      {showForm && (
        <VehicleFormModal
          vehicle={selectedVehicle}
          onSave={() => { setShowForm(false); loadData(); }}
          onClose={() => setShowForm(false)}
        />
      )}

      {showFuel && selectedVehicle && (
        <FuelEntryModal
          vehicle={selectedVehicle}
          onSave={() => { setShowFuel(false); loadData(); }}
          onClose={() => setShowFuel(false)}
        />
      )}

      {showMaintenance && selectedVehicle && (
        <MaintenanceModal
          vehicle={selectedVehicle}
          onSave={() => { setShowMaintenance(false); loadData(); }}
          onClose={() => setShowMaintenance(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function VehiclesGrid({ vehicles, onSelect, onEdit, onFuel, onMaintenance }) {
  if (vehicles.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl">
        <Truck className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500">No vehicles yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {vehicles.map(vehicle => (
        <VehicleCard
          key={vehicle.id}
          vehicle={vehicle}
          onEdit={() => onEdit(vehicle)}
          onFuel={() => onFuel(vehicle)}
          onMaintenance={() => onMaintenance(vehicle)}
        />
      ))}
    </div>
  );
}

function VehicleCard({ vehicle, onEdit, onFuel, onMaintenance }) {
  const hasAlert = vehicle.status === 'maintenance' || 
    (vehicle.nextOilChangeMiles && vehicle.currentMileage >= vehicle.nextOilChangeMiles - 500);

  return (
    <div className="bg-white rounded-xl border p-4 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
            hasAlert ? 'bg-red-100' : 'bg-gray-100'
          }`}>
            <Truck className={`w-6 h-6 ${hasAlert ? 'text-red-600' : 'text-gray-600'}`} />
          </div>
          <div>
            <p className="font-medium text-gray-900">{vehicle.name}</p>
            <p className="text-sm text-gray-500">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          </div>
        </div>
        <span className={`px-2 py-1 text-xs rounded-full ${
          vehicle.status === 'active' ? 'bg-green-100 text-green-700' :
          vehicle.status === 'maintenance' ? 'bg-yellow-100 text-yellow-700' :
          'bg-gray-100 text-gray-700'
        }`}>
          {vehicle.status}
        </span>
      </div>

      {/* Location */}
      {vehicle.currentLocation && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <MapPin className="w-4 h-4" />
          <span>Last seen {new Date(vehicle.currentLocation.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-500">Mileage</p>
          <p className="font-medium">{vehicle.currentMileage?.toLocaleString()} mi</p>
        </div>
        <div>
          <p className="text-gray-500">Assigned To</p>
          <p className="font-medium">
            {vehicle.assignedUser ? `${vehicle.assignedUser.firstName} ${vehicle.assignedUser.lastName}` : '-'}
          </p>
        </div>
      </div>

      {/* Alerts */}
      {hasAlert && (
        <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-2 text-sm text-orange-700">
          <AlertTriangle className="w-4 h-4" />
          <span>Maintenance due soon</span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 pt-4 border-t flex items-center gap-2">
        <button
          onClick={onFuel}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
        >
          <Fuel className="w-4 h-4" />
          Fuel
        </button>
        <button
          onClick={onMaintenance}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
        >
          <Wrench className="w-4 h-4" />
          Service
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function FleetMap({ vehicles }) {
  // Simple placeholder - in production would use Google Maps or Mapbox
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-medium">Live Vehicle Locations</h3>
      </div>
      <div className="h-96 bg-gray-100 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Map integration requires Google Maps API key</p>
          <p className="text-sm mt-2">{vehicles.filter(v => v.currentLocation).length} vehicles with locations</p>
        </div>
      </div>
      {/* Vehicle list with locations */}
      <div className="divide-y max-h-64 overflow-y-auto">
        {vehicles.filter(v => v.currentLocation).map(v => (
          <div key={v.id} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="w-5 h-5 text-gray-400" />
              <div>
                <p className="font-medium">{v.name}</p>
                <p className="text-sm text-gray-500">
                  {v.currentLocation.lat.toFixed(4)}, {v.currentLocation.lng.toFixed(4)}
                </p>
              </div>
            </div>
            {v.currentLocation.speed > 0 && (
              <span className="text-sm text-green-600">{Math.round(v.currentLocation.speed)} mph</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TripsTab() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrips();
  }, []);

  const loadTrips = async () => {
    try {
      const data = await api.get('/api/fleet/trips');
      setTrips(data.data || []);
    } catch (error) {
      console.error('Failed to load trips:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Vehicle</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Driver</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Start</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">End</th>
            <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Distance</th>
            <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {trips.map(trip => (
            <tr key={trip.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">{trip.vehicle?.name}</td>
              <td className="px-4 py-3 text-gray-500">
                {trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : '-'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {new Date(trip.startTime).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {trip.endTime ? new Date(trip.endTime).toLocaleString() : 'In Progress'}
              </td>
              <td className="px-4 py-3 text-right">{trip.distance?.toFixed(1) || '-'} mi</td>
              <td className="px-4 py-3 text-right">{trip.duration || '-'} min</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trips.length === 0 && (
        <div className="p-8 text-center text-gray-500">No trips recorded</div>
      )}
    </div>
  );
}

function VehicleFormModal({ vehicle, onSave, onClose }) {
  const [form, setForm] = useState({
    name: vehicle?.name || '',
    type: vehicle?.type || 'truck',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    year: vehicle?.year || '',
    licensePlate: vehicle?.licensePlate || '',
    vin: vehicle?.vin || '',
    currentMileage: vehicle?.currentMileage || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (vehicle) {
        await api.put(`/api/fleet/vehicles/${vehicle.id}`, form);
      } else {
        await api.post('/api/fleet/vehicles', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save vehicle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">{vehicle ? 'Edit Vehicle' : 'Add Vehicle'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Truck 1" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="truck">Truck</option>
                  <option value="van">Van</option>
                  <option value="car">Car</option>
                  <option value="trailer">Trailer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                <input type="text" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Ford" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., F-150" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Plate</label>
                <input type="text" value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Mileage</label>
                <input type="number" value={form.currentMileage} onChange={(e) => setForm({ ...form, currentMileage: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
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

function FuelEntryModal({ vehicle, onSave, onClose }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    gallons: '',
    pricePerGallon: '',
    mileage: vehicle.currentMileage || '',
    station: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/fleet/vehicles/${vehicle.id}/fuel`, form);
      onSave();
    } catch (error) {
      alert('Failed to save fuel entry');
    } finally {
      setSaving(false);
    }
  };

  const totalCost = form.gallons && form.pricePerGallon 
    ? (form.gallons * form.pricePerGallon).toFixed(2) 
    : '0.00';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Fuel Entry - {vehicle.name}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gallons</label>
                <input type="number" step="0.01" value={form.gallons} onChange={(e) => setForm({ ...form, gallons: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price/Gallon</label>
                <input type="number" step="0.01" value={form.pricePerGallon} onChange={(e) => setForm({ ...form, pricePerGallon: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-center">
              <p className="text-sm text-gray-500">Total Cost</p>
              <p className="text-2xl font-bold">${totalCost}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Mileage</label>
              <input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
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

function MaintenanceModal({ vehicle, onSave, onClose }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'oil_change',
    description: '',
    mileage: vehicle.currentMileage || '',
    cost: '',
    vendor: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/fleet/vehicles/${vehicle.id}/maintenance`, form);
      onSave();
    } catch (error) {
      alert('Failed to save maintenance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Service - {vehicle.name}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="oil_change">Oil Change</option>
                  <option value="tire">Tires</option>
                  <option value="brake">Brakes</option>
                  <option value="inspection">Inspection</option>
                  <option value="repair">Repair</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mileage</label>
                <input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost</label>
                <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
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
