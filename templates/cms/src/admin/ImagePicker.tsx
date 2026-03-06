import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import { getImages, uploadImage } from './api';

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

// ═══════════════════════════════════════
// IMAGE EDITOR
// ═══════════════════════════════════════
function ImageEditor({ src, onSave, onCancel, cropPresets }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [img, setImg] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [activePreset, setActivePreset] = useState(0);
  const [crop, setCrop] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  // Use refs for drag state so window listeners always see current values
  const dragRef = useRef({ active: false, type: null, startX: 0, startY: 0, startCrop: null });
  const cropRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const activePresetRef = useRef(0);
  const presets = cropPresets || DEFAULT_CROP_PRESETS;

  // Keep refs in sync with state
  useEffect(() => { cropRef.current = crop; }, [crop]);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);
  useEffect(() => { activePresetRef.current = activePreset; }, [activePreset]);

  // Load image
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { setImg(image); setRotation(0); setCrop(null); };
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
      // Darken outside crop
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

      // Pixel dimensions label
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

  // Redraw when crop changes
  useEffect(() => { draw(); }, [draw, crop]);

  // Init crop when preset or canvas size changes
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

  // ─── Drag Logic ───
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

  // Window-level move/up — reads everything from refs, no stale closures
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

  // Cursor on mouse move (not drag)
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
      const result = await uploadImage(file, 'Edited');
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
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN IMAGE PICKER
// ═══════════════════════════════════════
function ImagePicker({
  value, onChange, label,
  aspectRatio = '16/9', folder = 'Uploads',
  placeholder = 'Click to add image', maxHeight = '250px',
  cropPresets,
}) {
  const [showLibrary, setShowLibrary] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorSrc, setEditorSrc] = useState('');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('library');
  const fileInputRef = useRef(null);

  useEffect(() => { if (showLibrary) loadImages(); }, [showLibrary]);
  useEffect(() => {
    document.body.style.overflow = (showLibrary || showEditor) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showLibrary, showEditor]);

  const loadImages = async () => {
    setLoading(true);
    try { setImages((await getImages()) || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleFileSelect = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try { const r = await uploadImage(files[0], folder); onChange(r.url); setShowLibrary(false); } catch (e) { console.error(e); }
    setUploading(false);
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files?.length) handleFileSelect(e.dataTransfer.files); };
  const openEditor = (url) => { setEditorSrc(getImageUrl(url || value)); setShowEditor(true); setShowLibrary(false); };

  const filteredImages = searchQuery
    ? images.filter(i => (i.filename || '').toLowerCase().includes(searchQuery.toLowerCase()) || (i.altText || '').toLowerCase().includes(searchQuery.toLowerCase()) || (i.folder || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : images;

  return (
    <div className="ip">
      {label && <label className="ip-label">{label}</label>}

      <div
        className={`ip-zone ${value ? 'has-image' : ''} ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
        style={{ aspectRatio, maxHeight }}
        onClick={() => !value && setShowLibrary(true)}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
      >
        {uploading ? (
          <div className="ip-loading"><div className="ip-spinner" /><span>Uploading...</span></div>
        ) : value ? (
          <>
            <img src={getImageUrl(value)} alt="" />
            <div className="ip-overlay">
              <button type="button" className="ip-ov-btn" onClick={e => { e.stopPropagation(); setShowLibrary(true); }}>Change</button>
              <button type="button" className="ip-ov-btn accent" onClick={e => { e.stopPropagation(); openEditor(value); }}>Edit</button>
              <button type="button" className="ip-ov-btn danger" onClick={e => { e.stopPropagation(); onChange(''); }}>Remove</button>
            </div>
          </>
        ) : (
          <div className="ip-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>{placeholder}</span>
            <span className="ip-hint">Tap to browse or drop image here</span>
          </div>
        )}
      </div>

      {/* Library Modal */}
      {showLibrary && (
        <div className="ip-modal-backdrop" onClick={() => setShowLibrary(false)}>
          <div className="ip-modal" onClick={e => e.stopPropagation()}>
            <div className="ip-modal-header">
              <h3>Select Image</h3>
              <button type="button" className="ip-modal-close" onClick={() => setShowLibrary(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="ip-tabs">
              <button type="button" className={`ip-tab ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>Library</button>
              <button type="button" className={`ip-tab ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>Upload</button>
            </div>

            {activeTab === 'upload' && (
              <div className="ip-upload-area">
                <div className={`ip-drop-zone ${dragOver ? 'drag-over' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
                  onClick={() => fileInputRef.current?.click()}>
                  {uploading ? <><div className="ip-spinner" /><span>Uploading...</span></>
                    : <><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span style={{fontWeight:600}}>Drop image here</span><span className="ip-hint">or tap to browse</span></>}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={e => handleFileSelect(e.target.files)} />
              </div>
            )}

            {activeTab === 'library' && <>
              <div className="ip-search">
                <input type="text" placeholder="Search images..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                {searchQuery && <button type="button" className="ip-search-clear" onClick={() => setSearchQuery('')}>&times;</button>}
              </div>
              <div className="ip-grid">
                {loading ? <div className="ip-grid-msg"><div className="ip-spinner" />Loading...</div>
                : filteredImages.length === 0 ? <div className="ip-grid-msg">{searchQuery ? 'No matches' : 'No images yet'}</div>
                : filteredImages.map(img => (
                  <button key={img.filename} type="button"
                    className={`ip-grid-item ${value === img.url ? 'selected' : ''}`}
                    onClick={() => { onChange(img.url); setShowLibrary(false); }}
                  >
                    <img src={getImageUrl(img.url)} alt={img.altText || img.filename} loading="lazy" />
                    {value === img.url && <span className="ip-check">&#10003;</span>}
                  </button>
                ))}
              </div>
            </>}
          </div>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && editorSrc && (
        <div className="ip-editor-backdrop">
          <div className="ip-editor-modal">
            <ImageEditor src={editorSrc} onSave={url => { onChange(url); setShowEditor(false); }} onCancel={() => setShowEditor(false)} cropPresets={cropPresets} />
          </div>
        </div>
      )}

      <style>{`
        .ip { margin-bottom: 20px; }
        .ip-label { display: block; font-size: 0.875rem; font-weight: 600; color: var(--admin-text, #1e293b); margin-bottom: 8px; }

        .ip-zone { position: relative; border: 2px dashed var(--admin-border, #e2e8f0); border-radius: 12px; overflow: hidden; cursor: pointer; transition: all 0.2s; background: var(--admin-surface, #fff); }
        .ip-zone:hover, .ip-zone.drag-over { border-color: var(--admin-primary, #3b82f6); }
        .ip-zone.has-image { border-style: solid; cursor: default; }
        .ip-zone.uploading { pointer-events: none; opacity: 0.7; }
        .ip-zone > img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .ip-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; gap: 8px; opacity: 0; transition: opacity 0.2s; }
        .ip-zone:hover .ip-overlay { opacity: 1; }
        @media (hover: none) { .ip-overlay { opacity: 1; background: linear-gradient(transparent 40%, rgba(0,0,0,0.75)); align-items: flex-end; padding-bottom: 12px; } }
        .ip-ov-btn { padding: 8px 14px; border: none; border-radius: 8px; background: rgba(255,255,255,0.95); color: #1e293b; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
        .ip-ov-btn.accent { background: var(--admin-primary, #3b82f6); color: #fff; }
        .ip-ov-btn.danger { background: #ef4444; color: #fff; }

        .ip-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--admin-text-secondary, #64748b); }
        .ip-placeholder svg { opacity: 0.4; }
        .ip-hint { font-size: 0.75rem; color: var(--admin-text-muted, #94a3b8); }
        .ip-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
        .ip-spinner { width: 28px; height: 28px; border: 3px solid var(--admin-border, #e2e8f0); border-top-color: var(--admin-primary, #3b82f6); border-radius: 50%; animation: ipspin 0.7s linear infinite; }
        @keyframes ipspin { to { transform: rotate(360deg); } }

        /* Modal */
        .ip-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; align-items: flex-end; justify-content: center; }
        @media (min-width: 769px) { .ip-modal-backdrop { align-items: center; padding: 20px; } }
        .ip-modal { width: 100%; max-width: 720px; max-height: 92vh; background: var(--admin-surface, #fff); border-radius: 20px 20px 0 0; display: flex; flex-direction: column; overflow: hidden; }
        @media (min-width: 769px) { .ip-modal { border-radius: 16px; max-height: 82vh; } }

        .ip-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--admin-border, #e2e8f0); }
        .ip-modal-header h3 { margin: 0; font-size: 1.1rem; font-weight: 700; }
        .ip-modal-close { width: 36px; height: 36px; border: none; background: var(--admin-surface-hover, #f1f5f9); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--admin-text-secondary, #64748b); }

        .ip-tabs { display: flex; border-bottom: 1px solid var(--admin-border, #e2e8f0); }
        .ip-tab { flex: 1; padding: 12px; border: none; background: none; font-size: 0.875rem; font-weight: 600; cursor: pointer; color: var(--admin-text-secondary, #64748b); border-bottom: 2px solid transparent; }
        .ip-tab.active { color: var(--admin-primary, #3b82f6); border-bottom-color: var(--admin-primary, #3b82f6); }

        .ip-upload-area { padding: 20px; flex: 1; display: flex; }
        .ip-drop-zone { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 2px dashed var(--admin-border, #e2e8f0); border-radius: 16px; cursor: pointer; color: var(--admin-text-secondary, #64748b); min-height: 200px; }
        .ip-drop-zone:hover, .ip-drop-zone.drag-over { border-color: var(--admin-primary, #3b82f6); }

        .ip-search { display: flex; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--admin-border, #e2e8f0); position: relative; }
        .ip-search input { flex: 1; padding: 10px 12px; border: 1px solid var(--admin-border, #e2e8f0); border-radius: 8px; font-size: 0.9rem; background: var(--admin-bg, #f8fafc); outline: none; }
        .ip-search input:focus { border-color: var(--admin-primary, #3b82f6); }
        .ip-search-clear { position: absolute; right: 28px; border: none; background: none; font-size: 1.2rem; cursor: pointer; color: var(--admin-text-muted, #94a3b8); }

        /* ─── GRID ─── */
        .ip-grid {
          flex: 1; overflow-y: auto; padding: 12px;
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
          -webkit-overflow-scrolling: touch; align-content: start;
        }
        @media (min-width: 500px) { .ip-grid { grid-template-columns: repeat(4, 1fr); gap: 10px; } }
        @media (min-width: 700px) { .ip-grid { grid-template-columns: repeat(5, 1fr); } }
        .ip-grid-msg { grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--admin-text-secondary, #64748b); display: flex; flex-direction: column; align-items: center; gap: 12px; }

        /* Each grid cell is a button with padding-bottom trick (proven from original) */
        .ip-grid-item {
          position: relative;
          width: 100%;
          padding-bottom: 100%;
          border: 2px solid var(--admin-border, #e2e8f0);
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          background: var(--admin-bg, #f8fafc);
          transition: all 0.2s;
          -webkit-appearance: none;
          appearance: none;
          font-size: 0;
        }
        .ip-grid-item:hover, .ip-grid-item:focus { border-color: var(--admin-primary, #3b82f6); transform: scale(1.02); }
        .ip-grid-item.selected { border-color: var(--admin-primary, #3b82f6); border-width: 3px; }
        .ip-grid-item img {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          object-fit: cover;
        }
        .ip-check {
          position: absolute; top: 6px; right: 6px;
          width: 24px; height: 24px; background: var(--admin-primary, #3b82f6);
          color: #fff; border-radius: 50%; display: flex; align-items: center;
          justify-content: center; font-size: 14px; font-weight: bold;
        }

        /* ─── Editor Modal ─── */
        .ip-editor-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10001; display: flex; align-items: center; justify-content: center; }
        .ip-editor-modal { width: 100%; height: 100%; max-width: 900px; display: flex; flex-direction: column; background: var(--admin-surface, #fff); overflow: hidden; }
        @media (min-width: 769px) { .ip-editor-modal { max-height: 90vh; height: auto; border-radius: 16px; margin: 20px; } }

        .image-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .ie-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px; }
        .ie-spinner { width: 32px; height: 32px; border: 3px solid var(--admin-border, #e2e8f0); border-top-color: var(--admin-primary, #3b82f6); border-radius: 50%; animation: ipspin 0.7s linear infinite; }

        .ie-toolbar { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--admin-border, #e2e8f0); overflow-x: auto; flex-shrink: 0; background: var(--admin-surface, #fff); }
        .ie-toolbar::-webkit-scrollbar { display: none; }
        .ie-toolbar-group { display: flex; gap: 2px; flex-shrink: 0; }
        .ie-toolbar-divider { width: 1px; height: 32px; margin: 0 8px; background: var(--admin-border, #e2e8f0); flex-shrink: 0; }
        .ie-presets-scroll { overflow-x: auto; }

        .ie-tool-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 10px; border: none; border-radius: 8px; background: none; cursor: pointer; color: var(--admin-text-secondary, #64748b); transition: all 0.15s; flex-shrink: 0; white-space: nowrap; }
        .ie-tool-btn:hover { background: var(--admin-surface-hover, #f1f5f9); }
        .ie-tool-btn.active { background: var(--admin-primary-light, #eff6ff); color: var(--admin-primary, #3b82f6); }
        .ie-tool-label { font-size: 0.65rem; font-weight: 600; }

        .ie-canvas-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #1a1a2e; padding: 16px; overflow: hidden; }
        .ie-canvas-wrap canvas { max-width: 100%; max-height: 100%; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }

        .ie-actions { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--admin-border, #e2e8f0); background: var(--admin-surface, #fff); flex-shrink: 0; }
        .ie-actions-right { display: flex; gap: 8px; }
        .ie-btn { display: flex; align-items: center; gap: 6px; padding: 10px 18px; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
        .ie-btn:disabled { opacity: 0.6; pointer-events: none; }
        .ie-btn-ghost { background: none; color: var(--admin-text-secondary, #64748b); }
        .ie-btn-secondary { background: var(--admin-surface-hover, #f1f5f9); color: var(--admin-text, #1e293b); }
        .ie-btn-primary { background: var(--admin-primary, #3b82f6); color: #fff; }
        .ie-btn-primary:hover { filter: brightness(1.1); }
        .ie-btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: ipspin 0.7s linear infinite; }

        @media (max-width: 480px) {
          .ie-tool-btn { padding: 6px 8px; }
          .ie-canvas-wrap { padding: 8px; }
          .ie-btn { padding: 10px 14px; font-size: 0.8rem; }
        }
      `}</style>
    </div>
  );
}

export default ImagePicker;
