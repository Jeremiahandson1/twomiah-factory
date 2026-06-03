import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Eye, SlidersHorizontal, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

interface Material {
  id: string;
  name: string;
  brand: string;
  category: string;
  color?: string;
  _hidden?: boolean;
}

type Tab = 'visualizer' | 'products';

export default function VisualizerPage() {
  const { hasFeature } = useAuth();
  const enabled = hasFeature('visualizer');

  const [tab, setTab] = useState<Tab>('visualizer');
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(false);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [openBrands, setOpenBrands] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!enabled) return;
    api.get('/api/visualizer/embed-url')
      .then((r) => { setConfigured(!!r?.configured); setEmbedUrl(r?.url || null); })
      .catch(() => setConfigured(false));
  }, [enabled]);

  const loadMaterials = useCallback(async () => {
    setLoadingMats(true);
    try {
      const r = await api.get('/api/visualizer/materials');
      setMaterials(Array.isArray(r?.builtin) ? r.builtin : []);
    } catch {
      setMaterials([]);
    } finally {
      setLoadingMats(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && tab === 'products' && materials.length === 0) loadMaterials();
  }, [enabled, tab, materials.length, loadMaterials]);

  if (!enabled) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-4">
        <p className="text-gray-500 dark:text-slate-400">The Exterior Visualizer add-on is not included in your plan.</p>
        <a href="https://twomiah.com/vision" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1">
          Learn more <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    );
  }

  // Group: category -> brand -> materials
  const byCat: Record<string, Record<string, Material[]>> = {};
  for (const m of materials) {
    const cat = m.category || 'other';
    const brand = m.brand || 'Other';
    (byCat[cat] ||= {});
    (byCat[cat][brand] ||= []).push(m);
  }

  const setHidden = (ids: string[], hidden: boolean) => {
    setMaterials((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, _hidden: hidden } : m)));
  };

  const toggleProduct = async (m: Material) => {
    const action = m._hidden ? 'show' : 'hide';
    setBusy((b) => ({ ...b, [m.id]: true }));
    setHidden([m.id], !m._hidden);
    try {
      await api.put('/api/visualizer/materials', { action, material_key: m.id });
    } catch {
      setHidden([m.id], !!m._hidden); // revert
    } finally {
      setBusy((b) => ({ ...b, [m.id]: false }));
    }
  };

  const toggleBrand = async (brandKey: string, items: Material[]) => {
    const allHidden = items.every((m) => m._hidden);
    const ids = items.map((m) => m.id);
    setBusy((b) => ({ ...b, [brandKey]: true }));
    setHidden(ids, !allHidden);
    try {
      await api.post('/api/visualizer/materials/bulk', allHidden ? { show: ids } : { hide: ids });
    } catch {
      setHidden(ids, allHidden); // revert
    } finally {
      setBusy((b) => ({ ...b, [brandKey]: false }));
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Exterior Visualizer</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          Show customers their home with new materials — and control exactly which brands and products appear in your visualizer.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700 mb-5">
        {([['visualizer', 'Visualizer', Eye], ['products', 'Products', SlidersHorizontal]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'visualizer' && (
        <>
          {configured === null && (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {configured === false && (
            <div className="max-w-2xl mx-auto py-12 text-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Visualizer Not Configured</h2>
              <p className="text-gray-500 dark:text-slate-400">
                Your Exterior Visualizer add-on is enabled but hasn't finished setup yet. Contact support if this persists.
              </p>
            </div>
          )}
          {configured && embedUrl && (
            <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700" style={{ height: 'calc(100vh - 16rem)' }}>
              <iframe src={embedUrl} className="w-full h-full border-0" allow="camera" title="Exterior Visualizer" />
            </div>
          )}
        </>
      )}

      {tab === 'products' && (
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            Toggle brands or individual products off to hide them from your visualizer. Changes apply instantly.
          </p>
          {loadingMats && (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loadingMats && materials.length === 0 && (
            <p className="text-gray-500 dark:text-slate-400 py-8 text-center">
              No products available. The visualizer may not be configured yet.
            </p>
          )}
          {!loadingMats && Object.keys(byCat).sort().map((cat) => {
            const brands = byCat[cat];
            const catOpen = openCats[cat] ?? false;
            return (
              <div key={cat} className="mb-3 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenCats((s) => ({ ...s, [cat]: !catOpen }))}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/60 hover:bg-gray-100 dark:hover:bg-slate-800"
                >
                  <span className="font-semibold capitalize text-gray-900 dark:text-white">{cat}</span>
                  <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${catOpen ? 'rotate-90' : ''}`} />
                </button>
                {catOpen && (
                  <div className="divide-y divide-gray-100 dark:divide-slate-800">
                    {Object.keys(brands).sort().map((brand) => {
                      const items = brands[brand];
                      const brandKey = `${cat}::${brand}`;
                      const allHidden = items.every((m) => m._hidden);
                      const someHidden = items.some((m) => m._hidden);
                      const brandOpen = openBrands[brandKey] ?? false;
                      return (
                        <div key={brandKey}>
                          <div className="flex items-center justify-between px-4 py-2.5">
                            <button
                              onClick={() => setOpenBrands((s) => ({ ...s, [brandKey]: !brandOpen }))}
                              className="flex items-center gap-2 text-left flex-1 min-w-0"
                            >
                              <ChevronRight className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform ${brandOpen ? 'rotate-90' : ''}`} />
                              <span className="font-medium text-gray-800 dark:text-slate-200 truncate">{brand}</span>
                              <span className="text-xs text-gray-400">
                                ({items.length}{someHidden ? `, ${items.filter((m) => m._hidden).length} hidden` : ''})
                              </span>
                            </button>
                            <button
                              onClick={() => toggleBrand(brandKey, items)}
                              disabled={busy[brandKey]}
                              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
                                allHidden
                                  ? 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                                  : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                              }`}
                            >
                              {busy[brandKey] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : allHidden ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                              {allHidden ? 'Hidden' : 'Shown'}
                            </button>
                          </div>
                          {brandOpen && (
                            <div className="pl-10 pr-4 pb-2 space-y-1">
                              {items.map((m) => (
                                <div key={m.id} className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {m.color && <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-slate-600 flex-shrink-0" style={{ background: m.color }} />}
                                    <span className={`text-sm truncate ${m._hidden ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-slate-300'}`}>{m.name}</span>
                                  </div>
                                  <button
                                    onClick={() => toggleProduct(m)}
                                    disabled={busy[m.id]}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                                      m._hidden
                                        ? 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                                        : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                                    }`}
                                  >
                                    {busy[m.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : m._hidden ? 'Hidden' : 'Shown'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
