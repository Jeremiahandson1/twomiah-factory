/**
 * Locations Page — Fleet tier
 * Multi-branch operations: each location has its own code, service area,
 * phone, and manager. Techs and jobs can be assigned per location.
 */
import { useState, useEffect } from 'react';
import { MapPin, Plus, Loader2 } from 'lucide-react';
import api from '../services/api';

export default function LocationsPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', city: '', state: '', zip: '', phone: '', email: '', timezone: 'America/Chicago', serviceAreaRadiusMiles: 25, notes: '' });

  useEffect(() => { load(); }, []);
  const load = async () => { try { const { data } = await api.get('/api/locations'); setLocations(data || []); } catch (e) { console.error(e); } finally { setLoading(false); } };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/locations', { ...form, serviceAreaRadiusMiles: Number(form.serviceAreaRadiusMiles) });
    setShowCreate(false);
    setForm({ name: '', code: '', address: '', city: '', state: '', zip: '', phone: '', email: '', timezone: 'America/Chicago', serviceAreaRadiusMiles: 25, notes: '' });
    load();
  };

  const deactivate = async (id: string) => { if (confirm('Deactivate this location?')) { await api.delete(`/api/locations/${id}`); load(); } };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="w-6 h-6 text-sky-500" />Locations</h1><p className="text-sm text-gray-500 mt-1">Multi-branch dispatch — assign techs and jobs per location</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Location</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {locations.length === 0 ? <div className="col-span-full bg-white rounded-lg border p-12 text-center text-gray-400">No locations yet. Add your first branch to enable multi-location dispatch.</div> :
          locations.map((l) => (
            <div key={l.id} className={`bg-white rounded-lg border p-5 ${!l.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-xs font-mono text-sky-600 mb-1">{l.code}</div>
                  <h3 className="font-bold text-lg">{l.name}</h3>
                </div>
                {!l.isActive && <span className="text-xs text-gray-400">Inactive</span>}
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                {l.address && <div>{l.address}</div>}
                {(l.city || l.state) && <div>{l.city}{l.city && l.state ? ', ' : ''}{l.state} {l.zip}</div>}
                {l.phone && <div className="text-gray-500">{l.phone}</div>}
                <div className="text-xs text-gray-500 mt-2">Service radius: {l.serviceAreaRadiusMiles} mi · {l.timezone}</div>
              </div>
              {l.isActive && <button onClick={() => deactivate(l.id)} className="mt-3 text-xs text-red-600 hover:underline">Deactivate</button>}
            </div>
          ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Location</h2>
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Name (e.g., Chicago Main)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input required placeholder="Code (e.g., CHI)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={10} className="border rounded-lg px-3 py-2 font-mono" />
              </div>
              <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} className="border rounded-lg px-3 py-2" />
                <input placeholder="ZIP" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input type="number" placeholder="Service radius (miles)" value={form.serviceAreaRadiusMiles} onChange={(e) => setForm({ ...form, serviceAreaRadiusMiles: Number(e.target.value) })} className="border rounded-lg px-3 py-2" />
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-sky-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
