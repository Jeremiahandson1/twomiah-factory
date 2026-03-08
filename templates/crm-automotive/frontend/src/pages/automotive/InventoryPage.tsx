import { useState, useEffect, useCallback } from 'react';
import {
  Car, Plus, Search, Filter, Loader2, X, ChevronLeft,
  ChevronRight, Camera, Tag, Gauge, Hash, ScanLine
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const PRIMARY = '{{PRIMARY_COLOR}}';
const PER_PAGE = 12;

interface Vehicle {
  id: string;
  vin: string;
  stockNumber: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyType: string;
  fuelType: string;
  transmission: string;
  drivetrain: string;
  engine: string;
  mileage: number;
  condition: 'new' | 'used' | 'cpo';
  status: 'available' | 'sold' | 'pending' | 'service';
  listedPrice: number;
  photos: string[];
  exteriorColor: string;
  interiorColor: string;
  description: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  available: { bg: '#dcfce7', text: '#166534' },
  sold: { bg: '#f3f4f6', text: '#374151' },
  pending: { bg: '#fef9c3', text: '#854d0e' },
  service: { bg: '#dbeafe', text: '#1e40af' },
};

const CONDITION_STYLES: Record<string, { bg: string; text: string }> = {
  new: { bg: '#dbeafe', text: '#1e40af' },
  used: { bg: '#f3f4f6', text: '#374151' },
  cpo: { bg: '#ede9fe', text: '#5b21b6' },
};

export default function InventoryPage() {
  const { token } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (conditionFilter) params.set('condition', conditionFilter);
      const res = await fetch(`/api/vehicles?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setVehicles(data.data || data.vehicles || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load vehicles:', err);
    } finally {
      setLoading(false);
    }
  }, [token, page, search, statusFilter, conditionFilter]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);
  useEffect(() => { setPage(1); }, [search, statusFilter, conditionFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtMiles = (n: number) => new Intl.NumberFormat('en-US').format(n);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Vehicle Inventory</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Manage your dealership lot</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
        >
          <Plus size={16} /> Add Vehicle
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by make, model, VIN, stock#..."
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, cursor: 'pointer', background: '#fff' }}>
          <option value="">All Statuses</option>
          <option value="available">Available</option>
          <option value="pending">Pending</option>
          <option value="sold">Sold</option>
          <option value="service">In Service</option>
        </select>
        <select value={conditionFilter} onChange={e => setConditionFilter(e.target.value)} style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, cursor: 'pointer', background: '#fff' }}>
          <option value="">All Conditions</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="cpo">CPO</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
        </div>
      ) : vehicles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
          <Car size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 16 }}>No vehicles found</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
            {vehicles.map(v => (
              <div key={v.id}>
                <VehicleCard vehicle={v} expanded={expandedId === v.id} onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)} fmt={fmt} fmtMiles={fmtMiles} />
              </div>
            ))}
          </div>
          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: 14 }}>
              <ChevronLeft size={16} /> Prev
            </button>
            <span style={{ fontSize: 14, color: '#6b7280' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: 14 }}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}

      {showAddModal && <AddVehicleModal token={token} headers={headers} onClose={() => setShowAddModal(false)} onSaved={() => { setShowAddModal(false); loadVehicles(); }} />}
    </div>
  );
}

function VehicleCard({ vehicle: v, expanded, onToggle, fmt, fmtMiles }: { vehicle: Vehicle; expanded: boolean; onToggle: () => void; fmt: (n: number) => string; fmtMiles: (n: number) => string }) {
  const sts = STATUS_STYLES[v.status] || STATUS_STYLES.available;
  const cnd = CONDITION_STYLES[v.condition] || CONDITION_STYLES.used;
  const title = `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff', transition: 'box-shadow 0.15s', cursor: 'pointer' }} onClick={onToggle}>
      {/* Photo area */}
      <div style={{ height: 180, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {v.photos?.length ? (
          <img src={v.photos[0]} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Camera size={36} style={{ color: '#d1d5db' }} />
        )}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sts.bg, color: sts.text, textTransform: 'capitalize' }}>{v.status}</span>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: cnd.bg, color: cnd.text, textTransform: 'uppercase' }}>{v.condition}</span>
        </div>
      </div>
      {/* Info */}
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>{title}</h3>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: '#6b7280' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Hash size={13} /> {v.stockNumber || '--'}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Gauge size={13} /> {v.mileage ? fmtMiles(v.mileage) + ' mi' : '--'}</span>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 20, fontWeight: 700, color: PRIMARY }}>{v.listedPrice ? fmt(v.listedPrice) : 'Call for price'}</p>
      </div>
      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f3f4f6' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginTop: 12, fontSize: 13 }}>
            <Detail label="VIN" value={v.vin} />
            <Detail label="Body" value={v.bodyType} />
            <Detail label="Engine" value={v.engine} />
            <Detail label="Transmission" value={v.transmission} />
            <Detail label="Drivetrain" value={v.drivetrain} />
            <Detail label="Fuel" value={v.fuelType} />
            <Detail label="Ext. Color" value={v.exteriorColor} />
            <Detail label="Int. Color" value={v.interiorColor} />
          </div>
          {v.description && <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{v.description}</p>}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
      <p style={{ margin: '2px 0 0', color: '#111827', fontWeight: 500 }}>{value || '--'}</p>
    </div>
  );
}

function AddVehicleModal({ token, headers, onClose, onSaved }: { token: string; headers: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [vin, setVin] = useState('');
  const [decoding, setDecoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    year: '', make: '', model: '', trim: '', bodyType: '', fuelType: '',
    transmission: '', drivetrain: '', engine: '', stockNumber: '', mileage: '',
    condition: 'used', status: 'available', listedPrice: '', exteriorColor: '',
    interiorColor: '', description: '',
  });

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const decodeVin = async () => {
    if (vin.length < 11) return;
    setDecoding(true);
    try {
      const res = await fetch('/api/vehicles/vin-decode', { method: 'POST', headers, body: JSON.stringify({ vin }) });
      if (!res.ok) throw new Error('Decode failed');
      const data = await res.json();
      setForm(f => ({
        ...f,
        year: data.year?.toString() || f.year,
        make: data.make || f.make,
        model: data.model || f.model,
        trim: data.trim || f.trim,
        bodyType: data.bodyType || f.bodyType,
        fuelType: data.fuelType || f.fuelType,
        transmission: data.transmission || f.transmission,
        drivetrain: data.drivetrain || f.drivetrain,
        engine: data.engine || f.engine,
      }));
    } catch (err) {
      console.error('VIN decode failed:', err);
      alert('Could not decode VIN. Please fill fields manually.');
    } finally {
      setDecoding(false);
    }
  };

  const handleSave = async () => {
    if (!form.year || !form.make || !form.model) { alert('Year, Make, and Model are required.'); return; }
    setSaving(true);
    try {
      const body = { ...form, vin, year: Number(form.year), mileage: Number(form.mileage) || 0, listedPrice: Number(form.listedPrice) || 0 };
      const res = await fetch('/api/vehicles', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      onSaved();
    } catch (err) {
      console.error('Failed to save vehicle:', err);
      alert('Failed to save vehicle.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Add Vehicle</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6b7280" /></button>
        </div>

        {/* VIN Decode */}
        <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <label style={labelStyle}><ScanLine size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />VIN</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} maxLength={17} placeholder="Enter 17-digit VIN" style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', letterSpacing: 1 }} />
            <button onClick={decodeVin} disabled={vin.length < 11 || decoding} style={{ padding: '8px 16px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: vin.length < 11 || decoding ? 'default' : 'pointer', opacity: vin.length < 11 || decoding ? 0.5 : 1, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
              {decoding ? 'Decoding...' : 'Decode VIN'}
            </button>
          </div>
        </div>

        {/* Vehicle Details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <Field label="Year" value={form.year} onChange={v => set('year', v)} type="number" />
          <Field label="Make" value={form.make} onChange={v => set('make', v)} />
          <Field label="Model" value={form.model} onChange={v => set('model', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <Field label="Trim" value={form.trim} onChange={v => set('trim', v)} />
          <Field label="Body Type" value={form.bodyType} onChange={v => set('bodyType', v)} />
          <Field label="Engine" value={form.engine} onChange={v => set('engine', v)} />
          <Field label="Transmission" value={form.transmission} onChange={v => set('transmission', v)} />
          <Field label="Drivetrain" value={form.drivetrain} onChange={v => set('drivetrain', v)} />
          <Field label="Fuel Type" value={form.fuelType} onChange={v => set('fuelType', v)} />
          <Field label="Ext. Color" value={form.exteriorColor} onChange={v => set('exteriorColor', v)} />
          <Field label="Int. Color" value={form.interiorColor} onChange={v => set('interiorColor', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <Field label="Stock #" value={form.stockNumber} onChange={v => set('stockNumber', v)} />
          <Field label="Mileage" value={form.mileage} onChange={v => set('mileage', v)} type="number" />
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Condition</label>
            <select value={form.condition} onChange={e => set('condition', e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff' }}>
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="cpo">CPO</option>
            </select>
          </div>
          <Field label="Listed Price" value={form.listedPrice} onChange={v => set('listedPrice', v)} type="number" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontWeight: 600, fontSize: 14 }}>
            {saving ? 'Saving...' : 'Save Vehicle'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
    </div>
  );
}
