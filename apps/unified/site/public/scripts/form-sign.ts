// The drawn signature on a consent form (booking/pages.ts form pages): a box the client signs in with a finger or the mouse.
// What is drawn is sent with the form as a PNG picture (the hidden field named `signature`); the server checks it again and keeps it.
// Without this script the box stays empty and the form is refused with a sentence saying to sign — nothing is skipped silently.
document.querySelectorAll<HTMLElement>('[data-signature]').forEach((box) => {
  const canvas = box.querySelector('canvas') as HTMLCanvasElement | null
  const field = box.querySelector('input[name="signature"]') as HTMLInputElement | null
  const clear = box.querySelector('[data-signature-clear]') as HTMLElement | null
  if (!canvas || !field) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const w = Math.max(200, Math.round(canvas.getBoundingClientRect().width || 320)), h = 160
  canvas.width = w * ratio; canvas.height = h * ratio
  canvas.style.height = h + 'px'
  const paint = () => { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round' }
  paint()
  let drawing = false, inked = false
  const at = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h } }
  canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); const p = at(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y + 0.01); ctx.stroke(); e.preventDefault() })
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = at(e); ctx.lineTo(p.x, p.y); ctx.stroke(); inked = true; e.preventDefault() })
  const stop = () => { if (!drawing) return; drawing = false; if (inked) field.value = canvas.toDataURL('image/png') }
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop); canvas.addEventListener('pointerleave', stop)
  clear?.addEventListener('click', () => { paint(); inked = false; field.value = '' })
})
