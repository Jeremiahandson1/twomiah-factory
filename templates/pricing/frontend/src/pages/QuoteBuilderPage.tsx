import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';
import CategoryGrid from '../components/quote/CategoryGrid';
import ProductGrid from '../components/quote/ProductGrid';
import MeasurementInput from '../components/quote/MeasurementInput';
import TierSelector from '../components/quote/TierSelector';
import AddonCard from '../components/quote/AddonCard';
import PriceFooter from '../components/quote/PriceFooter';
import RepAdjustPanel from '../components/quote/RepAdjustPanel';

/* ─── Types ─── */

interface Category {
  id: string;
  name: string;
  icon?: string;
  product_count?: number;
}

interface Product {
  id: string;
  name: string;
  image_url?: string;
  measurement_type: string;
  measurement_unit: string;
}

interface PriceRange {
  min: number;
  max: number;
  good: number;
  better: number;
  best: number;
}

interface Addon {
  id: string;
  name: string;
  price: number;
  price_type: 'flat' | 'per_unit';
  image_url?: string;
  required?: boolean;
  depends_on?: string;
  group?: string;
}

interface QuoteLine {
  id: string;
  product: Product;
  measurement: number;
  tier: 'good' | 'better' | 'best';
  tierPrices: { good: number; better: number; best: number };
  addons: Record<string, { active: boolean; quantity: number }>;
  addonList: Addon[];
  priceRanges: PriceRange[];
  quantity: number;
  linePrice: number;
}

interface QuoteData {
  id: string;
  customer_name: string;
  status: string;
  discount?: number;
  max_discount_percent?: number;
}

/* ─── Reducer ─── */

type LineAction =
  | { type: 'ADD_LINE'; line: QuoteLine }
  | { type: 'REMOVE_LINE'; lineId: string }
  | { type: 'SET_MEASUREMENT'; lineId: string; value: number; tierPrices: { good: number; better: number; best: number } }
  | { type: 'SET_TIER'; lineId: string; tier: 'good' | 'better' | 'best' }
  | { type: 'TOGGLE_ADDON'; lineId: string; addonId: string }
  | { type: 'SET_ADDON_QTY'; lineId: string; addonId: string; qty: number }
  | { type: 'SET_QUANTITY'; lineId: string; qty: number }
  | { type: 'SET_LINES'; lines: QuoteLine[] };

function calcLinePrice(line: QuoteLine): number {
  const basePrice = line.tierPrices[line.tier] * line.quantity;
  let addonTotal = 0;
  for (const addon of line.addonList) {
    const state = line.addons[addon.id];
    if (state?.active) {
      if (addon.price_type === 'flat') {
        addonTotal += addon.price;
      } else {
        addonTotal += addon.price * (state.quantity || 1);
      }
    }
  }
  return basePrice + addonTotal * line.quantity;
}

function linesReducer(state: QuoteLine[], action: LineAction): QuoteLine[] {
  switch (action.type) {
    case 'ADD_LINE':
      return [...state, { ...action.line, linePrice: calcLinePrice(action.line) }];
    case 'REMOVE_LINE':
      return state.filter((l) => l.id !== action.lineId);
    case 'SET_MEASUREMENT': {
      return state.map((l) => {
        if (l.id !== action.lineId) return l;
        const updated = { ...l, measurement: action.value, tierPrices: action.tierPrices };
        updated.linePrice = calcLinePrice(updated);
        return updated;
      });
    }
    case 'SET_TIER': {
      return state.map((l) => {
        if (l.id !== action.lineId) return l;
        const updated = { ...l, tier: action.tier };
        updated.linePrice = calcLinePrice(updated);
        return updated;
      });
    }
    case 'TOGGLE_ADDON': {
      return state.map((l) => {
        if (l.id !== action.lineId) return l;
        const current = l.addons[action.addonId] || { active: false, quantity: 1 };
        const updated = {
          ...l,
          addons: { ...l.addons, [action.addonId]: { ...current, active: !current.active } },
        };
        updated.linePrice = calcLinePrice(updated);
        return updated;
      });
    }
    case 'SET_ADDON_QTY': {
      return state.map((l) => {
        if (l.id !== action.lineId) return l;
        const current = l.addons[action.addonId] || { active: true, quantity: 1 };
        const updated = {
          ...l,
          addons: { ...l.addons, [action.addonId]: { ...current, quantity: action.qty } },
        };
        updated.linePrice = calcLinePrice(updated);
        return updated;
      });
    }
    case 'SET_QUANTITY': {
      return state.map((l) => {
        if (l.id !== action.lineId) return l;
        const updated = { ...l, quantity: Math.max(1, action.qty) };
        updated.linePrice = calcLinePrice(updated);
        return updated;
      });
    }
    case 'SET_LINES':
      return action.lines;
    default:
      return state;
  }
}

/* ─── Helpers ─── */

function lookupTierPrices(ranges: PriceRange[], measurement: number) {
  const range = ranges.find((r) => measurement >= r.min && measurement <= r.max);
  if (!range) return { good: 0, better: 0, best: 0 };
  return { good: range.good, better: range.better, best: range.best };
}

let lineIdCounter = 0;
function nextLineId() {
  lineIdCounter += 1;
  return `line-${lineIdCounter}-${Date.now()}`;
}

/* ─── Component ─── */

export default function QuoteBuilderPage() {
  const { id: quoteId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [lines, dispatch] = useReducer(linesReducer, []);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(true);
  const [adjustPanelOpen, setAdjustPanelOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load quote
  useEffect(() => {
    if (!quoteId) return;
    const load = async () => {
      try {
        const res = await api.get(`/api/quotes/${quoteId}`);
        setQuote(res.data);
      } catch (err) {
        console.error('Failed to load quote', err);
      }
    };
    load();
  }, [quoteId]);

  // Load products when category changes
  useEffect(() => {
    if (!selectedCategory) {
      setCategoryProducts([]);
      return;
    }
    const load = async () => {
      setProductsLoading(true);
      try {
        const res = await api.get(`/api/pricebook/categories/${selectedCategory.id}/products`);
        setCategoryProducts(res.data);
      } catch (err) {
        console.error('Failed to load products', err);
      } finally {
        setProductsLoading(false);
      }
    };
    load();
  }, [selectedCategory]);

  // Auto-save lines to server (debounced)
  useEffect(() => {
    if (!quoteId || lines.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.put(`/api/quotes/${quoteId}/lines`, {
          lines: lines.map((l) => ({
            product_id: l.product.id,
            measurement: l.measurement,
            tier: l.tier,
            quantity: l.quantity,
            addons: Object.entries(l.addons)
              .filter(([, v]) => v.active)
              .map(([addonId, v]) => ({ addon_id: addonId, quantity: v.quantity })),
          })),
        });
      } catch (err) {
        console.error('Failed to save lines', err);
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [lines, quoteId]);

  // 3-finger tap to open adjust panel
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        setAdjustPanelOpen(true);
      }
    };
    document.addEventListener('touchstart', handler, { passive: false });
    return () => document.removeEventListener('touchstart', handler);
  }, []);

  // Add product to quote
  const handleAddProduct = useCallback(async (product: Product) => {
    try {
      const [rangesRes, addonsRes] = await Promise.all([
        api.get(`/api/pricebook/products/${product.id}/prices`),
        api.get(`/api/pricebook/products/${product.id}/addons`),
      ]);
      const priceRanges: PriceRange[] = rangesRes.data;
      const addonList: Addon[] = addonsRes.data;

      const defaultMeasurement = priceRanges.length > 0 ? priceRanges[0].min : 0;
      const tierPrices = lookupTierPrices(priceRanges, defaultMeasurement);

      const addonState: Record<string, { active: boolean; quantity: number }> = {};
      for (const addon of addonList) {
        addonState[addon.id] = { active: !!addon.required, quantity: 1 };
      }

      dispatch({
        type: 'ADD_LINE',
        line: {
          id: nextLineId(),
          product,
          measurement: defaultMeasurement,
          tier: 'best',
          tierPrices,
          addons: addonState,
          addonList,
          priceRanges,
          quantity: 1,
          linePrice: 0,
        },
      });
      setShowProductPicker(false);
    } catch (err) {
      console.error('Failed to load product data', err);
    }
  }, []);

  const handleMeasurementChange = (lineId: string, priceRanges: PriceRange[], value: number) => {
    const tierPrices = lookupTierPrices(priceRanges, value);
    dispatch({ type: 'SET_MEASUREMENT', lineId, value, tierPrices });
  };

  const subtotal = lines.reduce((sum, l) => sum + l.linePrice, 0);
  const discount = quote?.discount || 0;
  const total = subtotal - discount;

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{quote?.customer_name || 'Loading...'}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-gray-500">Quote #{quoteId}</span>
              {quote?.status && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded-full uppercase">
                  {quote.status}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>Step 2 of 3</span>
        </div>
      </div>

      <div className="flex gap-6 p-6 max-w-7xl mx-auto">
        {/* Left panel: product picker */}
        {showProductPicker && (
          <div className="w-80 flex-shrink-0 space-y-4">
            <h2 className="text-lg font-bold text-gray-800">
              {selectedCategory ? selectedCategory.name : 'Categories'}
            </h2>
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory(null)}
                className="text-sm text-blue-600 font-medium hover:underline mb-2"
              >
                &larr; All Categories
              </button>
            )}
            {!selectedCategory ? (
              <CategoryGrid
                selectedId={null}
                onSelect={(cat) => setSelectedCategory(cat)}
              />
            ) : (
              <ProductGrid
                products={categoryProducts}
                loading={productsLoading}
                onSelect={handleAddProduct}
              />
            )}
          </div>
        )}

        {/* Main area: configured lines */}
        <div className="flex-1 space-y-6">
          {!showProductPicker && lines.length > 0 && (
            <button
              onClick={() => { setShowProductPicker(true); setSelectedCategory(null); }}
              className="text-blue-600 font-semibold hover:underline text-sm"
            >
              &larr; Back to product picker
            </button>
          )}

          {lines.length === 0 && !showProductPicker && (
            <div className="text-center py-20 text-gray-400">
              <p className="text-xl">No products added yet</p>
              <button
                onClick={() => setShowProductPicker(true)}
                className="mt-4 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 min-h-[48px]"
              >
                Add a Product
              </button>
            </div>
          )}

          {lines.map((line) => (
            <div key={line.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Line header */}
              <div className="flex items-center gap-4 p-5 border-b border-gray-100">
                {line.product.image_url ? (
                  <img src={line.product.image_url} alt="" className="w-16 h-16 rounded-xl object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center">
                    <span className="text-2xl text-gray-300">&#9632;</span>
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900">{line.product.name}</h3>
                  <p className="text-sm text-gray-500">{line.product.measurement_unit}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">{fmt(line.linePrice)}</p>
                  <p className="text-xs text-gray-400">line subtotal</p>
                </div>
                <button
                  onClick={() => dispatch({ type: 'REMOVE_LINE', lineId: line.id })}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              <div className="p-5 space-y-6">
                {/* Measurement */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Measurement</label>
                  <MeasurementInput
                    value={line.measurement}
                    onChange={(v) => handleMeasurementChange(line.id, line.priceRanges, v)}
                    unit={line.product.measurement_unit}
                  />
                </div>

                {/* Tier selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Select Tier</label>
                  <TierSelector
                    prices={line.tierPrices}
                    selected={line.tier}
                    onChange={(tier) => dispatch({ type: 'SET_TIER', lineId: line.id, tier })}
                  />
                </div>

                {/* Addons */}
                {line.addonList.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Add-ons</label>
                    <div className="grid grid-cols-3 gap-3">
                      {line.addonList.map((addon) => {
                        const depMet = !addon.depends_on || line.addons[addon.depends_on]?.active;
                        const state = line.addons[addon.id] || { active: false, quantity: 1 };
                        return (
                          <AddonCard
                            key={addon.id}
                            addon={addon}
                            active={state.active}
                            quantity={state.quantity}
                            disabled={!depMet}
                            onToggle={() => dispatch({ type: 'TOGGLE_ADDON', lineId: line.id, addonId: addon.id })}
                            onQuantityChange={(qty) => dispatch({ type: 'SET_ADDON_QTY', lineId: line.id, addonId: addon.id, qty })}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quantity */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-semibold text-gray-600">Quantity</label>
                  <div className="flex items-center gap-0">
                    <button
                      onClick={() => dispatch({ type: 'SET_QUANTITY', lineId: line.id, qty: line.quantity - 1 })}
                      className="w-12 h-12 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-l-xl text-xl font-bold"
                    >
                      &minus;
                    </button>
                    <span className="w-14 h-12 flex items-center justify-center bg-white border-t-2 border-b-2 border-gray-200 text-xl font-bold">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => dispatch({ type: 'SET_QUANTITY', lineId: line.id, qty: line.quantity + 1 })}
                      className="w-12 h-12 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-r-xl text-xl font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <PriceFooter
        lineCount={lines.length}
        subtotal={subtotal}
        discount={discount}
        total={total}
        onAddProduct={() => { setShowProductPicker(true); setSelectedCategory(null); }}
        onPresent={() => navigate(`/quote/${quoteId}/present`)}
        canPresent={lines.length > 0}
      />

      {/* Rep Adjust Panel */}
      <RepAdjustPanel
        quoteId={quoteId || ''}
        currentPrice={total}
        maxDiscountPercent={quote?.max_discount_percent || 15}
        open={adjustPanelOpen}
        onClose={() => setAdjustPanelOpen(false)}
        onApplied={(newPrice) => {
          setQuote((prev) => prev ? { ...prev, discount: total - newPrice } : prev);
        }}
      />
    </div>
  );
}
