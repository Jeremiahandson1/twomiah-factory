import { useRef, useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
import { Eraser, Check } from 'lucide-react';

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onCancel?: () => void;
  width?: number;
  height?: number;
  penColor?: string;
  backgroundColor?: string;
}

/**
 * Signature Pad — draw with a mouse or finger, save as a PNG data URL.
 * The canvas stays white on purpose: a signature has to read like ink on
 * paper even though the portal around it is dark.
 */
export default function SignaturePad({
  onSave,
  onCancel,
  width = 450,
  height = 150,
  penColor = '#111827',
  backgroundColor = '#ffffff',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = penColor;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    setCtx(context);
  }, [width, height, penColor, backgroundColor]);

  const getPosition = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e && e.touches.length) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    const m = e as React.MouseEvent<HTMLCanvasElement>;
    return { x: (m.clientX - rect.left) * scaleX, y: (m.clientY - rect.top) * scaleY };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!ctx) return;
    e.preventDefault();
    const { x, y } = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !ctx) return;
    e.preventDefault();
    const { x, y } = getPosition(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => setIsDrawing(false);

  const clear = () => {
    if (!ctx) return;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = penColor;
    setHasSignature(false);
  };

  const save = () => {
    if (!hasSignature) {
      alert('Please sign above the line before continuing.');
      return;
    }
    const dataUrl = canvasRef.current?.toDataURL('image/png');
    if (dataUrl) onSave(dataUrl);
  };

  return (
    <div className="w-full">
      <div className="border-2 border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="touch-none cursor-crosshair block"
          style={{ width: '100%', height: 'auto', aspectRatio: `${width}/${height}` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <div className="border-t border-gray-300 px-3 py-1.5 bg-gray-100 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">&#10005; Sign above this line</span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">{formatDate()}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={clear} className="flex items-center gap-1 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg">
          <Eraser className="w-4 h-4" /> Clear
        </button>
        <div className="flex-1" />
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-700">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!hasSignature}
          className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          <Check className="w-4 h-4" /> Accept &amp; Sign
        </button>
      </div>
    </div>
  );
}

export interface SignatureData {
  signature: string;
  signedBy: string;
  signedAt: string;
  consent: boolean;
}

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: SignatureData) => void;
  title?: string;
  signerName?: string;
  documentLabel?: string;
}

export const CONSENT_TEXT =
  'I agree that my electronic signature is the legal equivalent of my handwritten signature.';

/** Modal that captures the three things a binding signature needs: the mark,
 *  the signer's name, and an affirmative consent act. */
export function SignatureModal({ isOpen, onClose, onSave, title = 'Sign Document', signerName = '', documentLabel }: SignatureModalProps) {
  const [name, setName] = useState(signerName);
  const [consent, setConsent] = useState(false);

  useEffect(() => { setName(signerName); }, [signerName]);
  useEffect(() => { if (isOpen) setConsent(false); }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (signatureData: string) => {
    if (!name.trim()) {
      alert('Please enter your full name.');
      return;
    }
    if (!consent) {
      alert('Please agree to sign electronically before continuing.');
      return;
    }
    onSave({ signature: signatureData, signedBy: name.trim(), signedAt: new Date().toISOString(), consent: true });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
          {documentLabel && <p className="text-sm text-gray-400 mb-4">{documentLabel}</p>}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <label className="mb-4 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-400">
              {CONSENT_TEXT} <span className="text-red-400">*</span>
            </span>
          </label>

          <SignaturePad onSave={handleSave} onCancel={onClose} />

        </div>
      </div>
    </div>
  );
}

interface SignatureDisplayProps {
  signature?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  className?: string;
}

/** The signed record, as the homeowner sees it after signing. */
export function SignatureDisplay({ signature, signedBy, signedAt, className = '' }: SignatureDisplayProps) {
  if (!signature) return null;
  return (
    <div className={className}>
      <div className="border border-green-700/50 rounded-lg bg-green-900/20 p-3">
        <img src={signature} alt="Your signature" className="max-h-20 bg-white rounded dark:bg-slate-900" />
        <div className="mt-2 text-sm">
          <p className="font-medium text-gray-200">{signedBy || '-'}</p>
          <p className="text-xs text-gray-400">{signedAt ? new Date(signedAt).toLocaleString() : ''}</p>
        </div>
      </div>
    </div>
  );
}
