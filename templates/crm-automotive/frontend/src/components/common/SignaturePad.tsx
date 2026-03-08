import { useRef, useState, useEffect } from 'react';
import { Eraser, Check, X } from 'lucide-react';

/**
 * Signature Pad Component
 * 
 * Usage:
 *   <SignaturePad onSave={(dataUrl) => console.log(dataUrl)} />
 */
export default function SignaturePad({ 
  onSave, 
  onCancel,
  width = 500,
  height = 200,
  penColor = '#000000',
  backgroundColor = '#ffffff',
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [ctx, setCtx] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = penColor;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    setCtx(context);
  }, [width, height, penColor, backgroundColor]);

  const getPosition = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      ctx.closePath();
      setIsDrawing(false);
    }
  };

  const clear = () => {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = penColor;
    setHasSignature(false);
  };

  const save = () => {
    if (!hasSignature) {
      alert('Please sign before saving.');
      return;
    }
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div className="inline-block w-full">
      <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white text-gray-900">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="touch-none cursor-crosshair"
          style={{ width: '100%', maxWidth: width, height: 'auto', aspectRatio: `${width}/${height}` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <div className="border-t border-gray-300 px-4 py-2 bg-gray-50 flex items-center justify-between text-gray-900">
          <span className="text-xs text-gray-400">✕ Sign above this line</span>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <Eraser className="w-4 h-4" />
          Clear
        </button>
        <div className="flex-1" />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!hasSignature}
          className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          Accept & Sign
        </button>
      </div>
    </div>
  );
}

/**
 * Display a saved signature
 */
export function SignatureDisplay({ signature, signedBy, signedAt, className = '' }) {
  if (!signature) return null;

  return (
    <div className={`${className}`}>
      <div className="border border-green-200 rounded-lg overflow-hidden bg-green-50 p-3">
        <img src={signature} alt="Signature" className="max-h-20" />
        <div className="mt-2 text-sm text-gray-600">
          <p className="font-medium">{signedBy}</p>
          <p className="text-xs text-gray-500">{new Date(signedAt).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Signature modal for inline signing
 */
export function SignatureModal({ isOpen, onClose, onSave, title = 'Sign Document', signerName = '' }) {
  const [name, setName] = useState(signerName);

  useEffect(() => {
    setName(signerName);
  }, [signerName]);

  if (!isOpen) return null;

  const handleSave = (signatureData) => {
    if (!name.trim()) {
      alert('Please enter your name.');
      return;
    }
    onSave({
      signature: signatureData,
      signedBy: name.trim(),
      signedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>

          <SignaturePad onSave={handleSave} onCancel={onClose} width={450} height={150} />

          <p className="mt-4 text-xs text-gray-500">
            By signing, you agree this electronic signature is legally equivalent to your handwritten signature.
          </p>
        </div>
      </div>
    </div>
  );
}
