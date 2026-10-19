// Moved from templates/crm-homecare/frontend/src/components/SignaturePad.tsx (the caregiver app and the office's documents
// both open it). The sign button is teal-700: white on teal-600 was 3.7:1.
// SignaturePad — a modal canvas to sign with mouse, finger or pen, plus the typed legal name.
// No third-party dependency. The drawing is always ink on a white card, in either theme, because
// it becomes a PNG on paper-white.
//
//   <SignaturePad open={open} onClose={…} documentName="I-9 Form" onSign={async (dataUri, typedName) => …} />
import { useEffect, useRef, useState } from 'react';

type Props = {
  open: boolean
  onClose: () => void
  documentName?: string
  onSign: (dataUri: string, typedName: string | null) => Promise<void>
  requireTypedName?: boolean
}

export default function SignaturePad({ open, onClose, documentName, onSign, requireTypedName = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const dirtyRef = useRef(false);
  const [typedName, setTypedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    dirtyRef.current = false;
    setTypedName('');
    setErr(null);
  }, [open]);

  const pos = (e: any) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };
  const start = (e: any) => { e.preventDefault(); drawingRef.current = true; lastRef.current = pos(e); };
  const move = (e: any) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    dirtyRef.current = true;
  };
  const end = () => { drawingRef.current = false; };
  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    dirtyRef.current = false;
    setErr(null);
  };

  const submit = async () => {
    if (!dirtyRef.current) { setErr('Draw your signature in the box above.'); return; }
    if (requireTypedName && !typedName.trim()) { setErr('Type your full legal name below to confirm.'); return; }
    setErr(null);
    setSaving(true);
    try {
      await onSign(canvasRef.current!.toDataURL('image/png'), typedName.trim() || null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save signature');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div onClick={onClose} className="fixed inset-0 z-[2500] flex items-center justify-center p-3 bg-slate-900/60">
      <div onClick={(e) => e.stopPropagation()} className="w-[min(560px,95vw)] rounded-xl p-5 shadow-2xl bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="m-0 text-lg font-semibold">✍️ Sign{documentName ? `: ${documentName}` : ' Document'}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-gray-500 dark:text-slate-400">×</button>
        </div>
        <p className="mt-0 mb-3 text-sm text-gray-600 dark:text-slate-300">
          By signing below you confirm that the information is true to the best of your knowledge.
          Your IP address and timestamp will be recorded.
        </p>
        <div className="h-56 mb-2 rounded-lg overflow-hidden border-2 border-dashed border-slate-400 bg-white dark:border-slate-500 dark:bg-white" style={{ touchAction: 'none' }}>
          <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        </div>
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={clear} className="px-3 py-1.5 rounded-md text-sm border border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">↺ Clear</button>
          <span className="text-xs text-gray-500 dark:text-slate-400">Use mouse, finger, or pen</span>
        </div>
        {requireTypedName && (
          <div className="mb-3">
            <label className="block mb-1 text-xs font-bold text-gray-700 dark:text-slate-200">Type your full legal name *</label>
            <input type="text" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="First Last"
              className="w-full px-2 py-2 rounded-md border text-base border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        )}
        {err && <div className="mb-2 px-3 py-2 rounded-md text-sm bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-gray-300 bg-white text-gray-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-md text-sm font-bold bg-teal-700 text-white disabled:opacity-60 dark:bg-teal-700 dark:text-white">
            {saving ? 'Saving…' : '✓ Sign & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
