import { useState, useEffect } from 'react';
import {
  Caravan, Plus, Search, Loader2, Edit2, Trash2, X,
  ShieldAlert, Download, Tag, DollarSign, Link2, Copy, Check, RefreshCw,
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

/**
 * RV / Powersports Inventory — dealership unit inventory backed by /api/units.
 * Category-conditional Add/Edit form, recall lookup, and marketplace feed export.
 */

interface Unit {
  id: string;
  category: string;
  condition?: string;
  stockNumber?: string;
  vin?: string;
  year?: number;
  make?: string;
  modelName?: string;
  trim?: string;
  status?: string;
  msrp?: string;
  listedPrice?: string;
  internetPrice?: string;
  cost?: string;
  exteriorColor?: string;
  interiorColor?: string;
  description?: string;
  photos?: string[];
  floorplanImg?: string;
  features?: string[];
  // RV
  rvClass?: string;
  towableType?: string;
  lengthFt?: string;
  sleeps?: number;
  slideOuts?: number;
  gvwr?: number;
  dryWeight?: number;
  hitchWeight?: number;
  chassis?: string;
  freshTankGal?: number;
  greyTankGal?: number;
  blackTankGal?: number;
  generatorHours?: number;
  awnings?: number;
  // Powersports / motorized
  fuelType?: string;
  engineCc?: number;
  hours?: number;
  drivetrain?: string;
  mileage?: number;
  // Marine (boat / pwc)
  hin?: string;
  beamFt?: string;
  draftFt?: string;
  hullMaterial?: string;
  engineType?: string;
  engineCount?: number;
  engineHp?: number;
  fuelCapacityGal?: number;
  maxPersons?: number;
  trailerIncluded?: boolean;
}

const CATEGORIES = [
  { id: 'motorhome', label: 'Motorhome' },
  { id: 'towable', label: 'Towable' },
  { id: 'motorcycle', label: 'Motorcycle' },
  { id: 'atv', label: 'ATV' },
  { id: 'utv', label: 'UTV' },
  { id: 'sxs', label: 'Side-by-Side' },
  { id: 'pwc', label: 'PWC' },
  { id: 'snowmobile', label: 'Snowmobile' },
  { id: 'boat', label: 'Boat' },
];

const POWERSPORTS = new Set(['motorcycle', 'atv', 'utv', 'sxs', 'pwc', 'snowmobile', 'boat']);

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  sold: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-700',
  on_order: 'bg-blue-100 text-blue-700',
  in_service: 'bg-purple-100 text-purple-700',
};

function categoryLabel(id?: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label || id || '';
}

function price(u: Unit): string {
  const p = u.internetPrice || u.listedPrice || u.msrp;
  return p ? `$${Number(p).toLocaleString()}` : '—';
}

function keySpec(u: Unit): string {
  if (u.category === 'boat' || u.category === 'pwc') {
    const parts: string[] = [];
    if (u.lengthFt) parts.push(`${u.lengthFt} ft`);
    if (u.engineHp != null) parts.push(`${u.engineHp} hp`);
    if (u.hours != null) parts.push(`${u.hours} hrs`);
    return parts.join(' · ') || '—';
  }
  if (POWERSPORTS.has(u.category)) {
    const parts: string[] = [];
    if (u.engineCc) parts.push(`${u.engineCc}cc`);
    if (u.hours != null) parts.push(`${u.hours} hrs`);
    return parts.join(' · ') || '—';
  }
  const parts: string[] = [];
  if (u.lengthFt) parts.push(`${u.lengthFt} ft`);
  if (u.sleeps != null) parts.push(`sleeps ${u.sleeps}`);
  return parts.join(' · ') || '—';
}

export default function InventoryPage() {
  const { hasFeature } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [recallUnit, setRecallUnit] = useState<Unit | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [showFeedUrls, setShowFeedUrls] = useState<boolean>(false);

  const canRecall = hasFeature('recall_lookup');
  const canSyndicate = hasFeature('inventory_syndication');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, status]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (status) params.set('status', status);
      params.set('limit', '200');
      const res = await api.get(`/api/units?${params.toString()}`);
      setUnits(res.data || []);
    } catch (error) {
      console.error('Failed to load inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (u: Unit) => {
    if (!confirm(`Delete ${u.year || ''} ${u.make || ''} ${u.modelName || ''}?`)) return;
    try {
      await api.delete('/api/units', u.id);
      loadData();
    } catch {
      alert('Failed to delete unit');
    }
  };

  const exportFeed = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${api.baseUrl}/api/syndication/feed?format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory-feed.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export feed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Inventory</h1>
          <p className="text-gray-500 dark:text-slate-400">RV & powersports units</p>
        </div>
        <div className="flex items-center gap-2">
          {canSyndicate && (
            <>
              <button
                onClick={() => setShowFeedUrls(true)}
                className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                <Link2 className="w-4 h-4" />
                Feed URL
              </button>
              <button
                onClick={exportFeed}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'Exporting...' : 'Export Feed'}
              </button>
            </>
          )}
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            Add Unit
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search make, model, VIN, stock #..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-4 py-2 border rounded-lg">
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-4 py-2 border rounded-lg">
          <option value="">All Statuses</option>
          <option value="available">Available</option>
          <option value="pending">Pending</option>
          <option value="sold">Sold</option>
          <option value="on_order">On Order</option>
          <option value="in_service">In Service</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : units.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No units found</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {units.map((u) => (
            <div key={u.id} className="bg-white rounded-xl border overflow-hidden flex flex-col dark:bg-slate-900">
              {u.photos && u.photos.length > 0 ? (
                <img src={u.photos[0]} alt={u.modelName || 'Unit'} className="h-40 w-full object-cover" />
              ) : (
                <div className="h-40 w-full bg-gray-100 flex items-center justify-center dark:bg-slate-800">
                  <Caravan className="w-10 h-10 text-gray-300" />
                </div>
              )}
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                    <Tag className="w-3 h-3" /> {categoryLabel(u.category)}
                  </span>
                  {u.status && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[u.status] || 'bg-gray-100 text-gray-700'}`}>
                      {u.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="font-semibold text-gray-900 dark:text-slate-100">
                  {[u.year, u.make, u.modelName].filter(Boolean).join(' ') || 'Untitled Unit'}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 capitalize dark:text-slate-400">{u.condition || '—'}</span>
                  <span className="text-gray-500 dark:text-slate-400">{keySpec(u)}</span>
                </div>
                <div className="flex items-center gap-1 text-lg font-bold text-gray-900 dark:text-slate-100">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  {price(u).replace('$', '')}
                </div>
                <div className="mt-auto pt-2 flex items-center gap-2 border-t">
                  {canRecall && (
                    <button
                      onClick={() => setRecallUnit(u)}
                      className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800"
                    >
                      <ShieldAlert className="w-4 h-4" /> Check Recalls
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => { setEditing(u); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(u)} className="p-1 text-gray-400 hover:text-red-600" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <UnitFormModal
          unit={editing}
          onSave={() => { setShowForm(false); loadData(); }}
          onClose={() => setShowForm(false)}
        />
      )}

      {recallUnit && (
        <RecallModal unit={recallUnit} onClose={() => setRecallUnit(null)} />
      )}

      {showFeedUrls && (
        <FeedUrlModal onClose={() => setShowFeedUrls(false)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Syndication Feed URL Modal                                        */
/* ---------------------------------------------------------------- */

interface FeedUrls {
  csv?: string;
  json?: string;
  xml?: string;
}

function FeedUrlModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState<boolean>(true);
  const [rotating, setRotating] = useState<boolean>(false);
  const [urls, setUrls] = useState<FeedUrls>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/syndication/token');
      setUrls(res.urls || {});
    } catch (err) {
      setError((err as Error).message || 'Failed to load feed URLs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadToken();
  }, []);

  const rotate = async () => {
    if (!confirm('Rotate the syndication token? This invalidates the current URLs — any marketplace using them will stop pulling until you give them the new URLs.')) return;
    setRotating(true);
    setError(null);
    try {
      const res = await api.post('/api/syndication/token/rotate');
      setUrls(res.urls || {});
    } catch (err) {
      setError((err as Error).message || 'Failed to rotate token');
    } finally {
      setRotating(false);
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const rows: { key: keyof FeedUrls; label: string }[] = [
    { key: 'csv', label: 'CSV' },
    { key: 'json', label: 'JSON' },
    { key: 'xml', label: 'XML' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-orange-500" />
              Syndication Feed URLs
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <p className="text-sm text-gray-500 mb-4 dark:text-slate-400">
            Give these URLs to RV Trader / Cycle Trader / Boat Trader to auto-pull your inventory.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="py-6 text-center text-red-600">{error}</div>
          ) : (
            <div className="space-y-3">
              {rows.map(({ key, label }) => {
                const value = urls[key];
                if (!value) return null;
                return (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1 dark:text-slate-400">{label}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={value}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-700 dark:bg-slate-900 dark:text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => copy(key, value)}
                        title="Copy"
                        className="p-2 border rounded-lg hover:bg-gray-50"
                      >
                        {copied === key ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500 dark:text-slate-400" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-3 pt-5">
            <button
              type="button"
              onClick={rotate}
              disabled={rotating || loading}
              className="flex items-center justify-center gap-2 flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${rotating ? 'animate-spin' : ''}`} />
              {rotating ? 'Rotating...' : 'Rotate token'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Unit Form Modal — category-conditional fields                     */
/* ---------------------------------------------------------------- */

const SHARED_TEXT = ['stockNumber', 'vin', 'make', 'modelName', 'trim', 'exteriorColor', 'interiorColor', 'chassis'] as const;
const SHARED_NUM = ['year', 'mileage'] as const;
const SHARED_PRICE = ['msrp', 'listedPrice', 'internetPrice', 'cost'] as const;

interface UnitFormModalProps {
  unit: Unit | null;
  onSave: () => void;
  onClose: () => void;
}

function UnitFormModal({ unit, onSave, onClose }: UnitFormModalProps) {
  const [category, setCategory] = useState<string>(unit?.category || '');
  const [saving, setSaving] = useState<boolean>(false);
  // Keep every possible field in one form object; we filter on submit by category.
  const [form, setForm] = useState<Record<string, any>>(() => ({
    condition: unit?.condition || 'new',
    status: unit?.status || 'available',
    stockNumber: unit?.stockNumber || '',
    vin: unit?.vin || '',
    year: unit?.year ?? '',
    make: unit?.make || '',
    modelName: unit?.modelName || '',
    trim: unit?.trim || '',
    exteriorColor: unit?.exteriorColor || '',
    interiorColor: unit?.interiorColor || '',
    chassis: unit?.chassis || '',
    mileage: unit?.mileage ?? '',
    msrp: unit?.msrp || '',
    listedPrice: unit?.listedPrice || '',
    internetPrice: unit?.internetPrice || '',
    cost: unit?.cost || '',
    floorplanImg: unit?.floorplanImg || '',
    description: unit?.description || '',
    photos: (unit?.photos || []).join(', '),
    features: (unit?.features || []).join(', '),
    // RV / motorhome / towable
    rvClass: unit?.rvClass || '',
    towableType: unit?.towableType || '',
    lengthFt: unit?.lengthFt || '',
    sleeps: unit?.sleeps ?? '',
    slideOuts: unit?.slideOuts ?? '',
    gvwr: unit?.gvwr ?? '',
    dryWeight: unit?.dryWeight ?? '',
    hitchWeight: unit?.hitchWeight ?? '',
    freshTankGal: unit?.freshTankGal ?? '',
    greyTankGal: unit?.greyTankGal ?? '',
    blackTankGal: unit?.blackTankGal ?? '',
    generatorHours: unit?.generatorHours ?? '',
    awnings: unit?.awnings ?? '',
    fuelType: unit?.fuelType || '',
    // powersports
    engineCc: unit?.engineCc ?? '',
    hours: unit?.hours ?? '',
    drivetrain: unit?.drivetrain || '',
    // marine (boat / pwc)
    hin: unit?.hin || '',
    beamFt: unit?.beamFt || '',
    draftFt: unit?.draftFt || '',
    hullMaterial: unit?.hullMaterial || '',
    engineType: unit?.engineType || '',
    engineCount: unit?.engineCount ?? '',
    engineHp: unit?.engineHp ?? '',
    fuelCapacityGal: unit?.fuelCapacityGal ?? '',
    maxPersons: unit?.maxPersons ?? '',
    trailerIncluded: unit?.trailerIncluded ?? false,
  }));

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Which category-specific keys to send.
  const categoryKeys = (cat: string): string[] => {
    if (cat === 'motorhome') {
      return ['rvClass', 'lengthFt', 'sleeps', 'slideOuts', 'gvwr', 'dryWeight', 'chassis', 'mileage', 'fuelType', 'generatorHours', 'freshTankGal', 'greyTankGal', 'blackTankGal', 'awnings'];
    }
    if (cat === 'towable') {
      return ['towableType', 'lengthFt', 'sleeps', 'slideOuts', 'dryWeight', 'gvwr', 'hitchWeight', 'freshTankGal', 'greyTankGal', 'blackTankGal', 'awnings'];
    }
    if (cat === 'boat') {
      return ['hin', 'lengthFt', 'beamFt', 'draftFt', 'hullMaterial', 'engineType', 'engineCount', 'engineHp', 'hours', 'fuelType', 'fuelCapacityGal', 'maxPersons', 'trailerIncluded'];
    }
    if (cat === 'pwc') {
      return ['engineHp', 'hours', 'fuelCapacityGal', 'maxPersons', 'hullMaterial'];
    }
    // powersports
    const keys = ['engineCc', 'hours', 'fuelType'];
    if (cat === 'utv' || cat === 'sxs') keys.push('drivetrain');
    if (cat === 'motorcycle') keys.push('mileage');
    return keys;
  };

  const NUMERIC = new Set(['year', 'mileage', 'sleeps', 'slideOuts', 'gvwr', 'dryWeight', 'hitchWeight', 'freshTankGal', 'greyTankGal', 'blackTankGal', 'generatorHours', 'awnings', 'engineCc', 'hours', 'beamFt', 'draftFt', 'engineCount', 'engineHp', 'fuelCapacityGal', 'maxPersons']);
  const BOOLEAN = new Set(['trailerIncluded']);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!category) { alert('Category is required'); return; }
    setSaving(true);

    // Build payload: shared fields + only the chosen category's fields.
    const payload: Record<string, any> = { category };
    const addField = (k: string) => {
      const raw = form[k];
      if (BOOLEAN.has(k)) { payload[k] = Boolean(raw); return; }
      if (raw === '' || raw == null) return;
      payload[k] = NUMERIC.has(k) ? Number(raw) : raw;
    };

    [...SHARED_TEXT, ...SHARED_NUM, ...SHARED_PRICE].forEach((k) => {
      // mileage is category-conditional for powersports but always shared for RV; include here only if not powersports-handled
      if (k === 'mileage' && POWERSPORTS.has(category) && category !== 'motorcycle') return;
      addField(k);
    });
    payload.condition = form.condition || undefined;
    payload.status = form.status || 'available';
    if (form.description) payload.description = form.description;
    if (form.floorplanImg) payload.floorplanImg = form.floorplanImg;
    const photos = String(form.photos || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (photos.length) payload.photos = photos;
    const features = String(form.features || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (features.length) payload.features = features;

    categoryKeys(category).forEach(addField);

    try {
      if (unit) {
        await api.put(`/api/units/${unit.id}`, payload);
      } else {
        await api.post('/api/units', payload);
      }
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save unit');
    } finally {
      setSaving(false);
    }
  };

  const numField = (k: string, label: string, step?: string) => (
    <div key={k}>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      <input
        type="number"
        step={step}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
    </div>
  );

  const textField = (k: string, label: string) => (
    <div key={k}>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      <input
        type="text"
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
    </div>
  );

  const selectField = (k: string, label: string, opts: { value: string; label: string }[]) => (
    <div key={k}>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{label}</label>
      <select value={form[k]} onChange={(e) => set(k, e.target.value)} className="w-full px-3 py-2 border rounded-lg">
        <option value="">—</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const checkboxField = (k: string, label: string) => (
    <div key={k} className="flex items-center gap-2 pt-7">
      <input
        id={`field-${k}`}
        type="checkbox"
        checked={Boolean(form[k])}
        onChange={(e) => set(k, e.target.checked)}
        className="w-4 h-4"
      />
      <label htmlFor={`field-${k}`} className="text-sm font-medium text-gray-700 dark:text-slate-200">{label}</label>
    </div>
  );

  const HULL_MATERIALS = [
    { value: 'fiberglass', label: 'Fiberglass' },
    { value: 'aluminum', label: 'Aluminum' },
    { value: 'wood', label: 'Wood' },
    { value: 'inflatable', label: 'Inflatable' },
    { value: 'composite', label: 'Composite' },
  ];
  const ENGINE_TYPES = [
    { value: 'outboard', label: 'Outboard' },
    { value: 'inboard', label: 'Inboard' },
    { value: 'sterndrive', label: 'Sterndrive' },
    { value: 'jet', label: 'Jet' },
    { value: 'none', label: 'None' },
  ];

  const renderCategoryFields = () => {
    if (category === 'boat') {
      return (
        <>
          {textField('hin', 'Hull ID Number (HIN)')}
          {textField('lengthFt', 'Length (ft)')}
          {numField('beamFt', 'Beam (ft)', 'any')}
          {numField('draftFt', 'Draft (ft)', 'any')}
          {selectField('hullMaterial', 'Hull Material', HULL_MATERIALS)}
          {selectField('engineType', 'Engine Type', ENGINE_TYPES)}
          {numField('engineCount', 'Engine Count')}
          {numField('engineHp', 'Total HP')}
          {numField('hours', 'Hours')}
          {textField('fuelType', 'Fuel Type')}
          {numField('fuelCapacityGal', 'Fuel Capacity (gal)')}
          {numField('maxPersons', 'Max persons (USCG)')}
          {checkboxField('trailerIncluded', 'Trailer Included')}
        </>
      );
    }
    if (category === 'pwc') {
      return (
        <>
          {numField('engineHp', 'Total HP')}
          {numField('hours', 'Hours')}
          {numField('fuelCapacityGal', 'Fuel Capacity (gal)')}
          {numField('maxPersons', 'Max persons (USCG)')}
          {selectField('hullMaterial', 'Hull Material', HULL_MATERIALS)}
        </>
      );
    }
    if (category === 'motorhome') {
      return (
        <>
          {selectField('rvClass', 'RV Class', [
            { value: 'A', label: 'Class A' }, { value: 'B', label: 'Class B' },
            { value: 'B+', label: 'Class B+' }, { value: 'C', label: 'Class C' },
            { value: 'super_c', label: 'Super C' },
          ])}
          {textField('lengthFt', 'Length (ft)')}
          {numField('sleeps', 'Sleeps')}
          {numField('slideOuts', 'Slide-Outs')}
          {numField('gvwr', 'GVWR (lbs)')}
          {numField('dryWeight', 'Dry Weight (lbs)')}
          {textField('chassis', 'Chassis')}
          {numField('mileage', 'Mileage')}
          {textField('fuelType', 'Fuel Type')}
          {numField('generatorHours', 'Generator Hours')}
          {numField('freshTankGal', 'Fresh Tank (gal)')}
          {numField('greyTankGal', 'Grey Tank (gal)')}
          {numField('blackTankGal', 'Black Tank (gal)')}
          {numField('awnings', 'Awnings')}
        </>
      );
    }
    if (category === 'towable') {
      return (
        <>
          {selectField('towableType', 'Towable Type', [
            { value: 'travel_trailer', label: 'Travel Trailer' },
            { value: 'fifth_wheel', label: 'Fifth Wheel' },
            { value: 'toy_hauler', label: 'Toy Hauler' },
            { value: 'pop_up', label: 'Pop-Up' },
            { value: 'teardrop', label: 'Teardrop' },
            { value: 'destination', label: 'Destination' },
          ])}
          {textField('lengthFt', 'Length (ft)')}
          {numField('sleeps', 'Sleeps')}
          {numField('slideOuts', 'Slide-Outs')}
          {numField('dryWeight', 'Dry Weight (lbs)')}
          {numField('gvwr', 'GVWR (lbs)')}
          {numField('hitchWeight', 'Hitch Weight (lbs)')}
          {numField('freshTankGal', 'Fresh Tank (gal)')}
          {numField('greyTankGal', 'Grey Tank (gal)')}
          {numField('blackTankGal', 'Black Tank (gal)')}
          {numField('awnings', 'Awnings')}
        </>
      );
    }
    if (POWERSPORTS.has(category)) {
      return (
        <>
          {numField('engineCc', 'Engine (cc)')}
          {numField('hours', 'Hours')}
          {textField('fuelType', 'Fuel Type')}
          {(category === 'utv' || category === 'sxs') &&
            selectField('drivetrain', 'Drivetrain', [
              { value: '2wd', label: '2WD' }, { value: '4wd', label: '4WD' }, { value: 'awd', label: 'AWD' },
            ])}
          {category === 'motorcycle' && numField('mileage', 'Mileage')}
        </>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{unit ? 'Edit Unit' : 'Add Unit'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Category — required, drives the form */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Category <span className="text-red-500">*</span></label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
              </select>
            </div>

            {/* Shared identity */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {selectField('condition', 'Condition', [
                { value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'consignment', label: 'Consignment' },
              ])}
              {textField('stockNumber', 'Stock #')}
              {textField('vin', 'VIN')}
              {numField('year', 'Year')}
              {textField('make', 'Make')}
              {textField('modelName', 'Model')}
              {textField('trim', 'Trim')}
              {/* Same order as the Inventory status filter (L-05) */}
              {selectField('status', 'Status', [
                { value: 'available', label: 'Available' }, { value: 'pending', label: 'Pending' },
                { value: 'sold', label: 'Sold' }, { value: 'on_order', label: 'On Order' },
                { value: 'in_service', label: 'In Service' },
              ])}
              {textField('exteriorColor', 'Exterior Color')}
              {textField('interiorColor', 'Interior Color')}
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {textField('msrp', 'MSRP')}
              {textField('listedPrice', 'Listed Price')}
              {textField('internetPrice', 'Internet Price')}
              {textField('cost', 'Cost')}
            </div>

            {/* Category-specific */}
            {category && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2 dark:text-slate-200">{categoryLabel(category)} Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderCategoryFields()}
                </div>
              </div>
            )}

            {/* Media + description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {textField('floorplanImg', 'Floorplan Image URL')}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Photo URLs (comma-separated)</label>
                <input type="text" value={form.photos} onChange={(e) => set('photos', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Features (comma-separated)</label>
              <input type="text" value={form.features} onChange={(e) => set('features', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Unit'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Recall Modal                                                      */
/* ---------------------------------------------------------------- */

interface Recall {
  campaignNumber?: string | null;
  component?: string | null;
  summary?: string | null;
  consequence?: string | null;
  remedy?: string | null;
}

interface RecallModalProps {
  unit: Unit;
  onClose: () => void;
}

function RecallModal({ unit, onClose }: RecallModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [count, setCount] = useState<number>(0);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/api/recalls/unit/${unit.id}`);
        setRecalls(res.recalls || []);
        setCount(res.count ?? (res.recalls?.length || 0));
        setNote(res.note || null);
        setSource(res.source || null);
      } catch (err) {
        setError((err as Error).message || 'Recall lookup failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [unit.id]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              Recalls — {[unit.year, unit.make, unit.modelName].filter(Boolean).join(' ')}
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="py-6 text-center text-red-600">{error}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                {count > 0 ? (
                  <p className="text-sm font-medium text-amber-700">{count} open recall{count === 1 ? '' : 's'} found</p>
                ) : (
                  <p className="text-sm font-medium text-green-700">No open recalls</p>
                )}
                {source && (
                  <span className="inline-flex items-center text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full dark:text-slate-400 dark:bg-slate-800">
                    Source: {source}
                  </span>
                )}
              </div>
              {note && (
                <p className="text-sm text-gray-500 bg-gray-50 border rounded-lg p-3 dark:text-slate-400 dark:bg-slate-900">{note}</p>
              )}
              {recalls.map((r, i) => (
                <div key={r.campaignNumber || i} className="border rounded-lg p-3 space-y-1">
                  {r.component && <p className="font-medium text-gray-900 dark:text-slate-100">{r.component}</p>}
                  {r.campaignNumber && <p className="text-xs text-gray-400">{r.campaignNumber}</p>}
                  {r.summary && <p className="text-sm text-gray-600 dark:text-slate-400"><span className="font-medium">Summary:</span> {r.summary}</p>}
                  {r.remedy && <p className="text-sm text-gray-600 dark:text-slate-400"><span className="font-medium">Remedy:</span> {r.remedy}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="pt-5">
            <button onClick={onClose} className="w-full px-4 py-2 border rounded-lg hover:bg-gray-50">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
