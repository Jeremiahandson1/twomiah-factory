import React, { useRef, useEffect, useState, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';

interface SignaturePadProps {
  onEnd: (svgData: string) => void;
  label?: string;
  penColor?: string;
  height?: number;
}

export default function SignaturePad({
  onEnd,
  label = 'Sign above',
  penColor = '#1a3a6b',
  height = 300,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [undoStack, setUndoStack] = useState<Array<SignaturePadLib['toData'] extends () => infer R ? R : never>>([]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = container.offsetWidth;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
    }

    if (padRef.current) {
      padRef.current.clear();
      setIsEmpty(true);
      onEnd('');
    }
  }, [height, onEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      penColor,
      minWidth: 1.5,
      maxWidth: 3.5,
      throttle: 16,
      velocityFilterWeight: 0.7,
    });

    pad.addEventListener('endStroke', () => {
      setIsEmpty(pad.isEmpty());
      const data = pad.toData();
      setUndoStack((prev) => [...prev, JSON.parse(JSON.stringify(data))]);
      const svgString = pad.toSVG();
      onEnd(svgString);
    });

    padRef.current = pad;
    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);
    return () => {
      pad.off();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [penColor, resizeCanvas, onEnd]);

  function handleClear() {
    if (padRef.current) {
      padRef.current.clear();
      setIsEmpty(true);
      setUndoStack([]);
      onEnd('');
    }
  }

  function handleUndo() {
    if (!padRef.current || undoStack.length === 0) return;

    const newStack = [...undoStack];
    newStack.pop();
    setUndoStack(newStack);

    padRef.current.clear();

    if (newStack.length > 0) {
      const lastState = newStack[newStack.length - 1] as any;
      padRef.current.fromData(lastState);
      setIsEmpty(false);
      const svgString = padRef.current.toSVG();
      onEnd(svgString);
    } else {
      setIsEmpty(true);
      onEnd('');
    }
  }

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="relative border-2 border-gray-300 rounded-xl bg-white overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
          style={{ height: `${height}px` }}
        />

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-2xl font-light select-none">
              Sign here
            </p>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-gray-300 mx-6" />
      </div>

      <div className="flex items-center justify-between mt-3">
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="px-5 py-3 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[48px] min-w-[48px]"
          >
            <svg className="w-5 h-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
            </svg>
            Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={isEmpty}
            className="px-5 py-3 text-sm font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[48px] min-w-[48px]"
          >
            <svg className="w-5 h-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
