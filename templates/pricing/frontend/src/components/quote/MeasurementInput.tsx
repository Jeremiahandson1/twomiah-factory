import React, { useCallback, useEffect, useRef } from 'react';

interface MeasurementInputProps {
  value: number;
  onChange: (value: number) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
}

export default function MeasurementInput({
  value,
  onChange,
  unit,
  min = 0,
  max = 9999,
  step = 1,
}: MeasurementInputProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<number>(value);

  const debouncedChange = useCallback(
    (newVal: number) => {
      pendingRef.current = newVal;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange(pendingRef.current);
      }, 400);
    },
    [onChange]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const handleDecrement = () => {
    const next = clamp(value - step);
    onChange(next);
  };

  const handleIncrement = () => {
    const next = clamp(value + step);
    onChange(next);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      debouncedChange(0);
      return;
    }
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      debouncedChange(clamp(parsed));
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-0">
        <button
          type="button"
          onClick={handleDecrement}
          className="flex items-center justify-center w-14 h-14 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 rounded-l-xl text-2xl font-bold text-gray-700 transition-colors select-none"
          aria-label="Decrease"
        >
          &minus;
        </button>
        <input
          type="number"
          value={value || ''}
          onChange={handleInputChange}
          className="w-28 h-14 text-center text-2xl font-bold border-t-2 border-b-2 border-gray-200 bg-white focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          min={min}
          max={max}
          step={step}
        />
        <button
          type="button"
          onClick={handleIncrement}
          className="flex items-center justify-center w-14 h-14 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 rounded-r-xl text-2xl font-bold text-gray-700 transition-colors select-none"
          aria-label="Increase"
        >
          +
        </button>
      </div>
      <span className="mt-1 text-sm font-medium text-gray-500">{unit}</span>
    </div>
  );
}
