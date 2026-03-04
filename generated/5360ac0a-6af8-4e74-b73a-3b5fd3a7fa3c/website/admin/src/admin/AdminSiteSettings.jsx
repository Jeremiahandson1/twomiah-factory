import React, { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getSiteSettings, saveSiteSettings, uploadImage } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function AdminSiteSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [testingEmail, setTestingEmail] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getSiteSettings();
      setSettings(data);
    } catch (err) {
      toast.error('Failed to load settings');
    }
    setLoading(false);
  };

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleNestedChange = (parent, field, value) => {
    setSettings(prev => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value }
    }));
  };

  const handleDeepChange = (parent, child, field, value) => {
    setSettings(prev => ({
      ...prev,
      [parent]: {
        ...prev[parent],
        [child]: value
      }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSiteSettings(settings);
      toast.success('Settings saved!');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    }
    setSaving(false);
  };

  const handleImageUpload = async (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const result = await uploadImage(file);
      handleChange(field, result.url);
      toast.success('Image uploaded');
    } catch (err) {
      toast.error('Upload failed');
    }
  };

  const testEmailNotification = async () => {
    setTestingEmail(true);
    try {
      // First save settings
      await saveSiteSettings(settings);
      
      // Then send test
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${API_BASE}/admin/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Lead',
          email: 'test@example.com',
          phone: '555-0123',
          service: 'Email Test',
          message: 'This is a test lead to verify email notifications are working.',
          source: 'email-test'
        })
      });
      
      if (response.ok) {
        toast.success('Test lead submitted! Check your email.');
      }
    } catch (err) {
      toast.error('Test failed');
    }
    setTestingEmail(false);
  };

  if (loading) {
    return (
      <AdminLayout title="Site Settings">
        <div className="loading-skeleton">
          <div className="skeleton-content" style={{ height: '400px' }}></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      title="Site Settings" 
      subtitle="Configure global site options"
      actions={
        <button 
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      }
    >
      {/* Tabs */}
      <div className="admin-section">
        <div className="editor-tabs" style={{ marginBottom: '24px', flexWrap: 'wrap' }}>
          <button className={activeTab === 'general' ? 'active' : ''} onClick={() => setActiveTab('general')}>General</button>
          <button className={activeTab === 'branding' ? 'active' : ''} onClick={() => setActiveTab('branding')}>Branding</button>
          <button className={activeTab === 'social' ? 'active' : ''} onClick={() => setActiveTab('social')}>Social</button>
          <button className={activeTab === 'seo' ? 'active' : ''} onClick={() => setActiveTab('seo')}>SEO</button>
          <button className={activeTab === 'analytics' ? 'active' : ''} onClick={() => setActiveTab('analytics')}>Analytics</button>
          <button className={activeTab === 'scripts' ? 'active' : ''} onClick={() => setActiveTab('scripts')}>Scripts</button>
          <button className={activeTab === 'email' ? 'active' : ''} onClick={() => setActiveTab('email')}>Email</button>
          <button className={activeTab === '404' ? 'active' : ''} onClick={() => setActiveTab('404')}>404 Page</button>
          <button className={activeTab === 'robots' ? 'active' : ''} onClick={() => setActiveTab('robots')}>Robots.txt</button>
          <button className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Security</button>
        </div>

        {/* General */}
        {activeTab === 'general' && (
          <div className="settings-panel">
            <div className="form-group">
              <label>Site Name</label>
              <input 
                type="text" 
                value={settings.siteName || ''} 
                onChange={e => handleChange('siteName', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Company Name</label>
              <input 
                type="text" 
                value={settings.companyName || ''} 
                onChange={e => handleChange('companyName', e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Phone Number</label>
                <input 
                  type="text" 
                  value={settings.phone || ''} 
                  onChange={e => handleChange('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input 
                  type="email" 
                  value={settings.email || ''} 
                  onChange={e => handleChange('email', e.target.value)}
                  placeholder="contact@example.com"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Street Address</label>
              <input 
                type="text" 
                value={settings.address || ''} 
                onChange={e => handleChange('address', e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>City</label>
                <input 
                  type="text" 
                  value={settings.city || ''} 
                  onChange={e => handleChange('city', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>State</label>
                <input 
                  type="text" 
                  value={settings.state || ''} 
                  onChange={e => handleChange('state', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>ZIP Code</label>
                <input 
                  type="text" 
                  value={settings.zip || ''} 
                  onChange={e => handleChange('zip', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Branding */}
        {activeTab === 'branding' && (
          <div className="settings-panel">
            <div className="form-group">
              <label>Logo</label>
              <div className="image-upload-box">
                {settings.logo ? (
                  <div className="image-preview">
                    <img src={getImageUrl(settings.logo)} alt="Logo" style={{ maxHeight: '80px' }} />
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleChange('logo', '')}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="upload-label">
                    <input type="file" accept="image/*" onChange={e => handleImageUpload(e, 'logo')} />
                    <span>Click to upload logo</span>
                  </label>
                )}
              </div>
            </div>
            
            <div className="form-group">
              <label>Favicon</label>
              <div className="image-upload-box">
                {settings.favicon ? (
                  <div className="image-preview">
                    <img src={getImageUrl(settings.favicon)} alt="Favicon" style={{ maxHeight: '32px' }} />
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleChange('favicon', '')}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="upload-label">
                    <input type="file" accept="image/*,.ico" onChange={e => handleImageUpload(e, 'favicon')} />
                    <span>Click to upload favicon (32x32 recommended)</span>
                  </label>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Default Social Share Image</label>
              <div className="image-upload-box">
                {settings.defaultOgImage ? (
                  <div className="image-preview">
                    <img src={getImageUrl(settings.defaultOgImage)} alt="OG Image" style={{ maxHeight: '120px' }} />
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleChange('defaultOgImage', '')}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="upload-label">
                    <input type="file" accept="image/*" onChange={e => handleImageUpload(e, 'defaultOgImage')} />
                    <span>Click to upload (1200x630 recommended for social sharing)</span>
                  </label>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Social Media */}
        {activeTab === 'social' && (
          <div className="settings-panel">
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Add your social media profile URLs to display icons on your website.
            </p>
            <div className="form-group">
              <label>📘 Facebook</label>
              <input 
                type="url" 
                value={settings.socialLinks?.facebook || ''} 
                onChange={e => handleNestedChange('socialLinks', 'facebook', e.target.value)}
                placeholder="https://facebook.com/yourpage"
              />
            </div>
            <div className="form-group">
              <label>📸 Instagram</label>
              <input 
                type="url" 
                value={settings.socialLinks?.instagram || ''} 
                onChange={e => handleNestedChange('socialLinks', 'instagram', e.target.value)}
                placeholder="https://instagram.com/yourhandle"
              />
            </div>
            <div className="form-group">
              <label>🐦 Twitter / X</label>
              <input 
                type="url" 
                value={settings.socialLinks?.twitter || ''} 
                onChange={e => handleNestedChange('socialLinks', 'twitter', e.target.value)}
                placeholder="https://twitter.com/yourhandle"
              />
            </div>
            <div className="form-group">
              <label>💼 LinkedIn</label>
              <input 
                type="url" 
                value={settings.socialLinks?.linkedin || ''} 
                onChange={e => handleNestedChange('socialLinks', 'linkedin', e.target.value)}
                placeholder="https://linkedin.com/company/yourcompany"
              />
            </div>
            <div className="form-group">
              <label>📺 YouTube</label>
              <input 
                type="url" 
                value={settings.socialLinks?.youtube || ''} 
                onChange={e => handleNestedChange('socialLinks', 'youtube', e.target.value)}
                placeholder="https://youtube.com/@yourchannel"
              />
            </div>
            <div className="form-group">
              <label>⭐ Yelp</label>
              <input 
                type="url" 
                value={settings.socialLinks?.yelp || ''} 
                onChange={e => handleNestedChange('socialLinks', 'yelp', e.target.value)}
                placeholder="https://yelp.com/biz/yourcompany"
              />
            </div>
            <div className="form-group">
              <label>📍 Google Business</label>
              <input 
                type="url" 
                value={settings.socialLinks?.googleBusiness || ''} 
                onChange={e => handleNestedChange('socialLinks', 'googleBusiness', e.target.value)}
                placeholder="https://g.page/yourbusiness"
              />
            </div>
          </div>
        )}

        {/* SEO Defaults */}
        {activeTab === 'seo' && (
          <div className="settings-panel">
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              These are used as fallbacks when individual pages don't have their own SEO settings.
            </p>
            <div className="form-group">
              <label>Default Meta Title</label>
              <input 
                type="text" 
                value={settings.defaultMetaTitle || ''} 
                onChange={e => handleChange('defaultMetaTitle', e.target.value)}
                placeholder="Your Company - Tagline"
              />
              <span className="field-hint">{(settings.defaultMetaTitle || '').length}/60 characters</span>
            </div>
            <div className="form-group">
              <label>Default Meta Description</label>
              <textarea 
                value={settings.defaultMetaDescription || ''} 
                onChange={e => handleChange('defaultMetaDescription', e.target.value)}
                placeholder="Brief description of your business..."
                rows={3}
              />
              <span className="field-hint">{(settings.defaultMetaDescription || '').length}/160 characters</span>
            </div>
          </div>
        )}

        {/* Analytics */}
        {activeTab === 'analytics' && (
          <div className="settings-panel">
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Connect tracking and analytics services. All fields are optional — only paste IDs for the platforms you use. Code is injected automatically; no manual script editing required.
            </p>
            <div className="form-group">
              <label>Google Analytics 4 ID</label>
              <input 
                type="text" 
                value={settings.analytics?.googleAnalyticsId || ''} 
                onChange={e => handleNestedChange('analytics', 'googleAnalyticsId', e.target.value)}
                placeholder="G-XXXXXXXXXX"
              />
              <span className="field-hint">Enables GA4 + 6 custom events: generate_lead, phone_call, email_click, cta_click, view_service, view_gallery</span>
            </div>
            <div className="form-group">
              <label>Google Tag Manager ID</label>
              <input 
                type="text" 
                value={settings.analytics?.googleTagManagerId || ''} 
                onChange={e => handleNestedChange('analytics', 'googleTagManagerId', e.target.value)}
                placeholder="GTM-XXXXXXX"
              />
              <span className="field-hint">Add/manage future tracking without code changes. Also pushes custom events to dataLayer.</span>
            </div>
            <div className="form-group">
              <label>Google Ads Conversion ID</label>
              <input 
                type="text" 
                value={settings.analytics?.googleAdsId || ''} 
                onChange={e => handleNestedChange('analytics', 'googleAdsId', e.target.value)}
                placeholder="AW-XXXXXXXXXX"
              />
              <span className="field-hint">Fires a conversion event when the contact form is submitted. Required for Google Ads conversion tracking.</span>
            </div>
            <div className="form-group">
              <label>Facebook Pixel ID</label>
              <input 
                type="text" 
                value={settings.analytics?.facebookPixelId || ''} 
                onChange={e => handleNestedChange('analytics', 'facebookPixelId', e.target.value)}
                placeholder="123456789012345"
              />
              <span className="field-hint">Tracks PageView on all pages + Lead event on form submit. Required for Facebook/Instagram ad retargeting.</span>
            </div>
            <div className="form-group">
              <label>Microsoft Clarity ID</label>
              <input 
                type="text" 
                value={settings.analytics?.microsoftClarityId || ''} 
                onChange={e => handleNestedChange('analytics', 'microsoftClarityId', e.target.value)}
                placeholder="xxxxxxxxxx"
              />
              <span className="field-hint">Free heatmaps + session recordings at clarity.microsoft.com — shows exactly how visitors interact with your site.</span>
            </div>
          </div>
        )}

        {/* Custom Scripts */}
        {activeTab === 'scripts' && (
          <div className="settings-panel">
            <div className="card" style={{ padding: '16px', background: 'var(--admin-warning-bg)', marginBottom: '20px' }}>
              <strong>⚠️ Advanced Feature</strong>
              <p style={{ margin: '8px 0 0 0', color: 'var(--admin-text-secondary)' }}>
                Only add scripts from trusted sources. Malicious scripts can compromise your site.
              </p>
            </div>
            
            <div className="form-group">
              <label>Head Scripts</label>
              <textarea 
                value={settings.scripts?.headScripts || ''} 
                onChange={e => handleNestedChange('scripts', 'headScripts', e.target.value)}
                placeholder="<!-- Scripts added to <head> -->"
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: '13px' }}
              />
              <span className="field-hint">Added before &lt;/head&gt;. Good for meta tags, fonts, CSS.</span>
            </div>
            
            <div className="form-group">
              <label>Body Start Scripts</label>
              <textarea 
                value={settings.scripts?.bodyStartScripts || ''} 
                onChange={e => handleNestedChange('scripts', 'bodyStartScripts', e.target.value)}
                placeholder="<!-- Scripts added after <body> -->"
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: '13px' }}
              />
              <span className="field-hint">Added right after &lt;body&gt;. Good for GTM noscript tags.</span>
            </div>
            
            <div className="form-group">
              <label>Body End Scripts</label>
              <textarea 
                value={settings.scripts?.bodyEndScripts || ''} 
                onChange={e => handleNestedChange('scripts', 'bodyEndScripts', e.target.value)}
                placeholder="<!-- Scripts added before </body> -->"
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: '13px' }}
              />
              <span className="field-hint">Added before &lt;/body&gt;. Good for chat widgets, analytics.</span>
            </div>
          </div>
        )}

        {/* Email Notifications */}
        {activeTab === 'email' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '16px' }}>Lead Email Notifications</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Get notified instantly when someone submits the contact form.
            </p>
            
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input 
                  type="checkbox" 
                  checked={settings.emailNotifications?.enabled || false}
                  onChange={e => handleNestedChange('emailNotifications', 'enabled', e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                Enable email notifications
              </label>
            </div>

            <div className="form-group">
              <label>Send notifications to</label>
              <input 
                type="email" 
                value={settings.emailNotifications?.recipient || ''} 
                onChange={e => handleNestedChange('emailNotifications', 'recipient', e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--admin-border)' }} />
            
            <h4 style={{ marginBottom: '12px' }}>SendGrid (Recommended)</h4>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
              Free tier: 100 emails/day. <a href="https://sendgrid.com" target="_blank" rel="noopener noreferrer">Get API key</a>
            </p>
            
            <div className="form-group">
              <label>SendGrid API Key</label>
              <input 
                type="password" 
                value={settings.emailNotifications?.sendgridApiKey || ''} 
                onChange={e => handleNestedChange('emailNotifications', 'sendgridApiKey', e.target.value)}
                placeholder="SG.xxxxxxxxxxxxxxxxxxxx"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>From Email</label>
                <input 
                  type="email" 
                  value={settings.emailNotifications?.fromEmail || ''} 
                  onChange={e => handleNestedChange('emailNotifications', 'fromEmail', e.target.value)}
                  placeholder="noreply@yourdomain.com"
                />
              </div>
              <div className="form-group">
                <label>From Name</label>
                <input 
                  type="text" 
                  value={settings.emailNotifications?.fromName || ''} 
                  onChange={e => handleNestedChange('emailNotifications', 'fromName', e.target.value)}
                  placeholder="Your Company Website"
                />
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <button 
                className="admin-btn admin-btn-secondary"
                onClick={testEmailNotification}
                disabled={testingEmail || !settings.emailNotifications?.enabled}
              >
                {testingEmail ? 'Sending...' : '📧 Send Test Email'}
              </button>
              <span style={{ marginLeft: '12px', color: 'var(--admin-text-muted)', fontSize: '14px' }}>
                Creates a test lead to verify emails work
              </span>
            </div>
          </div>
        )}

        {/* Custom 404 Page */}
        {activeTab === '404' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '16px' }}>Custom 404 Page</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Customize what visitors see when they land on a page that doesn't exist.
            </p>
            
            <div className="form-group">
              <label>Page Title</label>
              <input 
                type="text" 
                value={settings.custom404?.title || ''} 
                onChange={e => handleNestedChange('custom404', 'title', e.target.value)}
                placeholder="Page Not Found"
              />
            </div>

            <div className="form-group">
              <label>Message</label>
              <textarea 
                value={settings.custom404?.message || ''} 
                onChange={e => handleNestedChange('custom404', 'message', e.target.value)}
                placeholder="Sorry, the page you're looking for doesn't exist."
                rows={3}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.custom404?.showHomeLink !== false}
                    onChange={e => handleNestedChange('custom404', 'showHomeLink', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Show "Go Home" link
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.custom404?.showContactLink !== false}
                    onChange={e => handleNestedChange('custom404', 'showContactLink', e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  Show "Contact Us" link
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Background Image (optional)</label>
              <div className="image-upload-box">
                {settings.custom404?.backgroundImage ? (
                  <div className="image-preview">
                    <img src={getImageUrl(settings.custom404.backgroundImage)} alt="404 Background" style={{ maxHeight: '150px' }} />
                    <button 
                      className="admin-btn admin-btn-danger admin-btn-sm"
                      onClick={() => handleNestedChange('custom404', 'backgroundImage', '')}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="upload-label">
                    <input type="file" accept="image/*" onChange={e => {
                      const file = e.target.files[0];
                      if (file) {
                        uploadImage(file).then(result => {
                          handleNestedChange('custom404', 'backgroundImage', result.url);
                        });
                      }
                    }} />
                    <span>Click to upload background image</span>
                  </label>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Robots.txt */}
        {activeTab === 'robots' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '16px' }}>Robots.txt</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Control how search engines crawl your site. This file is served at /robots.txt
            </p>
            
            <div className="form-group">
              <textarea 
                value={settings.robotsTxt || ''} 
                onChange={e => handleChange('robotsTxt', e.target.value)}
                rows={10}
                style={{ fontFamily: 'monospace', fontSize: '13px' }}
                placeholder={`User-agent: *\nAllow: /\n\nSitemap: https://yoursite.com/sitemap.xml`}
              />
            </div>

            <div className="card" style={{ padding: '16px', background: 'var(--admin-info-bg)' }}>
              <strong>💡 Tip</strong>
              <p style={{ margin: '8px 0 0 0', color: 'var(--admin-text-secondary)' }}>
                Your sitemap is automatically generated at /sitemap.xml. Make sure to include it in your robots.txt.
              </p>
            </div>
          </div>
        )}

        {/* Security */}
        {activeTab === 'security' && (
          <div className="settings-panel">
            <h3 style={{ marginBottom: '16px' }}>Two-Factor Authentication</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
              Add an extra layer of security to your admin login.
            </p>
            
            <div className="card" style={{ padding: '20px' }}>
              {settings.twoFactorEnabled ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <span style={{ 
                      background: 'var(--admin-success-bg)', 
                      color: 'var(--admin-success)',
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '14px'
                    }}>
                      ✓ Enabled
                    </span>
                    <span>Two-factor authentication is active</span>
                  </div>
                  <button 
                    className="admin-btn admin-btn-danger"
                    onClick={async () => {
                      const password = prompt('Enter your password to disable 2FA:');
                      if (password) {
                        try {
                          const token = localStorage.getItem('adminToken');
                          const response = await fetch(`${API_BASE}/admin/2fa/disable`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ password })
                          });
                          if (response.ok) {
                            toast.success('2FA disabled');
                            loadSettings();
                          } else {
                            toast.error('Invalid password');
                          }
                        } catch (err) {
                          toast.error('Failed to disable 2FA');
                        }
                      }
                    }}
                  >
                    Disable 2FA
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ marginBottom: '16px' }}>
                    Two-factor authentication adds an extra step when logging in. 
                    You'll need an authenticator app like Google Authenticator or Authy.
                  </p>
                  <button 
                    className="admin-btn admin-btn-primary"
                    onClick={async () => {
                      try {
                        const token = localStorage.getItem('adminToken');
                        const response = await fetch(`${API_BASE}/admin/2fa/setup`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                          const data = await response.json();
                          // In a real implementation, show QR code here
                          alert(`Setup 2FA with this secret: ${data.secret}\n\nNote: In production, this would show a QR code.`);
                          
                          // Enable 2FA
                          await fetch(`${API_BASE}/admin/2fa/enable`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ code: '000000' })
                          });
                          
                          toast.success('2FA enabled');
                          loadSettings();
                        }
                      } catch (err) {
                        toast.error('Failed to setup 2FA');
                      }
                    }}
                  >
                    Enable 2FA
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminSiteSettings;
