import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Sprout, Warehouse, Scissors, Thermometer, Droplets, Leaf } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const phases = [
  { value: '', label: 'All Phases' },
  { value: 'clone', label: 'Clone' },
  { value: 'vegetative', label: 'Vegetative' },
  { value: 'flowering', label: 'Flowering' },
  { value: 'harvested', label: 'Harvested' },
  { value: 'destroyed', label: 'Destroyed' },
];

const phaseColors: Record<string, string> = {
  clone: 'bg-teal-100 text-teal-700',
  vegetative: 'bg-green-100 text-green-700',
  flowering: 'bg-purple-100 text-purple-700',
  harvested: 'bg-amber-100 text-amber-700',
  destroyed: 'bg-red-100 text-red-700',
};

const roomTypes = [
  { value: 'clone', label: 'Clone Room' },
  { value: 'vegetative', label: 'Veg Room' },
  { value: 'flowering', label: 'Flower Room' },
  { value: 'drying', label: 'Drying Room' },
  { value: 'curing', label: 'Curing Room' },
  { value: 'storage', label: 'Storage' },
  { value: 'mother', label: 'Mother Room' },
];

const roomTypeColors: Record<string, string> = {
  clone: 'bg-teal-100 text-teal-700',
  vegetative: 'bg-green-100 text-green-700',
  flowering: 'bg-purple-100 text-purple-700',
  drying: 'bg-amber-100 text-amber-700',
  curing: 'bg-orange-100 text-orange-700',
  storage: 'bg-gray-100 text-gray-700',
  mother: 'bg-pink-100 text-pink-700',
};

const harvestStatuses: Record<string, string> = {
  drying: 'bg-amber-100 text-amber-700',
  curing: 'bg-orange-100 text-orange-700',
  complete: 'bg-green-100 text-green-700',
  packaged: 'bg-blue-100 text-blue-700',
};

const plantTypes = [
  { value: 'seed', label: 'Seed' },
  { value: 'clone', label: 'Clone' },
  { value: 'mother', label: 'Mother' },
];

const tabs = [
  { id: 'plants', label: 'Plants', icon: Leaf },
  { id: 'rooms', label: 'Rooms', icon: Warehouse },
  { id: 'harvests', label: 'Harvests', icon: Scissors },
];

export default function CultivationPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('plants');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get('/api/cultivation/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Cultivation" subtitle="Grow tracking and harvest management" />

      {/* Quick Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Clones</p>
            <p className="text-2xl font-bold text-teal-600">{stats.clones || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Vegetative</p>
            <p className="text-2xl font-bold text-green-600">{stats.vegetative || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Flowering</p>
            <p className="text-2xl font-bold text-purple-600">{stats.flowering || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Rooms at Capacity</p>
            <p className="text-2xl font-bold text-amber-600">{stats.roomsAtCapacity || 0}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'plants' && <PlantsTab />}
      {activeTab === 'rooms' && <RoomsTab />}
      {activeTab === 'harvests' && <HarvestsTab />}
    </div>
  );
}

/* ─── Plants Tab ─── */
function PlantsTab() {
  const toast = useToast();
  const [plants, setPlants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [strainFilter, setStrainFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    metrcTag: '', strainName: '', plantType: 'clone', phase: 'clone', room: '', plantDate: '', notes: '',
  });

  const loadPlants = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (phaseFilter) params.phase = phaseFilter;
      if (strainFilter) params.strain = strainFilter;
      if (roomFilter) params.room = roomFilter;
      const data = await api.get('/api/cultivation/plants', params);
      setPlants(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load plants');
    } finally {
      setLoading(false);
    }
  }, [page, search, phaseFilter, strainFilter, roomFilter]);

  useEffect(() => { loadPlants(); }, [loadPlants]);
  useEffect(() => { setPage(1); }, [search, phaseFilter, strainFilter, roomFilter]);

  const handleCreate = async () => {
    if (!formData.metrcTag.trim()) { toast.error('Metrc tag is required'); return; }
    if (!formData.strainName.trim()) { toast.error('Strain name is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/cultivation/plants', formData);
      toast.success('Plant added');
      setModalOpen(false);
      setFormData({ metrcTag: '', strainName: '', plantType: 'clone', phase: 'clone', room: '', plantDate: '', notes: '' });
      loadPlants();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add plant');
    } finally {
      setSaving(false);
    }
  };

  const handlePhaseChange = async (plantId: string, newPhase: string) => {
    try {
      await api.put(`/api/cultivation/plants/${plantId}`, { phase: newPhase });
      toast.success('Phase updated');
      loadPlants();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update phase');
    }
  };

  const columns = [
    { key: 'metrcTag', label: 'Metrc Tag', render: (val: string) => <span className="font-mono text-sm text-gray-900">{val}</span> },
    { key: 'strainName', label: 'Strain', render: (val: string) => <span className="font-medium text-gray-900">{val}</span> },
    { key: 'plantType', label: 'Type', render: (val: string) => <span className="capitalize text-gray-600">{val}</span> },
    {
      key: 'phase', label: 'Phase', render: (val: string, row: any) => (
        <select
          value={val}
          onChange={(e) => { e.stopPropagation(); handlePhaseChange(row.id, e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className={`px-2 py-1 text-xs font-medium rounded-full border-0 cursor-pointer ${phaseColors[val] || 'bg-gray-100 text-gray-700'}`}
        >
          {phases.filter(p => p.value).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      ),
    },
    { key: 'room', label: 'Room', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'plantDate', label: 'Plant Date', render: (val: string) => val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">--</span> },
    {
      key: 'daysInPhase', label: 'Days in Phase', render: (val: number) => (
        <span className="text-gray-700">{val != null ? `${val}d` : '--'}</span>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search plants..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
          {phases.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input type="text" placeholder="Filter by strain..." value={strainFilter} onChange={(e) => setStrainFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500" />
        <input type="text" placeholder="Filter by room..." value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500" />
        <Button onClick={() => { setFormData({ metrcTag: '', strainName: '', plantType: 'clone', phase: 'clone', room: '', plantDate: '', notes: '' }); setModalOpen(true); }} className="ml-auto">
          <Plus className="w-4 h-4 mr-2 inline" />Add Plant
        </Button>
      </div>

      <DataTable data={plants} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No plants found" />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add Plant" size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Metrc Tag *</label>
            <input type="text" value={formData.metrcTag} onChange={(e) => setFormData({ ...formData, metrcTag: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="1A4060300000001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Strain Name *</label>
            <input type="text" value={formData.strainName} onChange={(e) => setFormData({ ...formData, strainName: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Blue Dream" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Plant Type</label>
            <select value={formData.plantType} onChange={(e) => setFormData({ ...formData, plantType: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {plantTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Phase</label>
            <select value={formData.phase} onChange={(e) => setFormData({ ...formData, phase: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {phases.filter(p => p.value).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Room</label>
            <input type="text" value={formData.room} onChange={(e) => setFormData({ ...formData, room: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Veg Room A" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Plant Date</label>
            <input type="date" value={formData.plantDate} onChange={(e) => setFormData({ ...formData, plantDate: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Add Plant'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Rooms Tab ─── */
function RoomsTab() {
  const toast = useToast();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', type: 'vegetative', capacity: '', targetTemp: '', targetHumidity: '', notes: '',
  });

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/cultivation/rooms');
      setRooms(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const openCreate = () => {
    setEditingRoom(null);
    setFormData({ name: '', type: 'vegetative', capacity: '', targetTemp: '', targetHumidity: '', notes: '' });
    setModalOpen(true);
  };

  const openEdit = (room: any) => {
    setEditingRoom(room);
    setFormData({
      name: room.name || '',
      type: room.type || 'vegetative',
      capacity: room.capacity?.toString() || '',
      targetTemp: room.targetTemp?.toString() || '',
      targetHumidity: room.targetHumidity?.toString() || '',
      notes: room.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast.error('Room name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        capacity: formData.capacity ? parseInt(formData.capacity) : null,
        targetTemp: formData.targetTemp ? parseFloat(formData.targetTemp) : null,
        targetHumidity: formData.targetHumidity ? parseFloat(formData.targetHumidity) : null,
      };
      if (editingRoom) {
        await api.put(`/api/cultivation/rooms/${editingRoom.id}`, payload);
        toast.success('Room updated');
      } else {
        await api.post('/api/cultivation/rooms', payload);
        toast.success('Room created');
      }
      setModalOpen(false);
      loadRooms();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save room');
    } finally {
      setSaving(false);
    }
  };

  const getCapacityPercent = (current: number, max: number) => {
    if (!max) return 0;
    return Math.min(100, Math.round((current / max) * 100));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Room</Button>
      </div>

      {rooms.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-500">No grow rooms yet. Create your first room.</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => {
            const pct = getCapacityPercent(room.currentCount || 0, room.capacity || 0);
            const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500';
            return (
              <div
                key={room.id}
                className="bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => openEdit(room)}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{room.name}</h3>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${roomTypeColors[room.type] || 'bg-gray-100 text-gray-700'}`}>
                    {room.type}
                  </span>
                </div>

                {/* Capacity bar */}
                {room.capacity > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500">Capacity</span>
                      <span className="text-gray-700 font-medium">{room.currentCount || 0} / {room.capacity}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {/* Environment info */}
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {room.targetTemp && (
                    <span className="flex items-center gap-1">
                      <Thermometer className="w-3.5 h-3.5" />{room.targetTemp}F
                    </span>
                  )}
                  {room.targetHumidity && (
                    <span className="flex items-center gap-1">
                      <Droplets className="w-3.5 h-3.5" />{room.targetHumidity}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingRoom ? 'Edit Room' : 'Create Room'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Room Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Flower Room A" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {roomTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Max Capacity (plants)</label>
            <input type="number" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="200" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Target Temp (F)</label>
              <input type="number" value={formData.targetTemp} onChange={(e) => setFormData({ ...formData, targetTemp: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="78" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Target Humidity (%)</label>
              <input type="number" value={formData.targetHumidity} onChange={(e) => setFormData({ ...formData, targetHumidity: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="55" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingRoom ? 'Update Room' : 'Create Room'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Harvests Tab ─── */
function HarvestsTab() {
  const toast = useToast();
  const [harvests, setHarvests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', strainName: '', plantCount: '', wetWeight: '', dryWeight: '', notes: '',
  });

  const loadHarvests = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      const data = await api.get('/api/cultivation/harvests', params);
      setHarvests(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load harvests');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { loadHarvests(); }, [loadHarvests]);

  const handleCreate = async () => {
    if (!formData.name.trim()) { toast.error('Harvest name is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/cultivation/harvests', {
        ...formData,
        plantCount: formData.plantCount ? parseInt(formData.plantCount) : null,
        wetWeight: formData.wetWeight ? parseFloat(formData.wetWeight) : null,
        dryWeight: formData.dryWeight ? parseFloat(formData.dryWeight) : null,
      });
      toast.success('Harvest created');
      setModalOpen(false);
      setFormData({ name: '', strainName: '', plantCount: '', wetWeight: '', dryWeight: '', notes: '' });
      loadHarvests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create harvest');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateWeight = async (id: string, field: string, value: string) => {
    try {
      await api.put(`/api/cultivation/harvests/${id}`, { [field]: value ? parseFloat(value) : null });
      toast.success('Weight updated');
      loadHarvests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (val: string) => <span className="font-medium text-gray-900">{val}</span> },
    { key: 'strainName', label: 'Strain', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'plantCount', label: 'Plant Count', render: (val: number) => val != null ? val : <span className="text-gray-400">--</span> },
    { key: 'wetWeight', label: 'Wet Weight', render: (val: number) => val != null ? <span className="text-gray-700">{val}g</span> : <span className="text-gray-400">--</span> },
    { key: 'dryWeight', label: 'Dry Weight', render: (val: number) => val != null ? <span className="text-gray-700">{val}g</span> : <span className="text-gray-400">--</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={harvestStatuses} /> },
    { key: 'createdAt', label: 'Date', render: (val: string) => val ? new Date(val).toLocaleDateString() : '--' },
  ];

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setFormData({ name: '', strainName: '', plantCount: '', wetWeight: '', dryWeight: '', notes: '' }); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-2 inline" />Create Harvest
        </Button>
      </div>

      <DataTable data={harvests} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No harvests yet" />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Create Harvest" size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">Harvest Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Harvest #001 - Blue Dream" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Strain</label>
            <input type="text" value={formData.strainName} onChange={(e) => setFormData({ ...formData, strainName: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Blue Dream" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Plant Count</label>
            <input type="number" value={formData.plantCount} onChange={(e) => setFormData({ ...formData, plantCount: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Wet Weight (g)</label>
            <input type="number" step="0.01" value={formData.wetWeight} onChange={(e) => setFormData({ ...formData, wetWeight: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="5000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Dry Weight (g)</label>
            <input type="number" step="0.01" value={formData.dryWeight} onChange={(e) => setFormData({ ...formData, dryWeight: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="1200" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Harvest'}</Button>
        </div>
      </Modal>
    </>
  );
}
