import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getServiceById, getSubServiceById } from '../data/services';
import { getPage, savePage, uploadImage, getRevisions, restoreRevision, duplicatePage, analyzeSEO } from './api';
import { useToast } from './Toast';
import AdminLayout from './AdminLayout';
import { getImageUrl, UPLOAD_BASE } from '../utils/imageUrl';
import ImagePicker from './ImagePicker';

// ============================================
// UNDO/REDO HOOK
// ============================================
function useUndoRedo(initialState) {
  const [history, setHistory] = useState([initialState]);
  const [index, setIndex] = useState(0);
  const skipNextPush = useRef(false);

  const current = history[index];

  const push = useCallback((newState) => {
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    setHistory(prev => [...prev.slice(0, index + 1), newState].slice(-50));
    setIndex(prev => Math.min(prev + 1, 49));
  }, [index]);

  const undo = useCallback(() => {
    if (index > 0) {
      skipNextPush.current = true;
      setIndex(prev => prev - 1);
      return history[index - 1];
    }
    return null;
  }, [index, history]);

  const redo = useCallback(() => {
    if (index < history.length - 1) {
      skipNextPush.current = true;
      setIndex(prev => prev + 1);
      return history[index + 1];
    }
    return null;
  }, [index, history]);

  const reset = useCallback((newState) => {
    setHistory([newState]);
    setIndex(0);
  }, []);

  return {
    current,
    push,
    undo,
    redo,
    reset,
    canUndo: index > 0,
    canRedo: index < history.length - 1,
    historyLength: history.length
  };
}

// ============================================
// WYSIWYG EDITOR - ENHANCED
// ============================================
function WysiwygEditor({ value, onChange, placeholder, onImageInsert }) {
  const editorRef = useRef(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML && value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  const handleInput = () => {
    if (onChange) onChange(editorRef.current.innerHTML);
  };

  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    editorRef.current.focus();
    handleInput();
  };

  const insertTable = () => {
    const table = `<table style="width:100%;border-collapse:collapse;margin:1em 0">
      <tr><th style="border:1px solid #ddd;padding:8px">Header 1</th><th style="border:1px solid #ddd;padding:8px">Header 2</th></tr>
      <tr><td style="border:1px solid #ddd;padding:8px">Cell 1</td><td style="border:1px solid #ddd;padding:8px">Cell 2</td></tr>
    </table>`;
    exec('insertHTML', table);
  };

  const insertImage = () => {
    if (onImageInsert) {
      onImageInsert((url) => {
        exec('insertHTML', `<img src="${url}" style="max-width:100%;height:auto;margin:1em 0" />`);
      });
    }
  };

  const insertLink = () => {
    const sel = window.getSelection();
    if (sel.toString()) {
      setShowLinkModal(true);
    } else {
      const url = prompt('Enter URL:');
      if (url) exec('createLink', url);
    }
  };

  const confirmLink = () => {
    if (linkUrl) {
      exec('createLink', linkUrl);
      setShowLinkModal(false);
      setLinkUrl('');
    }
  };

  return (
    <div className="wysiwyg-editor">
      <div className="wysiwyg-toolbar">
        <button type="button" onClick={() => exec('bold')} title="Bold"><strong>B</strong></button>
        <button type="button" onClick={() => exec('italic')} title="Italic"><em>I</em></button>
        <button type="button" onClick={() => exec('underline')} title="Underline"><u>U</u></button>
        <button type="button" onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
        <span className="toolbar-divider"></span>
        <button type="button" onClick={() => exec('formatBlock', '<h2>')} title="Heading 2">H2</button>
        <button type="button" onClick={() => exec('formatBlock', '<h3>')} title="Heading 3">H3</button>
        <button type="button" onClick={() => exec('formatBlock', '<p>')} title="Paragraph">P</button>
        <button type="button" onClick={() => exec('formatBlock', '<blockquote>')} title="Quote">❝</button>
        <span className="toolbar-divider"></span>
        <button type="button" onClick={() => exec('insertUnorderedList')} title="Bullet List">• List</button>
        <button type="button" onClick={() => exec('insertOrderedList')} title="Numbered List">1. List</button>
        <span className="toolbar-divider"></span>
        <button type="button" onClick={insertLink} title="Insert Link">🔗</button>
        <button type="button" onClick={insertImage} title="Insert Image">🖼️</button>
        <button type="button" onClick={insertTable} title="Insert Table">▦</button>
        <span className="toolbar-divider"></span>
        <button type="button" onClick={() => exec('justifyLeft')} title="Align Left">⫷</button>
        <button type="button" onClick={() => exec('justifyCenter')} title="Align Center">⫿</button>
        <button type="button" onClick={() => exec('justifyRight')} title="Align Right">⫸</button>
        <span className="toolbar-divider"></span>
        <button type="button" onClick={() => exec('removeFormat')} title="Clear Formatting">✕</button>
      </div>
      <div
        ref={editorRef}
        className="wysiwyg-content"
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder || 'Start typing...'}
        suppressContentEditableWarning
      />
      {showLinkModal && (
        <div className="modal-overlay" onClick={() => setShowLinkModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Insert Link</h3>
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
            />
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowLinkModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={confirmLink}>Insert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// IMAGE PICKER WITH ANIMATION OPTIONS
// ============================================
function ImagePickerWithAnimation({ value, onChange, label, showAnimationOptions, animation, onAnimationChange, animationSpeed, onSpeedChange }) {
  const animationOptions = [
    { value: 'none', label: 'Static (No Animation)' },
    { value: 'pan-left-right', label: 'Pan Left to Right' },
    { value: 'pan-right-left', label: 'Pan Right to Left' },
    { value: 'zoom-in', label: 'Slow Zoom In' },
    { value: 'zoom-out', label: 'Slow Zoom Out' },
    { value: 'ken-burns', label: 'Ken Burns (Pan + Zoom)' },
    { value: 'ken-burns-reverse', label: 'Ken Burns Reverse' },
  ];
  const speed = animationSpeed || 10;

  return (
    <div className="image-picker-with-animation">
      <ImagePicker
        value={value}
        onChange={onChange}
        label={label}
        aspectRatio="16/9"
        placeholder="Click to select hero image"
      />
      {showAnimationOptions && value && (
        <div className="animation-options" style={{ marginTop: '16px' }}>
          <label>Animation Effect</label>
          <select value={animation || 'none'} onChange={(e) => onAnimationChange(e.target.value)}>
            {animationOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          {animation && animation !== 'none' && (
            <>
              <label style={{ marginTop: '12px' }}>Animation Speed: {speed}s</label>
              <div className="speed-slider">
                <span>Fast</span>
                <input type="range" min="2" max="30" value={speed} onChange={(e) => onSpeedChange(Number(e.target.value))} />
                <span>Slow</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
// ============================================
// SEO ANALYZER PANEL
// ============================================
function SEOAnalyzer({ pageData }) {
  const analysis = useMemo(() => analyzeSEO(pageData), [pageData]);
  
  const getScoreColor = (score) => {
    if (score >= 80) return 'var(--admin-success)';
    if (score >= 60) return 'var(--admin-warning)';
    return 'var(--admin-error)';
  };

  return (
    <div className="seo-analyzer">
      <div className="seo-score" style={{ '--score-color': getScoreColor(analysis.score) }}>
        <div className="seo-score-circle">
          <span className="seo-score-number">{analysis.score}</span>
          <span className="seo-score-label">SEO Score</span>
        </div>
      </div>
      
      <div className="seo-stats">
        <div className="seo-stat">
          <span className="seo-stat-value">{analysis.stats.titleLength}</span>
          <span className="seo-stat-label">Title chars</span>
        </div>
        <div className="seo-stat">
          <span className="seo-stat-value">{analysis.stats.descriptionLength}</span>
          <span className="seo-stat-label">Desc chars</span>
        </div>
        <div className="seo-stat">
          <span className="seo-stat-value">{analysis.stats.wordCount}</span>
          <span className="seo-stat-label">Words</span>
        </div>
      </div>

      {analysis.issues.length > 0 && (
        <div className="seo-issues">
          <h4>⚠️ Issues</h4>
          <ul>{analysis.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        </div>
      )}
      
      {analysis.suggestions.length > 0 && (
        <div className="seo-suggestions">
          <h4>💡 Suggestions</h4>
          <ul>{analysis.suggestions.map((sug, i) => <li key={i}>{sug}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ============================================
// REVISION HISTORY PANEL
// ============================================
function RevisionPanel({ pageId, onRestore, onClose }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const toast = useToast();

  useEffect(() => {
    loadRevisions();
  }, [pageId]);

  const loadRevisions = async () => {
    setLoading(true);
    try {
      const data = await getRevisions(pageId);
      setRevisions(data || []);
    } catch (err) {
      toast.error('Failed to load revisions');
    }
    setLoading(false);
  };

  const handleRestore = async (revisionId) => {
    setRestoring(revisionId);
    try {
      const result = await restoreRevision(pageId, revisionId);
      toast.success('Revision restored');
      onRestore(result.page);
      onClose();
    } catch (err) {
      toast.error('Failed to restore: ' + err.message);
    }
    setRestoring(null);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="revision-panel">
      <div className="revision-header">
        <h3>Revision History</h3>
        <button className="revision-close" onClick={onClose}>×</button>
      </div>
      <div className="revision-list">
        {loading ? (
          <div className="revision-loading">Loading...</div>
        ) : revisions.length === 0 ? (
          <div className="revision-empty">No revisions yet. Revisions are created when you save changes.</div>
        ) : (
          revisions.map((rev, i) => (
            <div key={rev.id} className="revision-item">
              <div className="revision-info">
                <span className="revision-date">{formatDate(rev.savedAt)}</span>
                <span className="revision-label">{i === 0 ? 'Most recent' : `${i + 1} saves ago`}</span>
              </div>
              <button
                className="admin-btn admin-btn-secondary admin-btn-sm"
                onClick={() => handleRestore(rev.id)}
                disabled={restoring === rev.id}
              >
                {restoring === rev.id ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================
// LIVE PREVIEW
// ============================================
function LivePreview({ pageId }) {
  const [device, setDevice] = useState('desktop');
  
  let previewUrl = '/';
  if (pageId === 'home') previewUrl = '/';
  else if (pageId.includes('/')) {
    const [serviceId, subId] = pageId.split('/');
    previewUrl = `/services/${serviceId}/${subId}`;
  } else {
    previewUrl = `/services/${pageId}`;
  }

  const widths = { mobile: '375px', tablet: '768px', desktop: '100%' };

  return (
    <div className="live-preview-panel">
      <div className="live-preview-toolbar">
        <span className="preview-label">Live Preview</span>
        <div className="device-switcher">
          {['mobile', 'tablet', 'desktop'].map(d => (
            <button key={d} className={device === d ? 'active' : ''} onClick={() => setDevice(d)} title={d}>
              {d === 'mobile' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>}
              {d === 'tablet' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>}
              {d === 'desktop' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>}
            </button>
          ))}
        </div>
        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="preview-open-btn">Open ↗</a>
      </div>
      <div className="live-preview-frame" style={{ maxWidth: widths[device] }}>
        <iframe src={previewUrl} title="Preview" />
      </div>
    </div>
  );
}

// ============================================
// SAVE STATUS
// ============================================
function SaveStatus({ status, lastSaved }) {
  const config = {
    saved: { icon: '✓', text: 'Saved', class: 'status-saved' },
    saving: { icon: '↻', text: 'Saving...', class: 'status-saving' },
    unsaved: { icon: '●', text: 'Unsaved', class: 'status-unsaved' },
    error: { icon: '!', text: 'Error', class: 'status-error' }
  };
  const c = config[status] || config.saved;

  return (
    <div className={`save-status ${c.class}`}>
      <span className="save-status-icon">{c.icon}</span>
      <span className="save-status-text">{c.text}</span>
      {lastSaved && status === 'saved' && (
        <span className="save-status-time">{new Date(lastSaved).toLocaleTimeString()}</span>
      )}
    </div>
  );
}

// ============================================
// DUPLICATE MODAL
// ============================================
function DuplicateModal({ pageId, pageTitle, onClose, onDuplicate }) {
  const [newId, setNewId] = useState(pageId + '-copy');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleDuplicate = async () => {
    if (!newId.trim()) return;
    setLoading(true);
    try {
      await duplicatePage(pageId, newId);
      toast.success('Page duplicated');
      onDuplicate(newId);
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>Duplicate Page</h3>
        <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
          Create a copy of "{pageTitle}"
        </p>
        <div className="form-group">
          <label>New Page ID</label>
          <input type="text" value={newId} onChange={e => setNewId(e.target.value)} placeholder="new-page-id" />
        </div>
        <div className="modal-actions">
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={handleDuplicate} disabled={loading}>
            {loading ? 'Duplicating...' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN PAGE EDITOR
// ============================================
function PageEditor() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  
  // Core state
  const [pageData, setPageData] = useState(null);
  const [formData, setFormData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [lastSaved, setLastSaved] = useState(null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('content');
  const [showPreview, setShowPreview] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [imageInsertCallback, setImageInsertCallback] = useState(null);
  
  // Undo/Redo
  const { push: pushHistory, undo, redo, canUndo, canRedo, reset: resetHistory } = useUndoRedo({});
  
  const decodedPageId = decodeURIComponent(pageId);
  const hasUnsavedChanges = JSON.stringify(formData) !== JSON.stringify(originalData);

  // Load page
  useEffect(() => {
    loadPageData();
  }, [decodedPageId]);

  const loadPageData = async () => {
    setLoading(true);
    
    let data = null;
    if (decodedPageId === 'home') {
      data = {
        type: 'home', title: 'Home Page',
        heroTitle: 'Eau Claire Area Contractor',
        heroSubtitle: 'Roofing • Siding • Windows • Insulation • Remodeling',
        heroTagline: 'YOUR TRUSTED LOCAL CONTRACTOR',
        heroDescription: 'Serving the Chippewa Valley with Quality Craftsmanship'
      };
    } else if (decodedPageId.includes('/')) {
      const [serviceId, subId] = decodedPageId.split('/');
      const sub = getSubServiceById(serviceId, subId);
      if (sub) data = { type: 'subservice', id: decodedPageId, ...sub };
    } else {
      const service = getServiceById(decodedPageId);
      if (service) data = { type: 'service', id: decodedPageId, ...service };
    }

    try {
      const saved = await getPage(decodedPageId);
      if (saved) data = { ...data, ...saved };
    } catch (err) {
      console.error('Load error:', err);
    }

    setPageData(data);
    setFormData(data || {});
    setOriginalData(data || {});
    resetHistory(data || {});
    setLoading(false);
  };

  // Autosave
  useEffect(() => {
    if (!hasUnsavedChanges || saveStatus === 'saving') return;
    const timer = setTimeout(() => handleSave(true), 30000);
    return () => clearTimeout(timer);
  }, [formData, hasUnsavedChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      
      // Save
      if (isMod && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Undo
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Redo
      if (isMod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      if (isMod && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formData, canUndo, canRedo]);

  // Unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Update status
  useEffect(() => {
    if (hasUnsavedChanges && saveStatus === 'saved') setSaveStatus('unsaved');
  }, [formData]);

  const handleChange = useCallback((field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    pushHistory(newData);
  }, [formData, pushHistory]);

  const handleUndo = useCallback(() => {
    const prev = undo();
    if (prev) setFormData(prev);
  }, [undo]);

  const handleRedo = useCallback(() => {
    const next = redo();
    if (next) setFormData(next);
  }, [redo]);

  const handleSave = useCallback(async (isAutosave = false) => {
    setSaveStatus('saving');
    try {
      await savePage(decodedPageId, { ...formData, status: formData.status || 'published' });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setOriginalData(formData);
      if (!isAutosave) toast.success('Page saved');
    } catch (err) {
      setSaveStatus('error');
      toast.error('Save failed: ' + err.message);
    }
  }, [decodedPageId, formData, toast]);

  const handleSaveDraft = useCallback(async () => {
    setSaveStatus('saving');
    try {
      await savePage(decodedPageId, { ...formData, status: 'draft' });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setOriginalData({ ...formData, status: 'draft' });
      setFormData(prev => ({ ...prev, status: 'draft' }));
      toast.success('Draft saved');
    } catch (err) {
      setSaveStatus('error');
      toast.error('Save failed');
    }
  }, [decodedPageId, formData, toast]);

  const handlePublish = useCallback(async () => {
    setSaveStatus('saving');
    try {
      await savePage(decodedPageId, { ...formData, status: 'published' });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setOriginalData({ ...formData, status: 'published' });
      setFormData(prev => ({ ...prev, status: 'published' }));
      toast.success('Page published!');
    } catch (err) {
      setSaveStatus('error');
      toast.error('Publish failed');
    }
  }, [decodedPageId, formData, toast]);

  const handleSchedule = useCallback(async () => {
    if (!formData.scheduledAt) {
      toast.error('Please select a date and time');
      return;
    }
    setSaveStatus('saving');
    try {
      await savePage(decodedPageId, { ...formData, status: 'scheduled', scheduledAt: formData.scheduledAt });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setOriginalData({ ...formData, status: 'scheduled' });
      setFormData(prev => ({ ...prev, status: 'scheduled' }));
      setShowSchedule(false);
      toast.success('Page scheduled for ' + new Date(formData.scheduledAt).toLocaleString());
    } catch (err) {
      setSaveStatus('error');
      toast.error('Schedule failed');
    }
  }, [decodedPageId, formData, toast]);

  const handleRevisionRestore = (restoredPage) => {
    setFormData(restoredPage);
    setOriginalData(restoredPage);
    resetHistory(restoredPage);
  };

  const getBreadcrumbs = () => {
    const crumbs = [
      { label: 'Dashboard', to: '/admin' },
      { label: 'Pages', to: '/pages' }
    ];
    if (decodedPageId === 'home') {
      crumbs.push({ label: 'Home Page' });
    } else if (decodedPageId.includes('/')) {
      const [serviceId, subId] = decodedPageId.split('/');
      const service = getServiceById(serviceId);
      if (service) {
        crumbs.push({ label: service.title, to: `/edit/${serviceId}` });
        const sub = getSubServiceById(serviceId, subId);
        if (sub) crumbs.push({ label: sub.title });
      }
    } else {
      const service = getServiceById(decodedPageId);
      if (service) crumbs.push({ label: service.title });
    }
    return crumbs;
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="editor-loading">
          <div className="loading-skeleton">
            <div className="skeleton-header"></div>
            <div className="skeleton-tabs"></div>
            <div className="skeleton-content"></div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!pageData) {
    return (
      <AdminLayout title="Page Not Found">
        <div className="editor-error">
          <p>The page "{decodedPageId}" does not exist.</p>
          <Link to="/pages" className="admin-btn admin-btn-primary">Back to Pages</Link>
        </div>
      </AdminLayout>
    );
  }

  const isDraft = formData.status === 'draft';

  return (
    <AdminLayout>
      {/* Editor Header */}
      <div className="editor-header">
        <div className="editor-header-left">
          <nav className="breadcrumbs">
            {getBreadcrumbs().map((crumb, i, arr) => (
              <span key={i}>
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span className="current">{crumb.label}</span>}
                {i < arr.length - 1 && <span className="separator">/</span>}
              </span>
            ))}
          </nav>
          <h1>
            {formData.title || 'Edit Page'}
            {isDraft && <span className="draft-badge">Draft</span>}
            {formData.status === 'scheduled' && <span className="scheduled-badge">⏰ Scheduled: {new Date(formData.scheduledAt).toLocaleDateString()}</span>}
          </h1>
        </div>
        <div className="editor-header-right">
          {/* Undo/Redo */}
          <div className="undo-redo-group">
            <button className="icon-btn" onClick={handleUndo} disabled={!canUndo} title="Undo (⌘Z)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button className="icon-btn" onClick={handleRedo} disabled={!canRedo} title="Redo (⌘⇧Z)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
            </button>
          </div>
          
          <SaveStatus status={saveStatus} lastSaved={lastSaved} />
          
          {/* Actions dropdown */}
          <div className="dropdown">
            <button className="admin-btn admin-btn-secondary dropdown-trigger">
              Actions ▾
            </button>
            <div className="dropdown-menu">
              <button onClick={() => setShowRevisions(true)}>📜 Revision History</button>
              <button onClick={() => setShowDuplicate(true)}>📋 Duplicate Page</button>
              <button onClick={() => setShowPreview(!showPreview)}>👁 {showPreview ? 'Hide' : 'Show'} Preview</button>
              <button onClick={() => setShowSchedule(!showSchedule)}>⏰ Schedule</button>
            </div>
          </div>
          
          {/* Schedule Picker */}
          {showSchedule && (
            <div className="schedule-picker">
              <input 
                type="datetime-local" 
                value={formData.scheduledAt || ''} 
                onChange={(e) => handleChange('scheduledAt', e.target.value)}
              />
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={handleSchedule} disabled={!formData.scheduledAt}>
                Schedule Publish
              </button>
            </div>
          )}
          
          {/* Save buttons */}
          <button className="admin-btn admin-btn-secondary" onClick={handleSaveDraft}>
            Save Draft
          </button>
          <button className="admin-btn admin-btn-primary" onClick={handlePublish} disabled={saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving...' : 'Publish'}
            <kbd>⌘S</kbd>
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className={`editor-container ${showPreview ? 'with-preview' : ''}`}>
        <div className="editor-main">
          {/* Tabs */}
          <div className="editor-tabs">
            <button className={activeTab === 'content' ? 'active' : ''} onClick={() => setActiveTab('content')}>Content</button>
            <button className={activeTab === 'images' ? 'active' : ''} onClick={() => setActiveTab('images')}>Images</button>
            <button className={activeTab === 'seo' ? 'active' : ''} onClick={() => setActiveTab('seo')}>SEO</button>
          </div>

          {/* Tab Content */}
          <div className="editor-tab-content">
            {activeTab === 'content' && (
              <div className="tab-panel">
                {formData.type === 'home' ? (
                  <>
                    <div className="form-group">
                      <label>Hero Tagline</label>
                      <input type="text" value={formData.heroTagline || ''} onChange={(e) => handleChange('heroTagline', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Hero Title</label>
                      <input type="text" value={formData.heroTitle || ''} onChange={(e) => handleChange('heroTitle', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Hero Subtitle</label>
                      <input type="text" value={formData.heroSubtitle || ''} onChange={(e) => handleChange('heroSubtitle', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Hero Description</label>
                      <textarea value={formData.heroDescription || ''} onChange={(e) => handleChange('heroDescription', e.target.value)} rows={3} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="form-group">
                      <label>Page Title</label>
                      <input type="text" value={formData.title || ''} onChange={(e) => handleChange('title', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Tagline</label>
                      <input type="text" value={formData.tagline || ''} onChange={(e) => handleChange('tagline', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Hero Description</label>
                      <textarea value={formData.heroDescription || ''} onChange={(e) => handleChange('heroDescription', e.target.value)} rows={3} />
                    </div>
                    <div className="form-group">
                      <label>Page Content</label>
                      <WysiwygEditor
  value={(formData.type === 'service' || formData.type === 'subservice') ? (formData.description || '') : (formData.content || '')}
  onChange={(val) => handleChange((formData.type === 'service' || formData.type === 'subservice') ? 'description' : 'content', val)}
                        placeholder="Enter page content..."
                        onImageInsert={(cb) => {
                          setImageInsertCallback(() => cb);
                          setActiveTab('images');
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'images' && (
              <div className="tab-panel">
                <ImagePickerWithAnimation
                  label="Hero Background Image"
                  value={formData.heroImage}
                  onChange={(val) => handleChange('heroImage', val)}
                  showAnimationOptions={true}
                  animation={formData.heroAnimation}
                  onAnimationChange={(val) => handleChange('heroAnimation', val)}
                  animationSpeed={formData.heroAnimationSpeed}
                  onSpeedChange={(val) => handleChange('heroAnimationSpeed', val)}
                />
                
                {imageInsertCallback && (
                  <div className="image-insert-helper" style={{ marginTop: '24px', padding: '16px', background: 'var(--admin-info-bg)', borderRadius: '8px' }}>
                    <p>Select an image to insert into content, or upload a new one:</p>
                    <ImagePickerWithAnimation
                      label="Insert Image"
                      value=""
                      onChange={(url) => {
                        if (url && imageInsertCallback) {
                          imageInsertCallback(url.startsWith('http') ? url : `${UPLOAD_BASE}${url}`);
                          setImageInsertCallback(null);
                          setActiveTab('content');
                          toast.success('Image inserted');
                        }
                      }}
                    />
                    <button className="admin-btn admin-btn-secondary admin-btn-sm" style={{ marginTop: '8px' }}
                      onClick={() => { setImageInsertCallback(null); setActiveTab('content'); }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'seo' && (
              <div className="tab-panel">
                <div className="seo-grid">
                  <div className="seo-fields">
                    <div className="form-group">
                      <label>Meta Title</label>
                      <input type="text" value={formData.metaTitle || ''} onChange={(e) => handleChange('metaTitle', e.target.value)} placeholder={formData.title} />
                      <span className="field-hint">{(formData.metaTitle || formData.title || '').length}/60 characters</span>
                    </div>
                    <div className="form-group">
                      <label>Meta Description</label>
                      <textarea value={formData.metaDescription || ''} onChange={(e) => handleChange('metaDescription', e.target.value)} placeholder="Describe this page for search engines..." rows={3} />
                      <span className="field-hint">{(formData.metaDescription || '').length}/160 characters</span>
                    </div>
                    
                    {/* Social Media Preview */}
                    <div className="social-preview" style={{ marginTop: '24px' }}>
                      <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Social Media Preview</h3>
                      <div className="preview-tabs">
                        <button className="active">Facebook</button>
                        <button>Twitter</button>
                      </div>
                      <div className="preview-card">
                        <div className="preview-card-image">
                          {formData.heroImage || formData.socialImage ? (
                            <img src={formData.socialImage || formData.heroImage} alt="" 
                              onError={(e) => e.target.style.display = 'none'} />
                          ) : (
                            <span style={{ color: 'var(--admin-text-muted)', fontSize: '0.875rem' }}>No image set</span>
                          )}
                        </div>
                        <div className="preview-card-content">
                          <div className="preview-card-domain">{{COMPANY_DOMAIN}}</div>
                          <div className="preview-card-title">{formData.metaTitle || formData.title || 'Page Title'}</div>
                          <div className="preview-card-desc">{formData.metaDescription || 'Add a meta description to see how it appears when shared.'}</div>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginTop: '8px' }}>
                        This is how your page will look when shared on social media.
                      </p>
                    </div>
                  </div>
                  <SEOAnalyzer pageData={formData} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Preview */}
        {showPreview && <LivePreview pageId={decodedPageId} />}
      </div>

      {/* Modals */}
      {showRevisions && (
        <div className="modal-overlay" onClick={() => setShowRevisions(false)}>
          <div className="modal-content modal-lg" onClick={e => e.stopPropagation()}>
            <RevisionPanel pageId={decodedPageId} onRestore={handleRevisionRestore} onClose={() => setShowRevisions(false)} />
          </div>
        </div>
      )}
      
      {showDuplicate && (
        <DuplicateModal
          pageId={decodedPageId}
          pageTitle={formData.title}
          onClose={() => setShowDuplicate(false)}
          onDuplicate={(newId) => navigate(`/edit/${encodeURIComponent(newId)}`)}
        />
      )}
    </AdminLayout>
  );
}

export default PageEditor;
