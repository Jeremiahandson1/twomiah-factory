import React, { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import ImagePicker from './ImagePicker';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function AdminHomepage() {
  const [homepage, setHomepage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('hero');
  const toast = useToast();

  useEffect(() => {
    loadHomepage();
  }, []);

  const loadHomepage = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/homepage`);
      const data = await response.json();
      setHomepage(data);
    } catch (err) {
      toast.error('Failed to load homepage content');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${API_BASE}/admin/homepage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(homepage)
      });
      if (response.ok) {
        toast.success('Homepage saved!');
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      toast.error('Failed to save homepage');
    }
    setSaving(false);
  };

  const handleChange = (section, field, value) => {
    setHomepage(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const handleImageUpload = async (e, section, field) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const result = await uploadImage(file);
      handleChange(section, field, result.url);
      toast.success('Image uploaded');
    } catch (err) {
      toast.error('Upload failed');
    }
  };

  // Trust badge handlers
  const handleBadgeChange = (index, field, value) => {
    const badges = [...homepage.trustBadges];
    badges[index] = { ...badges[index], [field]: value };
    setHomepage(prev => ({ ...prev, trustBadges: badges }));
  };

  const addBadge = () => {
    setHomepage(prev => ({
      ...prev,
      trustBadges: [...prev.trustBadges, {
        id: Date.now().toString(),
        type: 'custom',
        label: 'New Badge',
        sublabel: 'Description',
        enabled: true
      }]
    }));
  };

  const removeBadge = (index) => {
    setHomepage(prev => ({
      ...prev,
      trustBadges: prev.trustBadges.filter((_, i) => i !== index)
    }));
  };

  // Service area handlers
  const handleServiceAreaChange = (index, value) => {
    const areas = [...homepage.serviceAreas];
    areas[index] = value;
    setHomepage(prev => ({ ...prev, serviceAreas: areas }));
  };

  const addServiceArea = () => {
    setHomepage(prev => ({
      ...prev,
      serviceAreas: [...prev.serviceAreas, 'New Area']
    }));
  };

  const removeServiceArea = (index) => {
    setHomepage(prev => ({
      ...prev,
      serviceAreas: prev.serviceAreas.filter((_, i) => i !== index)
    }));
  };

  // Business hours handlers
  const handleHoursChange = (day, field, value) => {
    setHomepage(prev => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        [day]: {
          ...prev.businessHours[day],
          [field]: value
        }
      }
    }));
  };

  if (loading) {
    return (
      <AdminLayout title="Homepage Editor">
        <div className="loading-skeleton">
          <div className="skeleton-content" style={{ height: '400px' }}></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      title="Homepage Editor" 
      subtitle="Customize every section of your homepage"
      actions={
        <button 
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      }
    >
      {/* Tabs */}
      <div className="admin-section">
        <div className="editor-tabs" style={{ marginBottom: '24px' }}>
          <button className={activeTab === 'hero' ? 'active' : ''} onClick={() => setActiveTab('hero')}>Hero Section</button>
          <button className={activeTab === 'badges' ? 'active' : ''} onClick={() => setActiveTab('badges')}>Trust Badges</button>
          <button className={activeTab === 'cta' ? 'active' : ''} onClick={() => setActiveTab('cta')}>CTA Section</button>
          <button className={activeTab === 'areas' ? 'active' : ''} onClick={() => setActiveTab('areas')}>Service Areas</button>
          <button className={activeTab === 'hours' ? 'active' : ''} onClick={() => setActiveTab('hours')}>Business Hours</button>
        </div>

        {/* Hero Section */}
        {activeTab === 'hero' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '20px' }}>Hero Section</h3>
            
            <ImagePicker
  label="Background Image"
  value={homepage.hero?.image || ''}
  onChange={(url) => handleChange('hero', 'image', url)}
  aspectRatio="16/9"
  placeholder="Click to select hero background (1920x1080 recommended)"
/>

            <div className="form-group">
              <label>Animation Style</label>
              <select 
                value={homepage.hero?.animation || 'none'}
                onChange={e => handleChange('hero', 'animation', e.target.value)}
              >
                <option value="none">None</option>
                <option value="pan-left-right">Pan Left to Right</option>
                <option value="pan-right-left">Pan Right to Left</option>
                <option value="zoom-in">Slow Zoom In</option>
                <option value="zoom-out">Slow Zoom Out</option>
                <option value="ken-burns">Ken Burns (Pan + Zoom)</option>
                <option value="ken-burns-reverse">Ken Burns Reverse</option>
              </select>
            </div>

            {homepage.hero?.animation && homepage.hero.animation !== 'none' && (
              <div className="form-group">
                <label>Animation Speed: {homepage.hero?.animationSpeed || 10}s</label>
                <input 
                  type="range" 
                  min="2" 
                  max="30" 
                  value={homepage.hero?.animationSpeed || 10}
                  onChange={e => handleChange('hero', 'animationSpeed', Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <small style={{ color: 'var(--admin-text-secondary)' }}>
                  Faster (2s) ← → Slower (30s)
                </small>
              </div>
            )}

            <div className="form-group">
              <label>Tagline (Small Text Above Title)</label>
              <input 
                type="text" 
                value={homepage.hero?.tagline || ''} 
                onChange={e => handleChange('hero', 'tagline', e.target.value)}
                placeholder="YOUR TRUSTED LOCAL CONTRACTOR"
              />
            </div>

            <div className="form-group">
              <label>Main Title</label>
              <input 
                type="text" 
                value={homepage.hero?.title || ''} 
                onChange={e => handleChange('hero', 'title', e.target.value)}
                placeholder="{{CITY}} Area Contractor"
              />
            </div>

            <div className="form-group">
              <label>Subtitle (Services Line)</label>
              <input 
                type="text" 
                value={homepage.hero?.subtitle || ''} 
                onChange={e => handleChange('hero', 'subtitle', e.target.value)}
                placeholder="Roofing • Siding • Windows • Insulation • Remodeling"
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea 
                value={homepage.hero?.description || ''} 
                onChange={e => handleChange('hero', 'description', e.target.value)}
                placeholder="Serving the {{SERVICE_REGION}} with Quality Craftsmanship"
                rows={2}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Primary Button Text</label>
                <input 
                  type="text" 
                  value={homepage.hero?.primaryButtonText || ''} 
                  onChange={e => handleChange('hero', 'primaryButtonText', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Primary Button Link</label>
                <input 
                  type="text" 
                  value={homepage.hero?.primaryButtonLink || ''} 
                  onChange={e => handleChange('hero', 'primaryButtonLink', e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Secondary Button Text</label>
                <input 
                  type="text" 
                  value={homepage.hero?.secondaryButtonText || ''} 
                  onChange={e => handleChange('hero', 'secondaryButtonText', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Secondary Button Link</label>
                <input 
                  type="text" 
                  value={homepage.hero?.secondaryButtonLink || ''} 
                  onChange={e => handleChange('hero', 'secondaryButtonLink', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Trust Badges */}
        {activeTab === 'badges' && (
          <div className="settings-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3>Review & Trust Badges</h3>
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={addBadge}>
                + Add Badge
              </button>
            </div>
            
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Display your ratings and certifications to build trust with visitors.
            </p>

            {homepage.trustBadges?.map((badge, index) => (
              <div key={badge.id} className="card" style={{ marginBottom: '16px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Badge Type</label>
                        <select 
                          value={badge.type}
                          onChange={e => handleBadgeChange(index, 'type', e.target.value)}
                        >
                          <option value="google">Google Reviews</option>
                          <option value="facebook">Facebook</option>
                          <option value="bbb">BBB Rating</option>
                          <option value="certification">Certification</option>
                          <option value="gaf">GAF</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={badge.enabled}
                            onChange={e => handleBadgeChange(index, 'enabled', e.target.checked)}
                            style={{ marginRight: '8px' }}
                          />
                          Show on homepage
                        </label>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Label (e.g., "5.0 Rating")</label>
                        <input 
                          type="text" 
                          value={badge.label}
                          onChange={e => handleBadgeChange(index, 'label', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Sublabel (e.g., "Google Reviews")</label>
                        <input 
                          type="text" 
                          value={badge.sublabel}
                          onChange={e => handleBadgeChange(index, 'sublabel', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    className="admin-btn admin-btn-danger admin-btn-sm"
                    onClick={() => removeBadge(index)}
                    style={{ marginLeft: '16px' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA Section */}
        {activeTab === 'cta' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '20px' }}>Call-to-Action Section</h3>
            
            <ImagePicker
  label="Background Image (optional)"
  value={homepage.ctaSection?.backgroundImage || ''}
  onChange={(url) => handleChange('ctaSection', 'backgroundImage', url)}
  aspectRatio="21/9"
  placeholder="Click to select CTA background"
/>

            <div className="form-group">
              <label>Title</label>
              <textarea 
                value={homepage.ctaSection?.title || ''} 
                onChange={e => handleChange('ctaSection', 'title', e.target.value)}
                rows={2}
                placeholder="Increase your comfort.&#10;Decrease your energy bills."
              />
              <span className="field-hint">Use line breaks for multiple lines</span>
            </div>

            <div className="form-group">
              <label>Description</label>
              <input 
                type="text" 
                value={homepage.ctaSection?.description || ''} 
                onChange={e => handleChange('ctaSection', 'description', e.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Primary Button Text</label>
                <input 
                  type="text" 
                  value={homepage.ctaSection?.primaryButtonText || ''} 
                  onChange={e => handleChange('ctaSection', 'primaryButtonText', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Primary Button Link</label>
                <input 
                  type="text" 
                  value={homepage.ctaSection?.primaryButtonLink || ''} 
                  onChange={e => handleChange('ctaSection', 'primaryButtonLink', e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Secondary Button Text</label>
                <input 
                  type="text" 
                  value={homepage.ctaSection?.secondaryButtonText || ''} 
                  onChange={e => handleChange('ctaSection', 'secondaryButtonText', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Secondary Button Link</label>
                <input 
                  type="text" 
                  value={homepage.ctaSection?.secondaryButtonLink || ''} 
                  onChange={e => handleChange('ctaSection', 'secondaryButtonLink', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Service Areas */}
        {activeTab === 'areas' && (
          <div className="settings-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3>Service Areas</h3>
              <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={addServiceArea}>
                + Add Area
              </button>
            </div>
            
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              List the cities and areas you serve. These appear in the contact section.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {homepage.serviceAreas?.map((area, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="text" 
                    value={area}
                    onChange={e => handleServiceAreaChange(index, e.target.value)}
                    style={{ width: '150px' }}
                  />
                  <button 
                    className="admin-btn admin-btn-danger admin-btn-sm"
                    onClick={() => removeServiceArea(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Business Hours */}
        {activeTab === 'hours' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '20px' }}>Business Hours</h3>
            
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Set your operating hours. These display in the contact section.
            </p>

            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
              <div key={day} className="form-row" style={{ alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ width: '120px', fontWeight: '500', textTransform: 'capitalize' }}>
                  {day}
                </div>
                <div className="form-group" style={{ margin: 0, marginRight: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', margin: 0 }}>
                    <input 
                      type="checkbox" 
                      checked={homepage.businessHours?.[day]?.closed}
                      onChange={e => handleHoursChange(day, 'closed', e.target.checked)}
                      style={{ marginRight: '8px' }}
                    />
                    Closed
                  </label>
                </div>
                {!homepage.businessHours?.[day]?.closed && (
                  <>
                    <input 
                      type="text" 
                      value={homepage.businessHours?.[day]?.open || ''}
                      onChange={e => handleHoursChange(day, 'open', e.target.value)}
                      placeholder="8:00 AM"
                      style={{ width: '120px', marginRight: '8px' }}
                    />
                    <span style={{ margin: '0 8px' }}>to</span>
                    <input 
                      type="text" 
                      value={homepage.businessHours?.[day]?.close || ''}
                      onChange={e => handleHoursChange(day, 'close', e.target.value)}
                      placeholder="5:00 PM"
                      style={{ width: '120px' }}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminHomepage;
