// Drawn e-signature: canvas pad, saved-signature display, and the consent modal the approve flows use.
import React, { useRef, useState, useEffect } from 'react'
import { Eraser, Check } from 'lucide-react'

interface SignaturePadProps { onSave: (dataUrl: string) => void; onCancel?: () => void; width?: number; height?: number; penColor?: string; backgroundColor?: string }

export function SignaturePad({ onSave, onCancel, width = 500, height = 200, penColor = '#000000', backgroundColor = '#ffffff' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null)
  const [warning, setWarning] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = backgroundColor
    context.fillRect(0, 0, width, height)
    context.strokeStyle = penColor
    context.lineWidth = 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    setCtx(context)
  }, [width, height, penColor, backgroundColor])

  const getPosition = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height
    if ('touches' in e && e.touches && e.touches.length) return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY }
    const m = e as React.MouseEvent<HTMLCanvasElement>
    return { x: (m.clientX - rect.left) * scaleX, y: (m.clientY - rect.top) * scaleY }
  }
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); if (!ctx) return; const p = getPosition(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); setIsDrawing(true) }
  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => { if (!isDrawing || !ctx) return; e.preventDefault(); const p = getPosition(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasSignature(true); setWarning('') }
  const stopDrawing = () => { if (isDrawing && ctx) { ctx.closePath(); setIsDrawing(false) } }
  const clear = () => { if (!ctx) return; ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = penColor; setHasSignature(false) }
  const save = () => { if (!hasSignature) { setWarning('Please sign before saving.'); return } const dataUrl = canvasRef.current?.toDataURL('image/png'); if (dataUrl) onSave(dataUrl) }

  return (
    <div className="inline-block w-full">
      <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white text-gray-900 dark:border-slate-700">
        <canvas ref={canvasRef} width={width} height={height} className="touch-none cursor-crosshair block" style={{ width: '100%', maxWidth: width, height: 'auto', aspectRatio: `${width}/${height}` }}
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} />
        <div className="border-t border-gray-300 px-4 py-2 bg-gray-50 flex items-center justify-between text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <span className="text-xs text-gray-400">✕ Sign above this line</span>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString()}</span>
        </div>
      </div>
      {warning && <p className="mt-2 text-sm text-red-600">{warning}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={clear} className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400 dark:hover:bg-slate-800"><Eraser className="w-4 h-4" /> Clear</button>
        <div className="flex-1" />
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>}
        <button type="button" onClick={save} disabled={!hasSignature} className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"><Check className="w-4 h-4" /> Accept & Sign</button>
      </div>
    </div>
  )
}

export function SignatureDisplay({ signature, signedBy, signedAt, className = '' }: { signature: string | null; signedBy?: string; signedAt?: string; className?: string }) {
  if (!signature) return null
  return (
    <div className={className}>
      <div className="border border-green-200 rounded-lg overflow-hidden bg-green-50 p-3 dark:bg-green-950/30 dark:border-green-900">
        <img src={signature} alt="Signature" className="max-h-20 bg-white rounded" />
        <div className="mt-2 text-sm text-gray-600 dark:text-slate-300">
          <p className="font-medium">{signedBy}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">{signedAt ? new Date(signedAt).toLocaleString() : ''}</p>
        </div>
      </div>
    </div>
  )
}

export interface SignatureData { signature: string; signedBy: string; signedAt: string; consent: boolean }

export function SignatureModal({ isOpen, onClose, onSave, title = 'Sign Document', signerName = '' }: { isOpen: boolean; onClose: () => void; onSave: (data: SignatureData) => void; title?: string; signerName?: string }) {
  const [name, setName] = useState(signerName)
  const [consent, setConsent] = useState(false)
  const [warning, setWarning] = useState('')
  useEffect(() => { setName(signerName) }, [signerName])
  useEffect(() => { if (isOpen) { setConsent(false); setWarning('') } }, [isOpen])
  if (!isOpen) return null

  const handleSave = (signatureData: string) => {
    if (!name.trim()) { setWarning('Please enter your name.'); return }
    if (!consent) { setWarning('Please agree to sign electronically before continuing.'); return }
    onSave({ signature: signatureData, signedBy: name.trim(), signedAt: new Date().toISOString(), consent: true })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-gray-900 mb-4 dark:text-slate-100">{title}</h2>
          <div className="mb-4">
            <label htmlFor="sig-name" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Full Name <span className="text-red-500">*</span></label>
            <input id="sig-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your full name" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800" />
          </div>
          <label className="mb-4 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-slate-700" />
            <span className="text-xs text-gray-600 dark:text-slate-400">I agree that my electronic signature is the legal equivalent of my handwritten signature. <span className="text-red-500">*</span></span>
          </label>
          {warning && <p className="mb-3 text-sm text-red-600" role="alert">{warning}</p>}
          <SignaturePad onSave={handleSave} onCancel={onClose} width={450} height={150} />
        </div>
      </div>
    </div>
  )
}
