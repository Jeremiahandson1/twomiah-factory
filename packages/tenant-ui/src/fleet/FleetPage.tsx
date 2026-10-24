import { useState, useEffect, useRef, createContext, useContext } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { addMapTiles } from '../maps/tiles';
import { useMapCenter, US_VIEW, HOME_ZOOM } from '../maps/center';
import {
  Truck, Plus, MapPin, Navigation, Fuel, Wrench,
  Clock, User, AlertTriangle, Loader2, Calendar,
  TrendingUp, DollarSign, MoreVertical, RefreshCw
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FleetApi, FleetPageProps, FleetToast } from './types';
import { useMayWrite } from '../auth/PermissionsContext';
import { whenTime, whenDateTime, whenDate } from '../time/companyClock'
import { money } from '../money'
import { todayKey } from '../time/day'
import { codeLabel } from '../labels/codes'

// api + the gps flag are injected once at the page root; child components read them via useFleet().
/**
 * `mayWrite` TRAVELS WITH THE API, because the controls are on a sibling component. (T42)
 *
 *   "The server refuses every write correctly, but staff and viewer still see create/edit buttons on
 *    many pages … Some fail silently (Showcase Locations, AI Receptionist, Fleet)."
 *
 * Every write on the fleet router asks `fleet:create` / `fleet:update` / `fleet:delete`, which
 * admin and manager hold and `field` and `viewer` do not — so Add Vehicle, Fuel, Service and Edit
 * were offered to seats whose every click was refused, and on this page refused SILENTLY: the
 * handlers log to the console and the screen says nothing at all.
 *
 * It rides on the context rather than being asked again inside VehicleCard, which is a sibling
 * component — asking it there would work, but one answer for the page cannot disagree with itself.
 */
const FleetCtx = createContext<{ api: FleetApi; gps: boolean; mayWrite: boolean; toast: FleetToast }>({ api: null as any, gps: false, mayWrite: true, toast: { success: () => {}, error: () => {} } });
/** Where a page mounted without toasts still says something: the console, never a browser pop-up. */
const QUIET_TOAST: FleetToast = { success: (m) => console.info(m), error: (m) => console.error(m) };
/** The service types the dialog offers, in the words it offers them. */
const SERVICE_TYPES: Array<[string, string]> = [['oil_change', 'Oil Change'], ['tire', 'Tires'], ['brake', 'Brakes'], ['inspection', 'Inspection'], ['repair', 'Repair'], ['other', 'Other']];
const serviceLabel = (t: string) => SERVICE_TYPES.find(([k]) => k === t)?.[1] || codeLabel(t);
const useFleet = () => useContext(FleetCtx);

interface VehicleLocation {
  lat: number;
  lng: number;
  speed: number;
  timestamp: string;
}

interface VehicleUser {
  firstName: string;
  lastName: string;
}

interface Vehicle {
  id: string;
  name: string;
  type?: string;
  make?: string;
  model?: string;
  year?: string;
  licensePlate?: string;
  vin?: string;
  currentMileage?: number | string;
  status: string;
  currentLocation?: VehicleLocation;
  assignedUser?: VehicleUser;
  nextOilChangeMiles?: number;
}

interface FleetStats {
  totalVehicles: number;
  tripsThisMonth: number;
  milesThisMonth: number;
  fuelCostThisMonth?: number;
  gallonsThisMonth?: number;
}

interface Trip {
  id: string;
  vehicle?: { name?: string };
  driver?: { firstName: string; lastName: string };
  startTime: string;
  endTime?: string;
  distance?: number;
  duration?: number;
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color?: string;
}

interface VehiclesGridProps {
  vehicles: Vehicle[];
  onSelect: (v: Vehicle) => void;
  onEdit: (v: Vehicle) => void;
  onFuel: (v: Vehicle) => void;
  onMaintenance: (v: Vehicle) => void;
  onHistory: (v: Vehicle) => void;
}

interface VehicleCardProps {
  vehicle: Vehicle;
  onEdit: () => void;
  onFuel: () => void;
  onMaintenance: () => void;
  onHistory: () => void;
}

interface FleetMapProps {
  vehicles: Vehicle[];
}

interface VehicleFormModalProps {
  vehicle: Vehicle | null;
  onSave: () => void;
  onClose: () => void;
}

interface FuelEntryModalProps {
  vehicle: Vehicle;
  onSave: () => void;
  onClose: () => void;
}

interface MaintenanceModalProps {
  vehicle: Vehicle;
  onSave: (saved: { type: string }) => void;
  onClose: () => void;
}

/**
 * Fleet Management Page
 */
export default function FleetPage({ api, config, toast: givenToast }: FleetPageProps) {
  const toast = givenToast || QUIET_TOAST;
  const [historyOf, setHistoryOf] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [showFuel, setShowFuel] = useState<boolean>(false);
  const [showMaintenance, setShowMaintenance] = useState<boolean>(false);
  const [tab, setTab] = useState<string>('vehicles'); // vehicles, map, trips
  // `fleet:update` stands for the three: create, update and delete all sit on the same two rungs.
  const mayWrite = useMayWrite('fleet:update');

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
    <FleetCtx.Provider value={{ api, gps: !!config?.gps, mayWrite, toast }}>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Fleet</h1>
          <p className="text-gray-500 dark:text-slate-400">Track vehicles, trips, and maintenance</p>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Refresh"
            onClick={loadData}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          {mayWrite && (
            <button
              onClick={() => { setSelectedVehicle(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
            >
              <Plus className="w-4 h-4" />
              Add Vehicle
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={Truck} label="Vehicles" value={stats.totalVehicles} />
          <StatCard icon={Navigation} label="Trips (30d)" value={stats.tripsThisMonth} color="blue" />
          <StatCard icon={TrendingUp} label="Miles (30d)" value={`${Math.round(stats.milesThisMonth)}`} color="green" />
          {/* Absent for a seat without margin:read (the server takes it out, fleet.ts): no tile, rather than a $0 that reads as
              "no fuel bought". */}
          {stats.fuelCostThisMonth !== undefined && <StatCard icon={Fuel} label="Fuel Cost" value={money(stats.fuelCostThisMonth, 0)} color="purple" />}
          <StatCard icon={DollarSign} label="Gallons" value={stats.gallonsThisMonth?.toFixed(0) || 0} color="cyan" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'vehicles', label: 'Vehicles', icon: Truck },
          { id: 'map', label: 'Live Map', icon: MapPin },
          { id: 'trips', label: 'Trips', icon: Navigation },
        ].map((t: { id: string; label: string; icon: LucideIcon }) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${
              tab === t.id
                ? 'border-orange-500 text-orange-600 dark:text-orange-200'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
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
              onSelect={(v: Vehicle) => { setSelectedVehicle(v); }}
              onEdit={(v: Vehicle) => { setSelectedVehicle(v); setShowForm(true); }}
              onFuel={(v: Vehicle) => { setSelectedVehicle(v); setShowFuel(true); }}
              onMaintenance={(v: Vehicle) => { setSelectedVehicle(v); setShowMaintenance(true); }}
              onHistory={(v: Vehicle) => setHistoryOf(v)}
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
          onSave={(saved) => { setShowMaintenance(false); toast.success(`${serviceLabel(saved.type)} saved for ${selectedVehicle.name}`); loadData(); }}
          onClose={() => setShowMaintenance(false)}
        />
      )}

      {historyOf && <VehicleHistoryModal vehicle={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
    </FleetCtx.Provider>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }: StatCardProps) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
    blue: 'bg-blue-50 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
    green: 'bg-green-50 text-green-700 dark:text-green-300 dark:bg-green-950/40',
    purple: 'bg-purple-50 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
    cyan: 'bg-cyan-50 text-cyan-700 dark:text-cyan-300 dark:bg-cyan-950/40',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

function VehiclesGrid({ vehicles, onSelect, onEdit, onFuel, onMaintenance, onHistory }: VehiclesGridProps) {
  if (vehicles.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900">
        <Truck className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500 dark:text-slate-400">No vehicles yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {vehicles.map((vehicle: Vehicle) => (
        <VehicleCard
          key={vehicle.id}
          vehicle={vehicle}
          onEdit={() => onEdit(vehicle)}
          onFuel={() => onFuel(vehicle)}
          onMaintenance={() => onMaintenance(vehicle)}
          onHistory={() => onHistory(vehicle)}
        />
      ))}
    </div>
  );
}

function VehicleCard({ vehicle, onEdit, onFuel, onMaintenance, onHistory }: VehicleCardProps) {
  // The page's answer, not a second one. (T42 — see the note beside FleetCtx.)
  const { mayWrite } = useFleet();
  const hasAlert = vehicle.status === 'maintenance' ||
    (vehicle.nextOilChangeMiles && typeof vehicle.currentMileage === 'number' && vehicle.currentMileage >= vehicle.nextOilChangeMiles - 500);

  return (
    <div className="bg-white rounded-xl border p-4 hover:shadow-lg transition-shadow dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
            hasAlert ? 'bg-red-100 dark:bg-red-950/40 dark:text-slate-100' : 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'
          }`}>
            <Truck className={`w-6 h-6 ${hasAlert ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-slate-300'}`} />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-slate-100">{vehicle.name}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          </div>
        </div>
        <span className={`px-2 py-1 text-xs rounded-full ${
          vehicle.status === 'active' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
          vehicle.status === 'maintenance' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
          'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'
        } dark:text-slate-200`}>
          {codeLabel(vehicle.status)}
        </span>
      </div>

      {/* Location */}
      {vehicle.currentLocation && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
          <MapPin className="w-4 h-4" />
          <span>Last seen {whenTime(vehicle.currentLocation.timestamp)}</span>
        </div>
      )}

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-500 dark:text-slate-400">Mileage</p>
          <p className="font-medium">{typeof vehicle.currentMileage === 'number' ? vehicle.currentMileage.toLocaleString() : vehicle.currentMileage} mi</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-slate-400">Assigned To</p>
          <p className="font-medium">
            {vehicle.assignedUser ? `${vehicle.assignedUser.firstName} ${vehicle.assignedUser.lastName}` : '-'}
          </p>
        </div>
      </div>

      {/* Alerts */}
      {hasAlert && (
        <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300 dark:bg-amber-950/40">
          <AlertTriangle className="w-4 h-4" />
          <span>Maintenance due soon</span>
        </div>
      )}

      {/* Its service and fuel record, open to every seat that may open the page (costs only to seats that see them). */}
      <button type="button" onClick={onHistory} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">
        <Clock className="w-4 h-4" />Service history
      </button>

      {/* Actions — a seat that cannot log fuel, book a service or edit the vehicle is not offered
          any of them. The card still shows the vehicle, its mileage, who has it and its alerts,
          which is what a driver opens this page for. (T42) */}
      {mayWrite && (
      <div className="mt-4 pt-4 border-t flex items-center gap-2">
        <button
          onClick={onFuel}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400"
        >
          <Fuel className="w-4 h-4" />
          Fuel
        </button>
        <button
          onClick={onMaintenance}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400"
        >
          <Wrench className="w-4 h-4" />
          Service
        </button>
        <button aria-label="More actions"
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
      )}
    </div>
  );
}

function FleetMap({ vehicles }: FleetMapProps) {
  const { gps, api } = useFleet();
  // With no vehicle reporting, the map opens on the business's town, not the whole country (../maps/center).
  const home = useMapCenter((p: string) => api.get(p));
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  const located = vehicles.filter(
    (v: Vehicle) => v.currentLocation && Number.isFinite(v.currentLocation.lat) && Number.isFinite(v.currentLocation.lng)
  );

  // Init the Leaflet map once (gps only). Tiles: Google's (../maps/tiles) — OpenStreetMap's servers refuse app traffic.
  useEffect(() => {
    if (!gps || !mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView(US_VIEW.center, US_VIEW.zoom); // until the business's centre is known
    addMapTiles(L, map, 'roadmap');
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, [gps]);

  // Re-draw markers whenever positions change (30s refresh upstream).
  useEffect(() => {
    if (!gps) return;
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    setTimeout(() => map.invalidateSize(), 0);
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const v of located) {
      const { lat, lng } = v.currentLocation!;
      const seen = v.currentLocation!.timestamp ? whenDateTime(v.currentLocation!.timestamp) : 'unknown';
      L.circleMarker([lat, lng], { radius: 8, color: '#ea580c', fillColor: '#f97316', fillOpacity: 0.9, weight: 2 })
        .bindPopup(`<strong>${v.name}</strong><br/>${lat.toFixed(5)}, ${lng.toFixed(5)}<br/><span style="color:#64748b">Last seen: ${seen}</span>`)
        .addTo(layer);
      pts.push([lat, lng]);
    }
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
    else if (home) map.setView([home.lat, home.lng], HOME_ZOOM);
  }, [vehicles, gps, home]);

  // Contractor crm has no live GPS feed — keep the original placeholder.
  if (!gps) {
    return (
      <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900">
        <div className="p-4 border-b">
          <h3 className="font-medium">Live Vehicle Locations</h3>
        </div>
        <div className="h-96 bg-gray-100 flex items-center justify-center dark:bg-slate-800">
          <div className="text-center text-gray-500 dark:text-slate-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Map integration requires Google Maps API key</p>
            <p className="text-sm mt-2">{vehicles.filter((v: Vehicle) => v.currentLocation).length} vehicles with locations</p>
          </div>
        </div>
        <div className="divide-y max-h-64 overflow-y-auto">
          {vehicles.filter((v: Vehicle) => v.currentLocation).map((v: Vehicle) => (
            <div key={v.id} className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Truck className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="font-medium">{v.name}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {v.currentLocation!.lat.toFixed(4)}, {v.currentLocation!.lng.toFixed(4)}
                  </p>
                </div>
              </div>
              {v.currentLocation!.speed > 0 && (
                <span className="text-sm text-green-700 dark:text-green-300">{Math.round(v.currentLocation!.speed)} mph</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-medium">Live Vehicle Locations</h3>
        <span className="text-sm text-gray-500 dark:text-slate-400">{located.length} of {vehicles.length} reporting</span>
      </div>
      <div ref={mapEl} className="h-96 w-full bg-gray-100 dark:bg-slate-800" />
      {located.length === 0 && (
        <div className="p-4 text-center text-sm text-gray-500 dark:text-slate-400">
          <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No vehicles are reporting a location yet. Assign a driver to each vehicle and have them share location from the mobile app.
        </div>
      )}
      <div className="divide-y max-h-64 overflow-y-auto">
        {located.map((v: Vehicle) => (
          <div key={v.id} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="w-5 h-5 text-gray-400" />
              <div>
                <p className="font-medium">{v.name}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {v.currentLocation!.lat.toFixed(4)}, {v.currentLocation!.lng.toFixed(4)}
                  {v.currentLocation!.timestamp && (
                    <span className="ml-2 opacity-70">· {whenTime(v.currentLocation!.timestamp)}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TripsTab() {
  const { api } = useFleet();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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
    <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-slate-900">
          <tr>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Vehicle</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Driver</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Start</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">End</th>
            <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Distance</th>
            <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {trips.map((trip: Trip) => (
            <tr key={trip.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
              <td className="px-4 py-3 font-medium">{trip.vehicle?.name}</td>
              <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                {trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : '-'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                {whenDateTime(trip.startTime)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                {trip.endTime ? whenDateTime(trip.endTime) : 'In Progress'}
              </td>
              <td className="px-4 py-3 text-right">{trip.distance?.toFixed(1) || '-'} mi</td>
              <td className="px-4 py-3 text-right">{trip.duration || '-'} min</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trips.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">No trips recorded</div>
      )}
    </div>
  );
}

function VehicleFormModal({ vehicle, onSave, onClose }: VehicleFormModalProps) {
  const { api, toast } = useFleet();
  const [form, setForm] = useState<{
    name: string;
    type: string;
    make: string;
    model: string;
    year: string;
    licensePlate: string;
    vin: string;
    currentMileage: string | number;
  }>({
    name: vehicle?.name || '',
    type: vehicle?.type || 'truck',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    year: vehicle?.year || '',
    licensePlate: vehicle?.licensePlate || '',
    vin: vehicle?.vin || '',
    currentMileage: vehicle?.currentMileage || '',
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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
      toast.error(errText(error, 'Failed to save vehicle'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="fleet-dialog-1-title">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 id="fleet-dialog-1-title" className="text-lg font-bold mb-4">{vehicle ? 'Edit Vehicle' : 'Add Vehicle'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name</label>
                <input type="text" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Truck 1" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Type</label>
                <select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="truck">Truck</option>
                  <option value="van">Van</option>
                  <option value="car">Car</option>
                  <option value="trailer">Trailer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Year</label>
                <input type="number" value={form.year} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, year: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Make</label>
                <input type="text" value={form.make} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, make: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Ford" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Model</label>
                <input type="text" value={form.model} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., F-150" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">License Plate</label>
                <input type="text" value={form.licensePlate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, licensePlate: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Current Mileage</label>
                <input type="number" value={form.currentMileage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, currentMileage: e.target.value }))}
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

function FuelEntryModal({ vehicle, onSave, onClose }: FuelEntryModalProps) {
  const { api, toast } = useFleet();
  const [form, setForm] = useState<{
    date: string;
    gallons: string;
    pricePerGallon: string;
    mileage: string | number;
    station: string;
  }>({
    date: todayKey(),
    gallons: '',
    pricePerGallon: '',
    mileage: vehicle.currentMileage || '',
    station: '',
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/fleet/vehicles/${vehicle.id}/fuel`, form);
      onSave();
    } catch (error) {
      toast.error(errText(error, 'Failed to save fuel entry'));
    } finally {
      setSaving(false);
    }
  };

  const totalCost = form.gallons && form.pricePerGallon
    ? (Number(form.gallons) * Number(form.pricePerGallon)).toFixed(2)
    : '0.00';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="fleet-dialog-2-title">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 id="fleet-dialog-2-title" className="text-lg font-bold mb-4">Add Fuel Entry - {vehicle.name}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date</label>
              <input type="date" value={form.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Gallons</label>
                <input type="number" step="0.01" value={form.gallons} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, gallons: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Price/Gallon</label>
                <input type="number" step="0.01" value={form.pricePerGallon} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, pricePerGallon: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-center dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400">Total Cost</p>
              <p className="text-2xl font-bold">{money(totalCost)}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Current Mileage</label>
              <input type="number" value={form.mileage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, mileage: e.target.value }))}
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

function MaintenanceModal({ vehicle, onSave, onClose }: MaintenanceModalProps) {
  const { api, toast } = useFleet();
  const [form, setForm] = useState<{
    date: string;
    type: string;
    description: string;
    mileage: string | number;
    cost: string;
    vendor: string;
  }>({
    date: todayKey(),
    type: 'oil_change',
    description: '',
    mileage: vehicle.currentMileage || '',
    cost: '',
    vendor: '',
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/fleet/vehicles/${vehicle.id}/maintenance`, form);
      onSave({ type: form.type });
    } catch (error) {
      toast.error(errText(error, 'Failed to save the service'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="fleet-dialog-3-title">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 id="fleet-dialog-3-title" className="text-lg font-bold mb-4">Add Service - {vehicle.name}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date</label>
                <input type="date" value={form.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Type</label>
                <select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg">
                  {SERVICE_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Mileage</label>
                <input type="number" value={form.mileage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, mileage: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Cost</label>
                <input type="number" step="0.01" value={form.cost} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, cost: e.target.value }))}
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

/** What a refused or failed save says: the server's own words when it gave some. */
function errText(error: unknown, fallback: string): string {
  const m = (error as any)?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
}

/**
 * A vehicle's service and fuel record, newest first (GET /api/fleet/vehicles/:id: the last ten of each). A service was
 * saved and nothing on the page showed it, so nobody could tell it had been (landscaping live retest, 2026-10-24). Costs
 * show only where the server sent them (fleet:update's seats; the route takes them off for the rest).
 */
function VehicleHistoryModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { api } = useFleet();
  const [data, setData] = useState<{ maintenanceLogs?: any[]; fuelEntries?: any[] } | null>(null);
  const [error, setError] = useState<string>('');
  useEffect(() => {
    api.get(`/api/fleet/vehicles/${vehicle.id}`).then((r: any) => setData(r || {})).catch((e: unknown) => setError(errText(e, 'Could not load the history')));
  }, [vehicle.id]);
  const services = data?.maintenanceLogs || [];
  const fuel = data?.fuelEntries || [];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="fleet-history-title">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 id="fleet-history-title" className="text-lg font-bold mb-4 text-gray-900 dark:text-slate-100">Service history - {vehicle.name}</h2>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-3">{error}</p>}
          {!data && !error && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}
          {data && (
            <div className="space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-1"><Wrench className="w-4 h-4" />Services</h3>
                {services.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No services recorded yet.</p> : (
                  <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                    {services.map((m: any) => (
                      <li key={m.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                        <div><p className="font-medium text-gray-900 dark:text-slate-100">{serviceLabel(m.type)}</p>{m.description && <p className="text-gray-500 dark:text-slate-400">{m.description}</p>}<p className="text-xs text-gray-500 dark:text-slate-400">{whenDate(m.performedAt)}{m.mileage != null ? ` · ${Number(m.mileage).toLocaleString()} mi` : ''}</p></div>
                        {m.cost != null && <span className="font-medium text-gray-900 dark:text-slate-100">{money(m.cost)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-1"><Fuel className="w-4 h-4" />Fuel</h3>
                {fuel.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No fuel entries yet.</p> : (
                  <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                    {fuel.map((f: any) => (
                      <li key={f.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                        <div><p className="text-gray-900 dark:text-slate-100">{Number(f.gallons)} gal</p><p className="text-xs text-gray-500 dark:text-slate-400">{whenDate(f.createdAt)}{f.mileage != null ? ` · ${Number(f.mileage).toLocaleString()} mi` : ''}</p></div>
                        {f.totalCost != null && <span className="font-medium text-gray-900 dark:text-slate-100">{money(f.totalCost)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
          <div className="flex justify-end pt-4"><button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg dark:border-slate-700 dark:text-slate-200">Close</button></div>
        </div>
      </div>
    </div>
  );
}
