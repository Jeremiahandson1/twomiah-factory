import React, { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { uploadImage } from './api';
import ImagePicker from './ImagePicker';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ICONS = ['🏠', '🏗️', '🪟', '🧊', '🔨', '🏡', '🔧', '⚡', '🚿', '🌳', '🎨', '🛠️'];

const EMPTY_FORM = {
  id: '', title: '', description: '', image: '', icon: '🔧', featured: true, links: [],
  tagline: '', heroDescription: '', heroImage: '', fullDescription: '',
  offerings: [], materials: [], features: [], faqs: [], subServices: []
};

const EMPTY_SUB = {
  id: '', title: '', tagline: '', heroDescription: '', heroImage: '', description: '',
  offerings: [], materials: [], features: [], faqs: []
};

// ═══════════════════════════════════════════
// Reusable editor panels for offerings/materials/features/faqs
// Used by both main service and sub-service editing
// ═══════════════════════════════════════════

function OfferingsEditor({ items, onChange }) {
  const add = () => onChange([...items, { title: '', description: '' }]);
  const update = (i, field, val) => { const a = [...items]; a[i] = { ...a[i], [field]: val }; onChange(a); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const a = [...items]; const j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; onChange(a);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ color: 'var(--admin-text-secondary)', margin: 0 }}>Numbered service cards shown on the page</p>
        <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={add}>+ Add Offering</button>
      </div>
      {items.length === 0 && <div className="empty-state" style={{ padding: '30px 20px' }}><p>No offerings yet.</p></div>}
      {items.map((o, i) => (
        <div key={i} style={{ border: '1px solid var(--admin-border)', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: 'var(--admin-bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ background: 'var(--admin-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '600' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
              <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => remove(i)}>×</button>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: '8px' }}>
            <label>Title</label>
            <input type="text" value={o.title} onChange={e => update(i, 'title', e.target.value)} placeholder="Roof Replacement" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Description</label>
            <textarea value={o.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Complete tear-off and installation..." rows={2} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListEditor({ items, onChange, label, placeholder }) {
  const add = () => onChange([...items, '']);
  const update = (i, val) => { const a = [...items]; a[i] = val; onChange(a); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ margin: 0 }}>{label}</h4>
        <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={add}>+ Add</button>
      </div>
      {items.length === 0 && <p style={{ color: 'var(--admin-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>None yet.</p>}
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
          <span style={{ color: 'var(--admin-success)', fontWeight: 'bold' }}>✓</span>
          <input type="text" value={item} onChange={e => update(i, e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
          <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => remove(i)}>×</button>
        </div>
      ))}
    </div>
  );
}

function FaqsEditor({ items, onChange }) {
  const add = () => onChange([...items, { question: '', answer: '' }]);
  const update = (i, field, val) => { const a = [...items]; a[i] = { ...a[i], [field]: val }; onChange(a); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ color: 'var(--admin-text-secondary)', margin: 0 }}>FAQs shown at the bottom of the page</p>
        <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={add}>+ Add FAQ</button>
      </div>
      {items.length === 0 && <div className="empty-state" style={{ padding: '30px 20px' }}><p>No FAQs yet.</p></div>}
      {items.map((faq, i) => (
        <div key={i} style={{ border: '1px solid var(--admin-border)', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: 'var(--admin-bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <strong style={{ color: 'var(--admin-text-secondary)' }}>FAQ #{i + 1}</strong>
            <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => remove(i)}>× Remove</button>
          </div>
          <div className="form-group" style={{ marginBottom: '8px' }}>
            <label>Question</label>
            <input type="text" value={faq.question} onChange={e => update(i, 'question', e.target.value)} placeholder="How long does it take?" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Answer</label>
            <textarea value={faq.answer} onChange={e => update(i, 'answer', e.target.value)} placeholder="Most projects take 1-3 days..." rows={3} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
// Sub-Service Editor (opened from within a service)
// ═══════════════════════════════════════════

function SubServiceEditor({ sub, onSave, onCancel, parentTitle }) {
  const [data, setData] = useState({ ...EMPTY_SUB, ...sub });
  const [tab, setTab] = useState('basic');

  const set = (field, val) => setData(prev => ({ ...prev, [field]: val }));

  const generateId = (title) => title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

  return (
    <div style={{ border: '2px solid var(--admin-primary)', borderRadius: '12px', padding: '20px', marginBottom: '16px', background: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>{sub.id ? `Editing: ${data.title}` : 'Add Sub-Service'}</h4>
        <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={onCancel}>Cancel</button>
      </div>

      <div className="editor-tabs" style={{ marginBottom: '20px' }}>
        <button className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>Basic</button>
        <button className={tab === 'offerings' ? 'active' : ''} onClick={() => setTab('offerings')}>Offerings ({data.offerings.length})</button>
        <button className={tab === 'materials' ? 'active' : ''} onClick={() => setTab('materials')}>Materials & Why Us</button>
        <button className={tab === 'faqs' ? 'active' : ''} onClick={() => setTab('faqs')}>FAQs ({data.faqs.length})</button>
      </div>

      {tab === 'basic' && (
        <div>
          <div className="form-row">
            <div className="form-group">
              <label>Title *</label>
              <input type="text" value={data.title} onChange={e => { set('title', e.target.value); if (!sub.id) set('id', generateId(e.target.value)); }} placeholder="Asphalt Shingles" />
            </div>
            <div className="form-group">
              <label>URL Slug *</label>
              <input type="text" value={data.id} onChange={e => set('id', e.target.value)} placeholder="asphalt-shingles" disabled={!!sub.id} />
              <span className="field-hint">/services/{parentTitle?.toLowerCase().split(' ')[0] || 'service'}/{data.id || 'slug'}</span>
            </div>
          </div>
          <div className="form-group">
            <label>Tagline</label>
            <input type="text" value={data.tagline} onChange={e => set('tagline', e.target.value)} placeholder="America's Most Popular Roofing Choice" />
          </div>
          <div className="form-group">
            <label>Hero Description</label>
            <textarea value={data.heroDescription} onChange={e => set('heroDescription', e.target.value)} placeholder="One-liner for the hero banner..." rows={2} />
          </div>
          <div className="form-group">
            <label>Hero Image</label>
            <ImagePicker value={data.heroImage} onChange={(url) => set('heroImage', url)} aspectRatio="16/9" folder="Services" label="Hero background (1920x600)" />
          </div>
          <div className="form-group">
            <label>Page Description</label>
            <textarea value={data.description} onChange={e => set('description', e.target.value)} placeholder="Full description. Separate paragraphs with blank lines." rows={5} />
          </div>
        </div>
      )}

      {tab === 'offerings' && (
        <OfferingsEditor items={data.offerings} onChange={val => set('offerings', val)} />
      )}

      {tab === 'materials' && (
        <div>
          <ListEditor items={data.materials} onChange={val => set('materials', val)} label="🛡️ Materials We Use" placeholder="Premium Material" />
          <ListEditor items={data.features} onChange={val => set('features', val)} label="🏆 Why Choose Us" placeholder="50-year warranty options" />
        </div>
      )}

      {tab === 'faqs' && (
        <FaqsEditor items={data.faqs} onChange={val => set('faqs', val)} />
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--admin-border)' }}>
        <button className="admin-btn admin-btn-primary" onClick={() => onSave(data)}>
          {sub.id ? 'Save Sub-Service' : 'Add Sub-Service'}
        </button>
        <button className="admin-btn admin-btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

function AdminServicesManager() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('basic');
  const [editingSub, setEditingSub] = useState(null); // null | 'new' | index
  const [draggedIndex, setDraggedIndex] = useState(null);
  const toast = useToast();

  useEffect(() => { loadServices(); }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/services-data`);
      setServices(await response.json());
    } catch (err) { toast.error('Failed to load services'); }
    setLoading(false);
  };

  const getToken = () => localStorage.getItem('adminToken');

  const handleSave = async () => {
    if (!formData.id || !formData.title) { toast.error('Service ID and title are required'); return; }
    if (!/^[a-z0-9-]+$/.test(formData.id)) { toast.error('ID: lowercase letters, numbers, hyphens only'); return; }

    setSaving(true);
    try {
      const url = editing ? `${API_BASE}/admin/services-data/${editing}` : `${API_BASE}/admin/services-data`;
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        toast.success(editing ? 'Service updated!' : 'Service added!');
        loadServices(); setEditing(null); setShowForm(false); resetForm();
      } else { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this service?')) return;
    try {
      const r = await fetch(`${API_BASE}/admin/services-data/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } });
      if (r.ok) { toast.success('Deleted'); loadServices(); }
    } catch (err) { toast.error('Failed to delete'); }
  };

  const handleEdit = (service) => {
    setEditing(service.id);
    setFormData({
      ...EMPTY_FORM, ...service,
      links: service.links || [], offerings: service.offerings || [],
      materials: service.materials || [], features: service.features || [],
      faqs: service.faqs || [], subServices: service.subServices || []
    });
    setShowForm(true); setActiveTab('basic'); setEditingSub(null);
  };

  const resetForm = () => { setFormData({ ...EMPTY_FORM }); setActiveTab('basic'); setEditingSub(null); };

  const generateId = (title) => title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

  // Link helpers
  const addLink = () => setFormData(p => ({ ...p, links: [...p.links, { label: '', href: '' }] }));
  const updateLink = (i, f, v) => { const a = [...formData.links]; a[i] = { ...a[i], [f]: v }; setFormData(p => ({ ...p, links: a })); };
  const removeLink = (i) => setFormData(p => ({ ...p, links: p.links.filter((_, idx) => idx !== i) }));

  // Sub-service CRUD
  const saveSub = (subData) => {
    const subs = [...formData.subServices];
    if (editingSub === 'new') {
      if (!subData.id || !subData.title) { toast.error('Sub-service needs ID and title'); return; }
      if (subs.find(s => s.id === subData.id)) { toast.error('Sub-service ID already exists'); return; }
      subs.push(subData);
    } else {
      subs[editingSub] = subData;
    }
    setFormData(p => ({ ...p, subServices: subs }));
    setEditingSub(null);
    toast.success('Sub-service saved (remember to save the main service)');
  };
  const removeSub = (i) => {
    if (!confirm('Remove this sub-service?')) return;
    setFormData(p => ({ ...p, subServices: p.subServices.filter((_, idx) => idx !== i) }));
  };

  // Drag reorder
  const handleDragStart = (i) => setDraggedIndex(i);
  const handleDragOver = (e, i) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === i) return;
    const a = [...services]; const [d] = a.splice(draggedIndex, 1); a.splice(i, 0, d);
    setServices(a); setDraggedIndex(i);
  };
  const handleDragEnd = async () => {
    if (draggedIndex === null) return;
    try {
      await fetch(`${API_BASE}/admin/services-data/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ order: services.map(s => s.id) })
      });
      toast.success('Order saved');
    } catch (err) { toast.error('Failed to save order'); }
    setDraggedIndex(null);
  };

  const countContent = (svc) => {
    let c = 0;
    if (svc.offerings?.length) c++; if (svc.materials?.length) c++;
    if (svc.features?.length) c++; if (svc.faqs?.length) c++;
    if (svc.subServices?.length) c++;
    return c;
  };

  // ════════════════════════════════════
  return (
    <AdminLayout 
      title="Services Manager" 
      subtitle="Edit homepage cards, service pages, and sub-service pages"
      actions={
        !showForm ? (
          <button className="admin-btn admin-btn-primary" onClick={() => { setShowForm(true); setEditing(null); resetForm(); }}>+ Add Service</button>
        ) : (
          <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Service'}
          </button>
        )
      }
    >
      {/* ═══════ EDITOR ═══════ */}
      {showForm && (
        <div className="admin-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>{editing ? `Editing: ${formData.title}` : 'Add New Service'}</h3>
            <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}>← Back to List</button>
          </div>

          <div className="editor-tabs" style={{ marginBottom: '24px' }}>
            <button className={activeTab === 'basic' ? 'active' : ''} onClick={() => setActiveTab('basic')}>Basic Info</button>
            <button className={activeTab === 'hero' ? 'active' : ''} onClick={() => setActiveTab('hero')}>Hero / Page Intro</button>
            <button className={activeTab === 'offerings' ? 'active' : ''} onClick={() => setActiveTab('offerings')}>Offerings ({formData.offerings.length})</button>
            <button className={activeTab === 'materials' ? 'active' : ''} onClick={() => setActiveTab('materials')}>Materials & Why Us</button>
            <button className={activeTab === 'faqs' ? 'active' : ''} onClick={() => setActiveTab('faqs')}>FAQs ({formData.faqs.length})</button>
            <button className={activeTab === 'subs' ? 'active' : ''} onClick={() => setActiveTab('subs')} style={{ borderColor: formData.subServices.length > 0 ? 'var(--admin-primary)' : undefined }}>
              Sub-Services ({formData.subServices.length})
            </button>
          </div>

          {/* ─── Basic Info ─── */}
          {activeTab === 'basic' && (
            <div className="settings-panel">
              <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>Homepage card info and navigation.</p>
              <div className="form-row">
                <div className="form-group">
                  <label>Service Title *</label>
                  <input type="text" value={formData.title} onChange={e => { const t = e.target.value; setFormData(p => ({ ...p, title: t, id: editing ? p.id : generateId(t) })); }} placeholder="Roofing" />
                </div>
                <div className="form-group">
                  <label>URL Slug *</label>
                  <input type="text" value={formData.id} onChange={e => setFormData(p => ({ ...p, id: e.target.value }))} placeholder="roofing" disabled={!!editing} />
                  <span className="field-hint">URL: /services/{formData.id || 'slug'}</span>
                </div>
              </div>
              <div className="form-group">
                <label>Homepage Card Description</label>
                <textarea value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Short description for homepage card..." rows={3} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Icon</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {ICONS.map(icon => (
                      <button key={icon} type="button" onClick={() => setFormData(p => ({ ...p, icon }))}
                        style={{ width: '40px', height: '40px', fontSize: '20px', border: formData.icon === icon ? '2px solid var(--admin-primary)' : '1px solid var(--admin-border)', borderRadius: '8px', background: formData.icon === icon ? 'var(--admin-primary-light)' : 'white', cursor: 'pointer' }}>
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', marginTop: '28px' }}>
                    <input type="checkbox" checked={formData.featured} onChange={e => setFormData(p => ({ ...p, featured: e.target.checked }))} style={{ marginRight: '8px' }} />
                    Show on homepage
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label>Homepage Card Image</label>
                <ImagePicker value={formData.image} onChange={(url) => setFormData(p => ({ ...p, image: url }))} aspectRatio="4/3" folder="Services" label="Service image (800x600)" />
              </div>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label style={{ margin: 0 }}>Quick Links (homepage card)</label>
                  <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={addLink}>+ Add Link</button>
                </div>
                {formData.links.map((link, i) => (
                  <div key={i} className="form-row" style={{ marginBottom: '8px' }}>
                    <div className="form-group" style={{ margin: 0 }}><input type="text" value={link.label} onChange={e => updateLink(i, 'label', e.target.value)} placeholder="Link Label" /></div>
                    <div className="form-group" style={{ margin: 0 }}><input type="text" value={link.href} onChange={e => updateLink(i, 'href', e.target.value)} placeholder="/services/roofing" /></div>
                    <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => removeLink(i)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Hero / Page Intro ─── */}
          {activeTab === 'hero' && (
            <div className="settings-panel">
              <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>Hero banner and intro for <strong>/services/{formData.id}</strong></p>
              <div className="form-group">
                <label>Tagline</label>
                <input type="text" value={formData.tagline} onChange={e => setFormData(p => ({ ...p, tagline: e.target.value }))} placeholder="Protect Your Home From the Top Down" />
              </div>
              <div className="form-group">
                <label>Hero Description</label>
                <textarea value={formData.heroDescription} onChange={e => setFormData(p => ({ ...p, heroDescription: e.target.value }))} placeholder="One-liner for the hero banner..." rows={2} />
              </div>
              <div className="form-group">
                <label>Hero Background Image</label>
                <ImagePicker value={formData.heroImage} onChange={(url) => setFormData(p => ({ ...p, heroImage: url }))} aspectRatio="16/9" folder="Services" label="Hero background (1920x600)" />
              </div>
              <div className="form-group">
                <label>Full Page Description</label>
                <textarea value={formData.fullDescription} onChange={e => setFormData(p => ({ ...p, fullDescription: e.target.value }))} placeholder="Detailed description. Separate paragraphs with blank lines." rows={6} />
                <span className="field-hint">Replaces the short description on the service page</span>
              </div>
            </div>
          )}

          {/* ─── Offerings ─── */}
          {activeTab === 'offerings' && (
            <div className="settings-panel">
              <OfferingsEditor items={formData.offerings} onChange={val => setFormData(p => ({ ...p, offerings: val }))} />
            </div>
          )}

          {/* ─── Materials & Features ─── */}
          {activeTab === 'materials' && (
            <div className="settings-panel">
              <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>Two-column section below offerings on the service page.</p>
              <ListEditor items={formData.materials} onChange={val => setFormData(p => ({ ...p, materials: val }))} label="🛡️ Materials We Use" placeholder="Premium Brand Material" />
              <ListEditor items={formData.features} onChange={val => setFormData(p => ({ ...p, features: val }))} label="🏆 Why Choose Us" placeholder="Industry Certified Professional" />
            </div>
          )}

          {/* ─── FAQs ─── */}
          {activeTab === 'faqs' && (
            <div className="settings-panel">
              <FaqsEditor items={formData.faqs} onChange={val => setFormData(p => ({ ...p, faqs: val }))} />
            </div>
          )}

          {/* ─── Sub-Services ─── */}
          {activeTab === 'subs' && (
            <div className="settings-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <p style={{ color: 'var(--admin-text-secondary)', margin: 0 }}>
                    Sub-pages like <strong>/services/{formData.id}/asphalt-shingles</strong> — each has its own offerings, materials, features, and FAQs.
                  </p>
                </div>
                {editingSub === null && (
                  <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setEditingSub('new')}>+ Add Sub-Service</button>
                )}
              </div>

              {/* Sub-service editor */}
              {editingSub !== null && (
                <SubServiceEditor
                  sub={editingSub === 'new' ? { ...EMPTY_SUB } : formData.subServices[editingSub]}
                  parentTitle={formData.title}
                  onSave={saveSub}
                  onCancel={() => setEditingSub(null)}
                />
              )}

              {/* Sub-service list */}
              {editingSub === null && formData.subServices.length === 0 && (
                <div className="empty-state" style={{ padding: '40px 20px' }}><p>No sub-services yet.</p></div>
              )}

              {editingSub === null && formData.subServices.map((sub, i) => (
                <div key={sub.id} style={{
                  border: '1px solid var(--admin-border)', borderRadius: '8px', padding: '16px',
                  marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <strong>{sub.title}</strong>
                    <span style={{ color: 'var(--admin-text-muted)', fontSize: '13px', marginLeft: '12px' }}>
                      /services/{formData.id}/{sub.id}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                      {sub.offerings?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{sub.offerings.length} offerings</span>}
                      {sub.materials?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{sub.materials.length} materials</span>}
                      {sub.features?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{sub.features.length} features</span>}
                      {sub.faqs?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{sub.faqs.length} FAQs</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setEditingSub(i)}>✏️ Edit</button>
                    <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => removeSub(i)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bottom save */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px', padding: '16px 0', borderTop: '1px solid var(--admin-border)' }}>
            <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Service'}
            </button>
            <button className="admin-btn admin-btn-secondary" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ═══════ SERVICE LIST ═══════ */}
      {!showForm && (
        <div className="admin-section">
          <h3 style={{ marginBottom: '16px' }}>All Services ({services.length})</h3>
          <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>Drag to reorder. Click Edit to change page content.</p>

          {loading ? (
            <div className="loading-skeleton"><div className="skeleton-content" style={{ height: '200px' }}></div></div>
          ) : services.length === 0 ? (
            <div className="empty-state"><p>No services yet.</p></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
              {services.map((service, index) => (
                <div key={service.id} className="card" draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  style={{ cursor: 'grab', opacity: draggedIndex === index ? 0.5 : 1, overflow: 'hidden' }}>
                  {service.image && <div style={{ height: '140px', background: `url(${getImageUrl(service.image)}) center/cover` }} />}
                  <div style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '24px' }}>{service.icon}</span>
                      <div>
                        <h4 style={{ margin: 0 }}>{service.title}</h4>
                        <span style={{ color: 'var(--admin-text-secondary)', fontSize: '12px' }}>/services/{service.id}</span>
                      </div>
                      {service.featured && (
                        <span style={{ background: 'var(--admin-success-bg)', color: 'var(--admin-success)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', marginLeft: 'auto' }}>Featured</span>
                      )}
                    </div>
                    {service.description && (
                      <p style={{ color: 'var(--admin-text-secondary)', fontSize: '14px', margin: '8px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{service.description}</p>
                    )}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      {service.offerings?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{service.offerings.length} offerings</span>}
                      {service.materials?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{service.materials.length} materials</span>}
                      {service.faqs?.length > 0 && <span style={{ background: 'var(--admin-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>{service.faqs.length} FAQs</span>}
                      {service.subServices?.length > 0 && <span style={{ background: 'var(--admin-primary-light)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-primary)' }}>{service.subServices.length} sub-services</span>}
                      {countContent(service) === 0 && <span style={{ background: 'var(--admin-warning-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--admin-warning)' }}>No page content</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => handleEdit(service)}>✏️ Edit</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(service.id)}>🗑️</button>
                      <a href={`/services/${service.id}`} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary admin-btn-sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>👁️ View</a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminServicesManager;
