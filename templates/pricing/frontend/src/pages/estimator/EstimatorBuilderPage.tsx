import React, { useEffect, useReducer, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import MeasurementInputCard, { MeasurementData, Addon } from '../../components/quote/MeasurementInputCard';
import EstimateBreakdown from '../../components/quote/EstimateBreakdown';

type Tier = 'good' | 'better' | 'best';
type PriceColumn = 'retail' | 'yr1' | 'day30' | 'today';

interface Product {
  id: string;
  name: string;
  category: string;
  measurementUnit: string;
  pitchAdjustable: boolean;
  defaultWasteFactor: number;
  laborRate: number;
  addons: Addon[];
  tiers: Record<Tier, {
    name: string;
    costPerUnit: number;
    manufacturer: string;
    productLine: string;
    warrantyYears: number;
    features: string[];
  }>;
}

interface CategoryGroup {
  category: string;
  products: Product[];
}

interface EstimateLine {
  productId: string;
  measurement: number;
  pitch: string | null;
  pitchMultiplier: number;
  wasteFactor: number;
  selectedAddons: string[];
}

interface Estimate {
  id: string;
  customerName: string;
  status: 'draft' | 'calculated' | 'presented' | 'signed';
  lines: EstimateLine[];
  calculatedLines?: any[];
}

type Action =
  | { type: 'SET_LINES'; lines: EstimateLine[] }
  | { type: 'UPDATE_LINE'; data: MeasurementData }
  | { type: 'ADD_PRODUCT'; productId: string }
  | { type: 'REMOVE_PRODUCT'; productId: string };

function linesReducer(state: EstimateLine[], action: Action): EstimateLine[] {
  switch (action.type) {
    case 'SET_LINES':
      return action.lines;
    case 'UPDATE_LINE':
      return state.map(l =>
        l.productId === action.data.productId
          ? { ...l, ...action.data }
          : l
      );
    case 'ADD_PRODUCT':
      if (state.find(l => l.productId === action.productId)) return state;
      return [...state, {
        productId: action.productId,
        measurement: 0,
        pitch: null,
        pitchMultiplier: 1,
        wasteFactor: 1.15,
        selectedAddons: [],
      }];
    case 'REMOVE_PRODUCT':
      return state.filter(l => l.productId !== action.productId);
    default:
      return state;
  }
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
  calculated: { label: 'Calculated', className: 'bg-blue-100 text-blue-700' },
  presented: { label: 'Presented', className: 'bg-purple-100 text-purple-700' },
  signed: { label: 'Signed', className: 'bg-green-100 text-green-700' },
};

export default function EstimatorBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [lines, dispatch] = useReducer(linesReducer, []);
  const [selectedTier, setSelectedTier] = useState<Tier>('better');
  const [revealedColumns, setRevealedColumns] = useState<PriceColumn[]>(['retail']);
  const [calculating, setCalculating] = useState(false);
  const [calculated, setCalculated] = useState(false);
  const [calculatedData, setCalculatedData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'rep' | 'manager' | 'admin'>('rep');
  const [savingTimeout, setSavingTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [estRes, prodRes, roleRes] = await Promise.all([
          api.get(`/api/estimator/estimates/${id}`),
          api.get('/api/estimator/products'),
          api.get('/api/auth/me').catch(() => ({ data: { role: 'rep' } })),
        ]);
        setEstimate(estRes.data);
        setCategories(prodRes.data);
        setUserRole(roleRes.data.role || 'rep');
        if (estRes.data.lines?.length > 0) {
          dispatch({ type: 'SET_LINES', lines: estRes.data.lines });
        }
        if (estRes.data.calculatedLines) {
          setCalculatedData(estRes.data.calculatedLines);
          setCalculated(true);
          setRevealedColumns(['retail', 'yr1', 'day30', 'today']);
        }
      } catch (err) {
        console.error('Failed to load estimate data', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const saveLines = useCallback(async (currentLines: EstimateLine[]) => {
    try {
      await api.put(`/api/estimator/estimates/${id}/lines`, { lines: currentLines });
    } catch (err) {
      console.error('Failed to save lines', err);
    }
  }, [id]);

  const handleMeasurementChange = useCallback((data: MeasurementData) => {
    dispatch({ type: 'UPDATE_LINE', data });
    setCalculated(false);
    setCalculatedData(null);
  }, []);

  // Debounced auto-save
  useEffect(() => {
    if (lines.length === 0) return;
    if (savingTimeout) clearTimeout(savingTimeout);
    const t = setTimeout(() => saveLines(lines), 1500);
    setSavingTimeout(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, saveLines]);

  const handleAddProduct = (productId: string) => {
    dispatch({ type: 'ADD_PRODUCT', productId });
    setCalculated(false);
    setCalculatedData(null);
  };

  const handleRemoveProduct = (productId: string) => {
    dispatch({ type: 'REMOVE_PRODUCT', productId });
    setCalculated(false);
    setCalculatedData(null);
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      await saveLines(lines);
      const res = await api.post(`/api/estimator/estimates/${id}/calculate`, {
        tier: selectedTier,
      });
      setCalculatedData(res.data.lines);
      setCalculated(true);
      setRevealedColumns(['retail']);
      setEstimate(prev => prev ? { ...prev, status: 'calculated' } : prev);
    } catch (err) {
      console.error('Calculation failed', err);
    } finally {
      setCalculating(false);
    }
  };

  const allProducts = categories.flatMap(c => c.products);
  const getProduct = (productId: string) => allProducts.find(p => p.id === productId);
  const categoryProducts = selectedCategory
    ? categories.find(c => c.category === selectedCategory)?.products ?? []
    : [];

  const hasValidLines = lines.some(l => l.measurement > 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-xl text-gray-500">Estimate not found</p>
      </div>
    );
  }

  const badge = STATUS_BADGES[estimate.status] || STATUS_BADGES.draft;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/estimator')}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl
                       hover:bg-gray-100 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{estimate.customerName}</h1>
            <span className={`inline-block px-3 py-0.5 rounded-full text-sm font-semibold ${badge.className}`}>
              {badge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel — Product Selection */}
        <div className="w-[380px] flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-5">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Select Products</h2>

            {/* Category Grid */}
            {!selectedCategory ? (
              <div className="grid grid-cols-2 gap-3">
                {categories.map(cat => {
                  const selected = lines.some(l =>
                    cat.products.some(p => p.id === l.productId)
                  );
                  return (
                    <button
                      key={cat.category}
                      onClick={() => setSelectedCategory(cat.category)}
                      className={`p-4 rounded-xl border-2 text-left transition-colors min-h-[80px]
                        ${selected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    >
                      <p className="font-bold text-gray-900 capitalize">{cat.category}</p>
                      <p className="text-sm text-gray-500 mt-1">{cat.products.length} products</p>
                      {selected && (
                        <div className="flex items-center gap-1 mt-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-xs text-blue-600 font-medium">
                            {lines.filter(l => cat.products.some(p => p.id === l.productId)).length} selected
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="flex items-center gap-2 text-blue-600 font-semibold mb-4 min-h-[48px]"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  All Categories
                </button>

                <div className="space-y-2">
                  {categoryProducts.map(product => {
                    const isSelected = lines.some(l => l.productId === product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() =>
                          isSelected
                            ? handleRemoveProduct(product.id)
                            : handleAddProduct(product.id)
                        }
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2
                          min-h-[56px] text-left transition-colors
                          ${isSelected
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'}`}
                      >
                        <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0
                          ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}
                        >
                          {isSelected && (
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900">{product.name}</p>
                          <p className="text-sm text-gray-500 capitalize">
                            {product.measurementUnit.replace('_', ' ')}
                            {product.pitchAdjustable && ' | Pitch adjustable'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Panel — Measurements & Breakdown */}
        <div className="flex-1 overflow-y-auto p-6">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <h3 className="text-xl font-bold text-gray-400">No Products Selected</h3>
              <p className="text-gray-400 mt-1">Select products from the left panel to begin</p>
            </div>
          ) : !calculated ? (
            <div className="space-y-5 max-w-2xl">
              <h2 className="text-xl font-bold text-gray-900">Measurements</h2>
              {lines.map(line => {
                const product = getProduct(line.productId);
                if (!product) return null;
                return (
                  <div key={line.productId} className="relative">
                    <button
                      onClick={() => handleRemoveProduct(line.productId)}
                      className="absolute -top-2 -right-2 z-10 w-8 h-8 bg-red-100 hover:bg-red-200
                                 rounded-full flex items-center justify-center transition-colors"
                      aria-label={`Remove ${product.name}`}
                    >
                      <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <MeasurementInputCard
                      productId={product.id}
                      productName={product.name}
                      category={product.category}
                      measurementUnit={product.measurementUnit}
                      pitchAdjustable={product.pitchAdjustable}
                      defaultWasteFactor={product.defaultWasteFactor}
                      addons={product.addons}
                      tierPricePerUnit={product.tiers[selectedTier]?.costPerUnit ?? 0}
                      initialData={line}
                      onChange={handleMeasurementChange}
                    />
                  </div>
                );
              })}

              {/* Calculate Button */}
              <button
                onClick={handleCalculate}
                disabled={!hasValidLines || calculating}
                className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                           disabled:bg-blue-300 disabled:cursor-not-allowed
                           text-white text-lg font-bold rounded-xl shadow-lg
                           transition-colors flex items-center justify-center gap-2"
              >
                {calculating ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Calculating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Calculate Estimate
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Estimate Breakdown</h2>
                <button
                  onClick={() => {
                    setCalculated(false);
                    setCalculatedData(null);
                  }}
                  className="min-h-[48px] px-4 text-blue-600 font-semibold hover:bg-blue-50 rounded-xl transition-colors"
                >
                  Edit Measurements
                </button>
              </div>

              {calculatedData && (
                <EstimateBreakdown
                  lines={calculatedData}
                  role={userRole}
                  selectedTier={selectedTier}
                  onTierChange={setSelectedTier}
                  revealedColumns={revealedColumns}
                  onExportPdf={() => {
                    // Placeholder: will integrate PDF export
                    console.log('Export PDF');
                  }}
                />
              )}

              {/* Present Button */}
              <button
                onClick={() => navigate(`/estimator/${id}/present`)}
                className="w-full h-[56px] bg-green-600 hover:bg-green-700 active:bg-green-800
                           text-white text-lg font-bold rounded-xl shadow-lg
                           transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Present to Customer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Footer — Running Total */}
      {lines.length > 0 && !calculated && (
        <div className="bg-white border-t-2 border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{lines.length} product{lines.length !== 1 ? 's' : ''} selected</p>
            <p className="text-sm text-gray-500">
              {lines.filter(l => l.measurement > 0).length} with measurements
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Estimated Preview</p>
            <p className="text-2xl font-bold text-gray-900">
              {lines.reduce((sum, line) => {
                const product = getProduct(line.productId);
                if (!product || line.measurement === 0) return sum;
                const effective = line.measurement * line.wasteFactor * line.pitchMultiplier;
                return sum + effective * (product.tiers[selectedTier]?.costPerUnit ?? 0);
              }, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
