import React, { useState, useRef, useEffect, useCallback } from 'react';
import { uploadImage } from './api';

// ─── Crop Presets ───
const DEFAULT_CROP_PRESETS = [
  { label: 'Free', ratio: null, icon: 'crop' },
  { label: 'Hero (16:9)', ratio: 16 / 9, icon: 'wide' },
  { label: 'Card (4:3)', ratio: 4 / 3, icon: 'card' },
  { label: 'Square (1:1)', ratio: 1, icon: 'square' },
  { label: 'Portrait (3:4)', ratio: 3 / 4, icon: 'portrait' },
  { label: 'Banner (21:9)', ratio: 21 / 9, icon: 'banner' },
];

function PresetIcon({ type }) {
  const s = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  switch (type) {
    case 'wide': return <svg {...s}><rect x="2" y="6" width="20" height="12" rx="1"/></svg>;
    case 'card': return <svg {...s}><rect x="3" y="4" width="18" height="16" rx="1"/></svg>;
    case 'square': return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="1"/></svg>;
    case 'portrait': return <svg {...s}><rect x="5" y="2" width="14" height="20" rx="1"/></svg>;
    case 'banner': return <svg {...s}><rect x="1" y="7" width="22" height="10" rx="1"/></svg>;
    default: return <svg {...s}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>;
  }
}

/**
 * ImageEditor - Canvas-based image editor with crop & rotate
 * 
 * Props:
 * - src: image URL to edit
 * - onSave: (newUrl) => void - called with uploaded edited image URL
 * - onCancel: () => void
 * - cropPresets: optional custom presets array
 * - folder: upload folder for edited images (default: 'Edited')
 */
function ImageEditor({ src, onSave, onCancel, cropPresets, folder = 'Edited' }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [img, setImg] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [activePreset, setActivePreset] = useState(0);
  const [crop, setCrop] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  const dragRef = useRef({ active: false, type: null, startX: 0, startY: 0, startCrop: null });
  const cropRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const activePresetRef = useRef(0);
  const presets = cropPresets || DEFAULT_CROP_PRESETS;

  useEffect(() => { cropRef.current = crop; }, [crop]);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);
  useEffect(() => { activePresetRef.current = activePreset; }, [activePreset]);

  // Load image
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { setImg(image); setRotation(0); setCrop(null); };
    image.onerror = () => {
      // Retry without crossOrigin for same-origin images
      const img2 = new Image();
      img2.onload = () => { setImg(img2); setRotation(0); setCrop(null); };
      img2.src = src;
    };
    image.src = src;
  }, [src]);

  // Draw canvas
  const draw = useCallback(() => {
    if (!img || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = containerRef.current;
    const containerW = container.clientWidth - 32;
    const containerH = container.clientHeight - 32;

    const isRotated = rotation % 180 !== 0;
    const srcW = isRotated ? img.naturalHeight : img.naturalWidth;
    const srcH = isRotated ? img.naturalWidth : img.naturalHeight;
    const scale = Math.min(containerW / srcW, containerH / srcH, 1);
    const drawW = Math.round(srcW * scale);
    const drawH = Math.round(srcH * scale);

    canvas.width = drawW;
    canvas.height = drawH;
    setCanvasSize({ w: drawW, h: drawH });

    ctx.save();
    ctx.translate(drawW / 2, drawH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const imgW = isRotated ? drawH : drawW;
    const imgH = isRotated ? drawW : drawH;
    ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    const c = cropRef.current;
    if (c) {
      // Darken outside
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, drawW, c.y);
      ctx.fillRect(0, c.y + c.h, drawW, drawH - c.y - c.h);
      ctx.fillRect(0, c.y, c.x, c.h);
      ctx.fillRect(c.x + c.w, c.y, drawW - c.x - c.w, c.h);

      // Border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x, c.y, c.w, c.h);

      // Rule of thirds
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(c.x + (c.w * i) / 3, c.y); ctx.lineTo(c.x + (c.w * i) / 3, c.y + c.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c.x, c.y + (c.h * i) / 3); ctx.lineTo(c.x + c.w, c.y + (c.h * i) / 3); ctx.stroke();
      }

      // Corner handles
      const hs = 10;
      [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].forEach(([cx, cy]) => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
      });

      // Pixel dimensions
      const scaleF = (isRotated ? img.naturalHeight : img.naturalWidth) / drawW;
      const rW = Math.round(c.w * scaleF);
      const rH = Math.round(c.h * scaleF);
      if (c.w > 60) {
        const txt = `${rW} \u00d7 ${rH}`;
        ctx.font = '11px -apple-system, sans-serif';
        const tm = ctx.measureText(txt);
        const px = c.x + c.w / 2 - tm.width / 2 - 6;
        const py = c.y + c.h - 24;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(px, py, tm.width + 12, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, px + 6, py + 14);
      }
    }
  }, [img, rotation]);

  useEffect(() => { draw(); }, [draw, crop]);

  // Init crop on preset/canvas change
  useEffect(() => {
    if (!canvasSize.w || !canvasSize.h) return;
    const p = presets[activePreset];
    const cw = canvasSize.w, ch = canvasSize.h, m = 0.1;
    if (!p || p.ratio === null) {
      const mx = Math.round(cw * m), my = Math.round(ch * m);
      setCrop({ x: mx, y: my, w: cw - mx * 2, h: ch - my * 2 });
    } else {
      let cropW, cropH;
      if (cw / ch > p.ratio) { cropH = Math.round(ch * (1 - m * 2)); cropW = Math.round(cropH * p.ratio); }
      else { cropW = Math.round(cw * (1 - m * 2)); cropH = Math.round(cropW / p.ratio); }
      cropW = Math.min(cropW, cw); cropH = Math.min(cropH, ch);
      setCrop({ x: Math.round((cw - cropW) / 2), y: Math.round((ch - cropH) / 2), w: cropW, h: cropH });
    }
  }, [activePreset, canvasSize.w, canvasSize.h]);

  // ─── Drag ───
  const getCanvasPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  const hitTest = (pos) => {
    const c = cropRef.current;
    if (!c) return null;
    const hs = 18;
    const corners = { nw: [c.x, c.y], ne: [c.x + c.w, c.y], sw: [c.x, c.y + c.h], se: [c.x + c.w, c.y + c.h] };
    for (const [key, [cx, cy]] of Object.entries(corners)) {
      if (Math.abs(pos.x - cx) < hs && Math.abs(pos.y - cy) < hs) return key;
    }
    if (pos.x >= c.x && pos.x <= c.x + c.w && pos.y >= c.y && pos.y <= c.y + c.h) return 'move';
    return null;
  };

  const handlePointerDown = (e) => {
    const c = cropRef.current;
    if (!c) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const hit = hitTest(pos);
    if (hit) {
      dragRef.current = { active: true, type: hit, startX: pos.x, startY: pos.y, startCrop: { ...c } };
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
      const px = t.clientX - rect.left;
      const py = t.clientY - rect.top;
      const dx = px - d.startX;
      const dy = py - d.startY;
      const o = d.startCrop;
      const { w: cw, h: ch } = canvasSizeRef.current;
      const preset = presets[activePresetRef.current];
      const ratio = preset?.ratio || null;
      const min = 30;
      let nc = { ...o };

      if (d.type === 'move') {
        nc.x = Math.max(0, Math.min(cw - o.w, o.x + dx));
        nc.y = Math.max(0, Math.min(ch - o.h, o.y + dy));
      } else {
        let { x, y, w, h } = o;
        if (d.type.includes('w')) { const nx = Math.max(0, Math.min(x + dx, x + w - min)); w += x - nx; x = nx; }
        if (d.type.includes('e')) { w = Math.max(min, Math.min(cw - x, w + dx)); }
        if (d.type.includes('n')) { const ny = Math.max(0, Math.min(y + dy, y + h - min)); h += y - ny; y = ny; }
        if (d.type.includes('s')) { h = Math.max(min, Math.min(ch - y, h + dy)); }
        if (ratio) {
          if (d.type.includes('e') || d.type.includes('w')) {
            h = Math.round(w / ratio); if (y + h > ch) { h = ch - y; w = Math.round(h * ratio); }
          } else {
            w = Math.round(h * ratio); if (x + w > cw) { w = cw - x; h = Math.round(w / ratio); }
          }
        }
        nc = { x, y, w: Math.max(min, w), h: Math.max(min, h) };
      }
      setCrop(nc);
    };
    const onUp = () => { dragRef.current.active = false; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [presets]);

  const handleMouseMove = (e) => {
    if (!canvasRef.current || dragRef.current.active) return;
    const pos = getCanvasPos(e);
    const hit = hitTest(pos);
    const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' };
    canvasRef.current.style.cursor = cursors[hit] || 'default';
  };

  const rotate = (deg) => { setRotation(r => (r + deg + 360) % 360); setCrop(null); };

  const handleSave = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const out = document.createElement('canvas');
      const ctx = out.getContext('2d');
      const isR = rotation % 180 !== 0;
      const fullW = isR ? img.naturalHeight : img.naturalWidth;
      const fullH = isR ? img.naturalWidth : img.naturalHeight;

      if (crop) {
        const sx = fullW / canvasSize.w, sy = fullH / canvasSize.h;
        const cx = Math.round(crop.x * sx), cy = Math.round(crop.y * sy);
        const cw2 = Math.round(crop.w * sx), ch2 = Math.round(crop.h * sy);
        out.width = cw2; out.height = ch2;
        ctx.translate(-cx, -cy);
        ctx.translate(fullW / 2, fullH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);
      } else {
        out.width = fullW; out.height = fullH;
        ctx.translate(fullW / 2, fullH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);
      }
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.92));
      const file = new File([blob], `edited_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const result = await uploadImage(file, folder);
      onSave(result.url);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save. Please try again.');
    }
    setSaving(false);
  };

  if (!img) return <div className="ie-loading"><div className="ie-spinner" /><span>Loading image...</span></div>;

  return (
    <div className="image-editor">
      <div className="ie-toolbar">
        <div className="ie-toolbar-group">
          <button type="button" className="ie-tool-btn" onClick={() => rotate(-90)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span className="ie-tool-label">Left</span>
          </button>
          <button type="button" className="ie-tool-btn" onClick={() => rotate(90)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span className="ie-tool-label">Right</span>
          </button>
        </div>
        <div className="ie-toolbar-divider" />
        <div className="ie-toolbar-group ie-presets-scroll">
          {presets.map((p, i) => (
            <button key={p.label} type="button" className={`ie-tool-btn ${activePreset === i ? 'active' : ''}`} onClick={() => setActivePreset(i)}>
              <PresetIcon type={p.icon} />
              <span className="ie-tool-label">{p.label.split('(')[0].trim()}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ie-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handleMouseMove}
          onTouchStart={handlePointerDown}
          style={{ touchAction: 'none' }}
        />
      </div>

      <div className="ie-actions">
        <button type="button" className="ie-btn ie-btn-ghost" onClick={() => { setRotation(0); setActivePreset(0); setCrop(null); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          Reset
        </button>
        <div className="ie-actions-right">
          <button type="button" className="ie-btn ie-btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="ie-btn ie-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><div className="ie-btn-spinner" />Saving...</> : <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              Apply</>}
          </button>
        </div>
      </div>

      <style>{`
        .image-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .ie-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px; color: var(--admin-text-secondary, #64748b); }
        .ie-spinner { width: 32px; height: 32px; border: 3px solid var(--admin-border, #e2e8f0); border-top-color: var(--admin-primary, #3b82f6); border-radius: 50%; animation: iespin 0.7s linear infinite; }
        @keyframes iespin { to { transform: rotate(360deg); } }

        .ie-toolbar { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--admin-border, #e2e8f0); overflow-x: auto; flex-shrink: 0; background: var(--admin-surface, #fff); }
        .ie-toolbar::-webkit-scrollbar { display: none; }
        .ie-toolbar-group { display: flex; gap: 2px; flex-shrink: 0; }
        .ie-toolbar-divider { width: 1px; height: 32px; margin: 0 8px; background: var(--admin-border, #e2e8f0); flex-shrink: 0; }
        .ie-presets-scroll { overflow-x: auto; }

        .ie-tool-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 10px; border: none; border-radius: 8px; background: none; cursor: pointer; color: var(--admin-text-secondary, #64748b); transition: all 0.15s; flex-shrink: 0; white-space: nowrap; }
        .ie-tool-btn:hover { background: var(--admin-surface-hover, #f1f5f9); color: var(--admin-text, #1e293b); }
        .ie-tool-btn.active { background: var(--admin-primary-light, #eff6ff); color: var(--admin-primary, #3b82f6); }
        .ie-tool-label { font-size: 0.65rem; font-weight: 600; }

        .ie-canvas-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #1a1a2e; padding: 16px; overflow: hidden; }
        .ie-canvas-wrap canvas { max-width: 100%; max-height: 100%; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }

        .ie-actions { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--admin-border, #e2e8f0); background: var(--admin-surface, #fff); flex-shrink: 0; }
        .ie-actions-right { display: flex; gap: 8px; }
        .ie-btn { display: flex; align-items: center; gap: 6px; padding: 10px 18px; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .ie-btn:disabled { opacity: 0.6; pointer-events: none; }
        .ie-btn-ghost { background: none; color: var(--admin-text-secondary, #64748b); }
        .ie-btn-secondary { background: var(--admin-surface-hover, #f1f5f9); color: var(--admin-text, #1e293b); }
        .ie-btn-primary { background: var(--admin-primary, #3b82f6); color: #fff; }
        .ie-btn-primary:hover { filter: brightness(1.1); }
        .ie-btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: iespin 0.7s linear infinite; }

        @media (max-width: 480px) {
          .ie-tool-btn { padding: 6px 8px; }
          .ie-canvas-wrap { padding: 8px; }
          .ie-btn { padding: 10px 14px; font-size: 0.8rem; }
        }
      `}</style>
    </div>
  );
}

export default ImageEditor;
