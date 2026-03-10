import React, { useState, useEffect, useRef, useCallback } from 'react';

const PITCH_OPTIONS = [
  { label: '4/12', value: '4/12', multiplier: 1.054 },
  { label: '5/12', value: '5/12', multiplier: 1.083 },
  { label: '6/12', value: '6/12', multiplier: 1.118 },
  { label: '7/12', value: '7/12', multiplier: 1.158 },
  { label: '8/12', value: '8/12', multiplier: 1.202 },
  { label: '9/12', value: '9/12', multiplier: 1.250 },
  { label: '10/12', value: '10/12', multiplier: 1.302 },
  { label: '11/12', value: '11/12', multiplier: 1.357 },
  { label: '12/12', value: '12/12', multiplier: 1.414 },
];

const UNIT_LABELS: Record<string, string> = {
  sq_ft: 'Square Feet',
  lin_ft: 'Linear Feet',
  squares: 'Squares',
  count: 'Count',
};

const CATEGORY_ICONS: Record<string, string> = {
  roofing: '🏠',
  siding: '🧱',
  gutters: '🌧️',
  windows: '🪟',
  doors: '🚪',
  insulation: '🧊',
  painting: '🎨',
  default: '📦',
};

export interface Addon {
  id: string;
  name: string;
  price: number;
  pricingType: 'flat' | 'per_unit' | 'per_sq_ft';
  unit?: string;
  defaultSelected?: boolean;
}

export interface MeasurementData {
  productId: string;
  measurement: number;
  pitch: string | null;
  pitchMultiplier: number;
  wasteFactor: number;
  selectedAddons: string[];
}

interface Props {
  productId: string;
  productName: string;
  category: string;
  measurementUnit: string;
  pitchAdjustable: boolean;
  defaultWasteFactor: number;
  addons: Addon[];
  tierPricePerUnit?: number;
  initialData?: Partial<MeasurementData>;
  onChange: (data: MeasurementData) => void;
}

export default function MeasurementInputCard({
  productId,
  productName,
  category,
  measurementUnit,
  pitchAdjustable,
  defaultWasteFactor,
  addons,
  tierPricePerUnit = 0,
  initialData,
  onChange,
}: Props) {
  const [measurement, setMeasurement] = useState(initialData?.measurement ?? 0);
  const [pitch, setPitch] = useState(initialData?.pitch ?? (pitchAdjustable ? '4/12' : null));
  const [wasteFactor, setWasteFactor] = useState(initialData?.wasteFactor ?? defaultWasteFactor);
  const [wasteUnlocked, setWasteUnlocked] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<string[]>(
    initialData?.selectedAddons ?? addons.filter(a => a.defaultSelected).map(a => a.id)
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pitchMultiplier = pitch
    ? PITCH_OPTIONS.find(p => p.value === pitch)?.multiplier ?? 1
    : 1;

  const effectiveMeasurement = measurement * wasteFactor * pitchMultiplier;

  const addonTotal = addons
    .filter(a => selectedAddons.includes(a.id))
    .reduce((sum, a) => {
      if (a.pricingType === 'flat') return sum + a.price;
      if (a.pricingType === 'per_unit') return sum + a.price * measurement;
      if (a.pricingType === 'per_sq_ft') return sum + a.price * effectiveMeasurement;
      return sum;
    }, 0);

  const subtotal = effectiveMeasurement * tierPricePerUnit + addonTotal;

  const emitChange = useCallback(() => {
    onChange({
      productId,
      measurement,
      pitch,
      pitchMultiplier,
      wasteFactor,
      selectedAddons,
    });
  }, [productId, measurement, pitch, pitchMultiplier, wasteFactor, selectedAddons, onChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(emitChange, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [emitChange]);

  const toggleAddon = (id: string) => {
    setSelectedAddons(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const stepValue = measurementUnit === 'count' ? 1 : measurementUnit === 'squares' ? 1 : 10;
  const icon = CATEGORY_ICONS[category.toLowerCase()] || CATEGORY_ICONS.default;
  const unitLabel = UNIT_LABELS[measurementUnit] || measurementUnit;
  const wastePercent = Math.round((wasteFactor - 1) * 100);

  return (
    <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-gray-50 border-b border-gray-200">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="text-lg font-bold text-gray-900">{productName}</h3>
          <p className="text-sm text-gray-500 capitalize">{category}</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Measurement Input */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">{unitLabel}</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMeasurement(prev => Math.max(0, prev - stepValue))}
              className="w-[56px] h-[56px] flex-shrink-0 rounded-xl bg-gray-100 hover:bg-gray-200
                         active:bg-gray-300 border-2 border-gray-300 text-2xl font-bold text-gray-700
                         transition-colors flex items-center justify-center"
              aria-label="Decrease"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={measurement || ''}
              onChange={e => setMeasurement(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
              className="flex-1 h-[56px] text-center text-2xl font-bold rounded-xl border-2 border-gray-300
                         focus:border-blue-600 outline-none bg-white"
            />
            <button
              onClick={() => setMeasurement(prev => prev + stepValue)}
              className="w-[56px] h-[56px] flex-shrink-0 rounded-xl bg-gray-100 hover:bg-gray-200
                         active:bg-gray-300 border-2 border-gray-300 text-2xl font-bold text-gray-700
                         transition-colors flex items-center justify-center"
              aria-label="Increase"
            >
              +
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1 text-center">{unitLabel}</p>
        </div>

        {/* Pitch Selector */}
        {pitchAdjustable && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Roof Pitch</label>
            <select
              value={pitch || ''}
              onChange={e => setPitch(e.target.value)}
              className="w-full h-[56px] px-4 text-lg rounded-xl border-2 border-gray-300
                         focus:border-blue-600 outline-none bg-white appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
              }}
            >
              {PITCH_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.multiplier.toFixed(3)}x)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Waste Factor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">
              {wastePercent}% waste factor
            </span>
            <button
              onClick={() => setWasteUnlocked(!wasteUnlocked)}
              className="min-w-[48px] min-h-[48px] flex items-center justify-center text-gray-500
                         hover:text-gray-700 transition-colors"
              aria-label={wasteUnlocked ? 'Lock waste factor' : 'Unlock waste factor'}
            >
              {wasteUnlocked ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          </div>
          {wasteUnlocked && (
            <div className="space-y-2">
              <input
                type="range"
                min={1}
                max={1.3}
                step={0.01}
                value={wasteFactor}
                onChange={e => setWasteFactor(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer
                           accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0%</span>
                <span>15%</span>
                <span>30%</span>
              </div>
            </div>
          )}
        </div>

        {/* Addons */}
        {addons.length > 0 && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Add-ons</label>
            <div className="space-y-2">
              {addons.map(addon => (
                <button
                  key={addon.id}
                  onClick={() => toggleAddon(addon.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors
                    min-h-[48px] text-left
                    ${selectedAddons.includes(addon.id)
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0
                    ${selectedAddons.includes(addon.id)
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-gray-300'}`}
                  >
                    {selectedAddons.includes(addon.id) && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-gray-900">{addon.name}</span>
                  </div>
                  <span className="font-bold text-gray-700">
                    ${addon.price.toFixed(2)}
                    {addon.pricingType !== 'flat' && (
                      <span className="text-sm font-normal text-gray-500">
                        /{addon.unit || 'unit'}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Subtotal */}
        {measurement > 0 && tierPricePerUnit > 0 && (
          <div className="pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">
                  {measurement.toLocaleString()} {unitLabel.toLowerCase()}
                  {wastePercent > 0 && ` + ${wastePercent}% waste = ${Math.round(measurement * wasteFactor).toLocaleString()}`}
                  {pitchAdjustable && pitch && ` × ${pitchMultiplier.toFixed(3)}x pitch`}
                </p>
                <p className="text-sm text-gray-500">
                  Effective: {Math.round(effectiveMeasurement).toLocaleString()} {unitLabel.toLowerCase()}
                </p>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
