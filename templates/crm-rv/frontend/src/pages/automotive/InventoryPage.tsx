import { useState, useEffect, useCallback } from 'react';
import {
  Caravan, Plus, Search, Loader2, X, ChevronLeft,
  ChevronRight, Camera, Hash, Ruler, Users, Gauge, Cog,
  ShieldAlert, Download, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const PRIMARY = '{{PRIMARY_COLOR}}';
const PER_PAGE = 12;

// --- Category model -----------------------------------------------------------
type Category =
  | 'motorhome' | 'towable' | 'motorcycle' | 'atv'
  | 'utv' | 'sxs' | 'pwc' | 'snowmobile' | 'boat';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'motorhome', label: 'Motorhome' },
  { value: 'towable', label: 'Towable' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'atv', label: 'ATV' },
  { value: 'utv', label: 'UTV' },
  { value: 'sxs', label: 'Side-by-Side' },
  { value: 'pwc', label: 'Personal Watercraft' },
  { value: 'snowmobile', label: 'Snowmobile' },
  { value: 'boat', label: 'Boat' },
];

const POWERSPORTS: Category[] = ['motorcycle', 'atv', 'utv', 'sxs', 'pwc', 'snowmobile'];
const isPowersports = (c?: string) => POWERSPORTS.includes(c as Category);
const isRvMotorhome = (c?: string) => c === 'motorhome';
const isRvTowable = (c?: string) => c === 'towable';
const isRv = (c?: string) => isRvMotorhome(c) || isRvTowable(c);

const RV_CLASSES = [
  { value: 'A', label: 'Class A' },
  { value: 'B', label: 'Class B' },
  { value: 'B+', label: 'Class B+' },
  { value: 'C', label: 'Class C' },
  { value: 'super_c', label: 'Super C' },
];

const TOWABLE_TYPES = [
  { value: 'travel_trailer', label: 'Travel Trailer' },
  { value: 'fifth_wheel', label: 'Fifth Wheel' },
  { value: 'toy_hauler', label: 'Toy Hauler' },
  { value: 'pop_up', label: 'Pop-Up' },
  { value: 'teardrop', label: 'Teardrop' },
  { value: 'destination', label: 'Destination Trailer' },
];

interface Unit {
  id: string;
  category: Category;
  condition: 'new' | 'used' | 'consignment';
  stockNumber: string;
  vin: string;
  year: number;
  make: string;
  modelName: string;
  trim: string;
  status: 'available' | 'sold' | 'pending' | 'on_order' | 'in_service';
  msrp: number;
  listedPrice: number;
  internetPrice: number;
  cost: number;
  photos: string[];
  floorplanImg?: string;
  exteriorColor: string;
  interiorColor: string;
  description: string;
  features: string[];
  // RV motorhome
  rvClass?: string;
  // RV towable
  towableType?: string;
  // RV shared
  lengthFt?: number;
  sleeps?: number;
  slideOuts?: number;
  gvwr?: number;
  dryWeight?: number;
  hitchWeight?: number;
  chassis?: string;
  generatorHours?: number;
  freshTankGal?: number;
  greyTankGal?: number;
  blackTankGal?: number;
  awnings?: number;
  // Powersports + motorhome
  fuelType?: string;
  mileage?: number;
  engineCc?: number;
  hours?: number;
  drivetrain?: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  available: { bg: '#dcfce7', text: '#166534', label: 'Available' },
  sold: { bg: '#f3f4f6', text: '#374151', label: 'Sold' },
  pending: { bg: '#fef9c3', text: '#854d0e', label: 'Pending' },
  on_order: { bg: '#e0e7ff', text: '#3730a3', label: 'On Order' },
  in_service: { bg: '#dbeafe', text: '#1e40af', label: 'In Service' },
};

const CONDITION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: '#dbeafe', text: '#1e40af', label: 'New' },
  used: { bg: '#f3f4f6', text: '#374151', label: 'Used' },
  consignment: { bg: '#ede9fe', text: '#5b21b6', label: 'Consignment' },
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n);

const categoryLabel = (c: string) => CATEGORIES.find(x => x.value === c)?.label || c;

export default function InventoryPage() {
  const { token, hasFeature } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [recallUnit, setRecallUnit] = useState<Unit | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadUnits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (conditionFilter) params.set('condition', conditionFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      const res = await fetch(`/api/units?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setUnits(data.data || data.units || []);
      setTotal(data.total || data.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load units:', err);
    } finally {
      setLoading(false);
    }
  }, [token, page, search, statusFilter, conditionFilter, categoryFilter]);

  useEffect(() => { loadUnits(); }, [loadUnits]);
  useEffect(() => { setPage(1); }, [search, statusFilter, conditionFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const handleExportFeed = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/syndication/feed?format=csv', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-feed-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export feed:', err);
      alert('Failed to export inventory feed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Inventory</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Manage your RV &amp; powersports lot</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hasFeature('inventory_syndication') && (
            <button
              onClick={handleExportFeed}
              disabled={exporting}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1, fontWeight: 600, fontSize: 14 }}
            >
              {exporting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={16} />} Export Feed
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            <Plus size={16} /> Add Unit
          </button>
        </div>
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
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={selectStyle}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All Statuses</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={conditionFilter} onChange={e => setConditionFilter(e.target.value)} style={selectStyle}>
          <option value="">All Conditions</option>
          {Object.entries(CONDITION_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
        </div>
      ) : units.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
          <Caravan size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 16 }}>No units found</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
            {units.map(u => (
              <UnitCard
                key={u.id}
                unit={u}
                expanded={expandedId === u.id}
                onToggle={() => setExpandedId(expandedId === u.id ? null : u.id)}
                canCheckRecalls={hasFeature('recall_lookup')}
                onCheckRecalls={() => setRecallUnit(u)}
              />
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

      {showAddModal && <AddUnitModal headers={headers} onClose={() => setShowAddModal(false)} onSaved={() => { setShowAddModal(false); loadUnits(); }} />}
      {recallUnit && <RecallModal unit={recallUnit} token={token} onClose={() => setRecallUnit(null)} />}
    </div>
  );
}

// --- Recall lookup modal ------------------------------------------------------
interface RecallItem {
  campaignNumber: string;
  manufacturer: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  reportReceivedDate: string;
  notes: string;
}

interface RecallResponse {
  unitId: string;
  make: string;
  model: string;
  year: number;
  count: number;
  recalls: RecallItem[];
  note?: string;
}

function RecallModal({ unit, token, onClose }: { unit: Unit; token: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecallResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/recalls/unit/${unit.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Lookup failed');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        console.error('Failed to check recalls:', err);
        if (!cancelled) setError('Failed to check recalls. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [unit.id, token]);

  const title = `${unit.year} ${unit.make} ${unit.modelName}`;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 12, width: '100%', maxWidth: 620, maxHeight: '90vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={22} color={PRIMARY} />
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Recall Check</h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280' }}>{title}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6b7280" /></button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
          </div>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, background: '#fef2f2', borderRadius: 8, color: '#991b1b' }}>
            <AlertTriangle size={18} /> {error}
          </div>
        ) : data && data.count > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: '#fef3c7', borderRadius: 8, color: '#92400e', fontWeight: 600, fontSize: 14 }}>
              <AlertTriangle size={16} /> {data.count} open recall{data.count === 1 ? '' : 's'} found
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.recalls.map((r, i) => (
                <div key={r.campaignNumber || i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111827' }}>{r.component || 'Recall'}</h3>
                    {r.campaignNumber && <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>{r.campaignNumber}</span>}
                  </div>
                  {r.summary && <RecallField label="Summary" value={r.summary} />}
                  {r.consequence && <RecallField label="Consequence" value={r.consequence} />}
                  {r.remedy && <RecallField label="Remedy" value={r.remedy} />}
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                    {r.manufacturer && <span>{r.manufacturer}</span>}
                    {r.reportReceivedDate && <span>Reported {r.reportReceivedDate}</span>}
                  </div>
                  {r.notes && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>{r.notes}</p>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <CheckCircle2 size={40} color="#16a34a" style={{ marginBottom: 12 }} />
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>No open recalls</p>
            {data?.note && <p style={{ margin: '10px auto 0', fontSize: 13, color: '#6b7280', maxWidth: 440, lineHeight: 1.5 }}>{data.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function RecallField({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ margin: '4px 0', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
      <span style={{ fontWeight: 600 }}>{label}: </span>{value}
    </p>
  );
}

// --- Key spec chip shown on the card per category -----------------------------
function KeySpec({ unit: u }: { unit: Unit }) {
  const chips: { icon: JSX.Element; text: string }[] = [];
  if (isRv(u.category)) {
    if (u.lengthFt) chips.push({ icon: <Ruler size={13} />, text: `${u.lengthFt} ft` });
    if (u.sleeps) chips.push({ icon: <Users size={13} />, text: `Sleeps ${u.sleeps}` });
  } else if (isPowersports(u.category)) {
    if (u.engineCc) chips.push({ icon: <Cog size={13} />, text: `${u.engineCc} cc` });
    if (u.hours != null) chips.push({ icon: <Gauge size={13} />, text: `${fmtNum(u.hours)} hrs` });
    else if (u.mileage != null && u.category === 'motorcycle') chips.push({ icon: <Gauge size={13} />, text: `${fmtNum(u.mileage)} mi` });
  }
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: '#6b7280' }}>
      {chips.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{c.icon} {c.text}</span>
      ))}
    </div>
  );
}

function UnitCard({ unit: u, expanded, onToggle, canCheckRecalls, onCheckRecalls }: { unit: Unit; expanded: boolean; onToggle: () => void; canCheckRecalls: boolean; onCheckRecalls: () => void }) {
  const sts = STATUS_STYLES[u.status] || STATUS_STYLES.available;
  const cnd = CONDITION_STYLES[u.condition] || CONDITION_STYLES.used;
  const title = `${u.year} ${u.make} ${u.modelName}${u.trim ? ' ' + u.trim : ''}`;
  const price = u.internetPrice || u.listedPrice;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff', transition: 'box-shadow 0.15s', cursor: 'pointer' }} onClick={onToggle}>
      {/* Photo area */}
      <div style={{ height: 180, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {u.photos?.length ? (
          <img src={u.photos[0]} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Camera size={36} style={{ color: '#d1d5db' }} />
        )}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(17,24,39,0.78)', color: '#fff' }}>{categoryLabel(u.category)}</span>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sts.bg, color: sts.text }}>{sts.label}</span>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: cnd.bg, color: cnd.text }}>{cnd.label}</span>
        </div>
      </div>
      {/* Info */}
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>{title}</h3>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: '#6b7280' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Hash size={13} /> {u.stockNumber || '--'}</span>
        </div>
        <KeySpec unit={u} />
        <p style={{ margin: '10px 0 0', fontSize: 20, fontWeight: 700, color: PRIMARY }}>{price ? fmt(price) : 'Call for price'}</p>
      </div>
      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f3f4f6' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginTop: 12, fontSize: 13 }}>
            <Detail label="VIN" value={u.vin} />
            <Detail label="MSRP" value={u.msrp ? fmt(u.msrp) : undefined} />
            {isRvMotorhome(u.category) && <>
              <Detail label="Class" value={RV_CLASSES.find(c => c.value === u.rvClass)?.label} />
              <Detail label="Length" value={u.lengthFt ? `${u.lengthFt} ft` : undefined} />
              <Detail label="Sleeps" value={u.sleeps?.toString()} />
              <Detail label="Slide-Outs" value={u.slideOuts?.toString()} />
              <Detail label="Chassis" value={u.chassis} />
              <Detail label="Fuel" value={u.fuelType} />
              <Detail label="Mileage" value={u.mileage != null ? `${fmtNum(u.mileage)} mi` : undefined} />
              <Detail label="Generator Hrs" value={u.generatorHours?.toString()} />
              <Detail label="GVWR" value={u.gvwr ? `${fmtNum(u.gvwr)} lbs` : undefined} />
              <Detail label="Dry Weight" value={u.dryWeight ? `${fmtNum(u.dryWeight)} lbs` : undefined} />
              <Detail label="Fresh / Grey / Black" value={tankSummary(u)} />
              <Detail label="Awnings" value={u.awnings?.toString()} />
            </>}
            {isRvTowable(u.category) && <>
              <Detail label="Type" value={TOWABLE_TYPES.find(t => t.value === u.towableType)?.label} />
              <Detail label="Length" value={u.lengthFt ? `${u.lengthFt} ft` : undefined} />
              <Detail label="Sleeps" value={u.sleeps?.toString()} />
              <Detail label="Slide-Outs" value={u.slideOuts?.toString()} />
              <Detail label="Dry Weight" value={u.dryWeight ? `${fmtNum(u.dryWeight)} lbs` : undefined} />
              <Detail label="GVWR" value={u.gvwr ? `${fmtNum(u.gvwr)} lbs` : undefined} />
              <Detail label="Hitch Weight" value={u.hitchWeight ? `${fmtNum(u.hitchWeight)} lbs` : undefined} />
              <Detail label="Fresh / Grey / Black" value={tankSummary(u)} />
              <Detail label="Awnings" value={u.awnings?.toString()} />
            </>}
            {isPowersports(u.category) && <>
              <Detail label="Engine" value={u.engineCc ? `${u.engineCc} cc` : undefined} />
              <Detail label="Hours" value={u.hours != null ? fmtNum(u.hours) : undefined} />
              {u.category === 'motorcycle' && <Detail label="Mileage" value={u.mileage != null ? `${fmtNum(u.mileage)} mi` : undefined} />}
              {(u.category === 'utv' || u.category === 'sxs') && <Detail label="Drivetrain" value={u.drivetrain} />}
              <Detail label="Fuel" value={u.fuelType} />
            </>}
            <Detail label="Ext. Color" value={u.exteriorColor} />
            <Detail label="Int. Color" value={u.interiorColor} />
          </div>
          {u.features?.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {u.features.map((f, i) => (
                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#f3f4f6', color: '#374151' }}>{f}</span>
              ))}
            </div>
          )}
          {u.description && <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{u.description}</p>}
          {canCheckRecalls && (
            <button
              onClick={onCheckRecalls}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '8px 14px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              <ShieldAlert size={15} /> Check Recalls
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function tankSummary(u: Unit): string | undefined {
  const parts = [u.freshTankGal, u.greyTankGal, u.blackTankGal];
  if (parts.every(p => p == null)) return undefined;
  return parts.map(p => (p != null ? `${p}g` : '--')).join(' / ');
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
      <p style={{ margin: '2px 0 0', color: '#111827', fontWeight: 500 }}>{value || '--'}</p>
    </div>
  );
}

// --- Add Unit modal -----------------------------------------------------------
const blankForm = {
  category: '' as Category | '',
  condition: 'used',
  stockNumber: '', vin: '', year: '', make: '', modelName: '', trim: '',
  status: 'available',
  msrp: '', listedPrice: '', internetPrice: '', cost: '',
  exteriorColor: '', interiorColor: '', description: '', features: '',
  // RV motorhome
  rvClass: 'C', chassis: '', generatorHours: '',
  // RV towable
  towableType: 'travel_trailer', hitchWeight: '',
  // RV shared
  lengthFt: '', sleeps: '', slideOuts: '', gvwr: '', dryWeight: '',
  freshTankGal: '', greyTankGal: '', blackTankGal: '', awnings: '',
  // Powersports
  engineCc: '', hours: '', drivetrain: '',
  // shared powertrain
  fuelType: '', mileage: '',
};

function AddUnitModal({ headers, onClose, onSaved }: { headers: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...blankForm });
  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));
  const cat = form.category;

  const num = (v: string) => (v === '' ? undefined : Number(v));

  const handleSave = async () => {
    if (!form.category) { alert('Category is required.'); return; }
    if (!form.year || !form.make || !form.modelName) { alert('Year, Make, and Model are required.'); return; }
    setSaving(true);
    try {
      // Base payload shared by every category
      const body: Record<string, unknown> = {
        category: form.category,
        condition: form.condition,
        stockNumber: form.stockNumber,
        vin: form.vin,
        year: Number(form.year),
        make: form.make,
        modelName: form.modelName,
        trim: form.trim,
        status: form.status,
        msrp: num(form.msrp),
        listedPrice: num(form.listedPrice),
        internetPrice: num(form.internetPrice),
        cost: num(form.cost),
        exteriorColor: form.exteriorColor,
        interiorColor: form.interiorColor,
        description: form.description,
        features: form.features.split(',').map(s => s.trim()).filter(Boolean),
      };

      // Category-conditional fields
      if (isRvMotorhome(cat)) {
        Object.assign(body, {
          rvClass: form.rvClass,
          lengthFt: num(form.lengthFt), sleeps: num(form.sleeps), slideOuts: num(form.slideOuts),
          gvwr: num(form.gvwr), dryWeight: num(form.dryWeight), chassis: form.chassis,
          mileage: num(form.mileage), fuelType: form.fuelType, generatorHours: num(form.generatorHours),
          freshTankGal: num(form.freshTankGal), greyTankGal: num(form.greyTankGal), blackTankGal: num(form.blackTankGal),
          awnings: num(form.awnings),
        });
      } else if (isRvTowable(cat)) {
        Object.assign(body, {
          towableType: form.towableType,
          lengthFt: num(form.lengthFt), sleeps: num(form.sleeps), slideOuts: num(form.slideOuts),
          dryWeight: num(form.dryWeight), gvwr: num(form.gvwr), hitchWeight: num(form.hitchWeight),
          freshTankGal: num(form.freshTankGal), greyTankGal: num(form.greyTankGal), blackTankGal: num(form.blackTankGal),
          awnings: num(form.awnings),
        });
      } else if (isPowersports(cat)) {
        Object.assign(body, {
          engineCc: num(form.engineCc), hours: num(form.hours), fuelType: form.fuelType,
        });
        if (cat === 'utv' || cat === 'sxs') body.drivetrain = form.drivetrain;
        if (cat === 'motorcycle') body.mileage = num(form.mileage);
      }

      const res = await fetch('/api/units', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      onSaved();
    } catch (err) {
      console.error('Failed to save unit:', err);
      alert('Failed to save unit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 12, width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Add Unit</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6b7280" /></button>
        </div>

        {/* Category — drives the rest of the form */}
        <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <label style={labelStyle}>Category <span style={{ color: '#dc2626' }}>*</span></label>
          <select value={form.category} onChange={e => set('category', e.target.value)} style={{ ...inputStyle, background: '#fff' }}>
            <option value="">Select a category...</option>
            <optgroup label="RV">
              <option value="motorhome">Motorhome</option>
              <option value="towable">Towable</option>
            </optgroup>
            <optgroup label="Powersports">
              <option value="motorcycle">Motorcycle</option>
              <option value="atv">ATV</option>
              <option value="utv">UTV</option>
              <option value="sxs">Side-by-Side</option>
              <option value="pwc">Personal Watercraft</option>
              <option value="snowmobile">Snowmobile</option>
            </optgroup>
            <optgroup label="Marine">
              <option value="boat">Boat</option>
            </optgroup>
          </select>
          {!form.category && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>Pick a category to reveal the relevant spec fields.</p>}
        </div>

        {form.category && (
          <>
            {/* Identity */}
            <SectionTitle>Identity</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="Year" value={form.year} onChange={v => set('year', v)} type="number" />
              <Field label="Make" value={form.make} onChange={v => set('make', v)} />
              <Field label="Model" value={form.modelName} onChange={v => set('modelName', v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="Trim" value={form.trim} onChange={v => set('trim', v)} />
              <Field label="Stock #" value={form.stockNumber} onChange={v => set('stockNumber', v)} />
              <Field label="VIN / HIN" value={form.vin} onChange={v => set('vin', v)} mono />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <SelectField label="Condition" value={form.condition} onChange={v => set('condition', v)} options={Object.entries(CONDITION_STYLES).map(([k, v]) => ({ value: k, label: v.label }))} />
              <SelectField label="Status" value={form.status} onChange={v => set('status', v)} options={Object.entries(STATUS_STYLES).map(([k, v]) => ({ value: k, label: v.label }))} />
            </div>

            {/* Category-conditional specs */}
            {isRvMotorhome(cat) && (
              <>
                <SectionTitle>Motorhome Specs</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <SelectField label="RV Class" value={form.rvClass} onChange={v => set('rvClass', v)} options={RV_CLASSES} />
                  <Field label="Length (ft)" value={form.lengthFt} onChange={v => set('lengthFt', v)} type="number" />
                  <Field label="Sleeps" value={form.sleeps} onChange={v => set('sleeps', v)} type="number" />
                  <Field label="Slide-Outs" value={form.slideOuts} onChange={v => set('slideOuts', v)} type="number" />
                  <Field label="Chassis" value={form.chassis} onChange={v => set('chassis', v)} />
                  <Field label="Fuel Type" value={form.fuelType} onChange={v => set('fuelType', v)} />
                  <Field label="Mileage" value={form.mileage} onChange={v => set('mileage', v)} type="number" />
                  <Field label="Generator Hrs" value={form.generatorHours} onChange={v => set('generatorHours', v)} type="number" />
                  <Field label="GVWR (lbs)" value={form.gvwr} onChange={v => set('gvwr', v)} type="number" />
                  <Field label="Dry Weight (lbs)" value={form.dryWeight} onChange={v => set('dryWeight', v)} type="number" />
                  <Field label="Awnings" value={form.awnings} onChange={v => set('awnings', v)} type="number" />
                </div>
                <TankFields form={form} set={set} />
              </>
            )}

            {isRvTowable(cat) && (
              <>
                <SectionTitle>Towable Specs</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <SelectField label="Towable Type" value={form.towableType} onChange={v => set('towableType', v)} options={TOWABLE_TYPES} />
                  <Field label="Length (ft)" value={form.lengthFt} onChange={v => set('lengthFt', v)} type="number" />
                  <Field label="Sleeps" value={form.sleeps} onChange={v => set('sleeps', v)} type="number" />
                  <Field label="Slide-Outs" value={form.slideOuts} onChange={v => set('slideOuts', v)} type="number" />
                  <Field label="Dry Weight (lbs)" value={form.dryWeight} onChange={v => set('dryWeight', v)} type="number" />
                  <Field label="GVWR (lbs)" value={form.gvwr} onChange={v => set('gvwr', v)} type="number" />
                  <Field label="Hitch Weight (lbs)" value={form.hitchWeight} onChange={v => set('hitchWeight', v)} type="number" />
                  <Field label="Awnings" value={form.awnings} onChange={v => set('awnings', v)} type="number" />
                </div>
                <TankFields form={form} set={set} />
              </>
            )}

            {isPowersports(cat) && (
              <>
                <SectionTitle>Powersports Specs</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <Field label="Engine (cc)" value={form.engineCc} onChange={v => set('engineCc', v)} type="number" />
                  <Field label="Hours" value={form.hours} onChange={v => set('hours', v)} type="number" />
                  <Field label="Fuel Type" value={form.fuelType} onChange={v => set('fuelType', v)} />
                  {(cat === 'utv' || cat === 'sxs') && (
                    <Field label="Drivetrain" value={form.drivetrain} onChange={v => set('drivetrain', v)} />
                  )}
                  {cat === 'motorcycle' && (
                    <Field label="Mileage" value={form.mileage} onChange={v => set('mileage', v)} type="number" />
                  )}
                </div>
              </>
            )}

            {cat === 'boat' && (
              <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>Add boat-specific specs in the description for now.</p>
            )}

            {/* Pricing */}
            <SectionTitle>Pricing</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="MSRP" value={form.msrp} onChange={v => set('msrp', v)} type="number" />
              <Field label="Listed Price" value={form.listedPrice} onChange={v => set('listedPrice', v)} type="number" />
              <Field label="Internet Price" value={form.internetPrice} onChange={v => set('internetPrice', v)} type="number" />
              <Field label="Cost" value={form.cost} onChange={v => set('cost', v)} type="number" />
            </div>

            {/* Appearance */}
            <SectionTitle>Appearance &amp; Details</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="Exterior Color" value={form.exteriorColor} onChange={v => set('exteriorColor', v)} />
              <Field label="Interior Color" value={form.interiorColor} onChange={v => set('interiorColor', v)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Features <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma-separated)</span></label>
              <input value={form.features} onChange={e => set('features', e.target.value)} placeholder="e.g. Solar prep, Outdoor kitchen, Backup camera" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.category} style={{ padding: '10px 24px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: saving || !form.category ? 'default' : 'pointer', opacity: saving || !form.category ? 0.6 : 1, fontWeight: 600, fontSize: 14 }}>
            {saving ? 'Saving...' : 'Save Unit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TankFields({ form, set }: { form: typeof blankForm; set: (k: string, v: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
      <Field label="Fresh Tank (gal)" value={form.freshTankGal} onChange={v => set('freshTankGal', v)} type="number" />
      <Field label="Grey Tank (gal)" value={form.greyTankGal} onChange={v => set('greyTankGal', v)} type="number" />
      <Field label="Black Tank (gal)" value={form.blackTankGal} onChange={v => set('blackTankGal', v)} type="number" />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 12px' }}>{children}</h3>;
}

function Field({ label, value, onChange, type = 'text', mono = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, ...(mono ? { fontFamily: 'monospace', letterSpacing: 1 } : {}) }} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, background: '#fff' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
const selectStyle: React.CSSProperties = { padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, cursor: 'pointer', background: '#fff' };
