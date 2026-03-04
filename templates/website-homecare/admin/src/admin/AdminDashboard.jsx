import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { services } from '../data/services';
import { getActivity, getLeads, getTrash, getCustomPages, getSiteSettings } from './api';

// ── Setup checklist items ─────────────────────────────────────────
function getChecklist(settings) {
  return [
    {
      id: 'logo',
      label: 'Upload your logo',
      done: !!(settings?.logo),
      link: '/site-settings',
      hint: 'Site Settings → Branding'
    },
    {
      id: 'phone',
      label: 'Add your phone number',
      done: !!(settings?.phone && settings.phone !== '(555) 123-4567'),
      link: '/site-settings',
      hint: 'Site Settings → Company Info'
    },
    {
      id: 'email',
      label: 'Set your email address',
      done: !!(settings?.email && !settings.email.includes('example.com') && !settings.email.includes('demo@')),
      link: '/site-settings',
      hint: 'Site Settings → Company Info'
    },
    {
      id: 'homepage',
      label: 'Customize your homepage',
      done: !!(settings?._homepageEdited),
      link: '/edit/home',
      hint: 'Edit hero text, tagline, and hero image'
    },
    {
      id: 'analytics',
      label: 'Connect Google Analytics',
      done: !!(settings?.analytics?.googleAnalyticsId),
      link: '/site-settings',
      hint: 'Site Settings → Analytics — paste your G-XXXXXXXX ID'
    },
    {
      id: 'email_notif',
      label: 'Set up lead notifications',
      done: !!(settings?.emailNotifications?.enabled && settings?.emailNotifications?.recipient),
      link: '/site-settings',
      hint: 'Site Settings → Email — get notified when leads come in'
    },
  ];
}

function SetupChecklist({ settings, onDismiss }) {
  const items = getChecklist(settings);
  const done = items.filter(i => i.done).length;
  const total = items.length;
  const pct = Math.round((done / total) * 100);
  const allDone = done === total;

  return (
    <div style={{
      background: allDone ? '#f0fdf4' : 'var(--admin-surface)',
      border: `1px solid ${allDone ? '#bbf7d0' : 'var(--admin-border)'}`,
      borderRadius: 12, padding: '20px 24px', marginBottom: 24
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
            {allDone ? '🎉 You\'re all set!' : '🚀 Get your site ready to launch'}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--admin-text-muted)' }}>
            {allDone
              ? 'Your site is fully configured. Your clients can find you and leads will flow in.'
              : `${done} of ${total} steps complete`}
          </p>
        </div>
        <button onClick={onDismiss} title="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-muted)', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>
          ×
        </button>
      </div>

      {/* Progress bar */}
      {!allDone && (
        <div style={{ height: 6, background: 'var(--admin-bg)', borderRadius: 3, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--admin-primary)', borderRadius: 3, transition: 'width .4s ease' }} />
        </div>
      )}

      {/* Checklist items */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {items.map(item => (
          <Link key={item.id} to={item.done ? '#' : item.link}
            onClick={item.done ? e => e.preventDefault() : undefined}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 8, textDecoration: 'none',
              background: item.done ? 'transparent' : 'var(--admin-bg)',
              border: `1px solid ${item.done ? 'transparent' : 'var(--admin-border)'}`,
              opacity: item.done ? 0.6 : 1,
              transition: 'all .15s',
              cursor: item.done ? 'default' : 'pointer'
            }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
              background: item.done ? '#10b981' : 'var(--admin-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {item.done
                ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                : <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--admin-text-muted)' }} />
              }
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--admin-text)', lineHeight: 1.3 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                {item.hint}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────
function AdminDashboard() {
  const [recentActivity, setRecentActivity] = useState([]);
  const [leadStats, setLeadStats] = useState({ total: 0, new: 0 });
  const [trashCount, setTrashCount] = useState(0);
  const [customPageCount, setCustomPageCount] = useState(0);
  const [siteSettings, setSiteSettings] = useState(null);
  const [showChecklist, setShowChecklist] = useState(false);

  const totalPages = 1 + services.length
    + services.reduce((acc, s) => acc + (s.subServices?.length || 0), 0)
    + customPageCount;

  useEffect(() => {
    loadData();
    // Show checklist unless explicitly dismissed
    const dismissed = localStorage.getItem('setupDismissed');
    if (!dismissed) setShowChecklist(true);
  }, []);

  const loadData = async () => {
    try {
      const [activity, leads, trash, customPages, settings] = await Promise.all([
        getActivity().catch(() => []),
        getLeads().catch(() => []),
        getTrash().catch(() => []),
        getCustomPages().catch(() => []),
        getSiteSettings().catch(() => null),
      ]);

      setRecentActivity((activity || []).slice(0, 5));
      setLeadStats({
        total: (leads || []).length,
        new: (leads || []).filter(l => l.status === 'new').length
      });
      setTrashCount((trash || []).length);
      setCustomPageCount((customPages || []).length);
      setSiteSettings(settings);

      // Auto-hide checklist if all steps done
      if (settings) {
        const items = getChecklist(settings);
        if (items.every(i => i.done)) {
          const dismissed = localStorage.getItem('setupDismissed');
          if (!dismissed) setShowChecklist(true); // show the "all done" state briefly
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard data');
    }
  };

  const dismissChecklist = () => {
    localStorage.setItem('setupDismissed', '1');
    setShowChecklist(false);
  };

  const formatTime = (dateStr) => {
    const diff = Date.now() - new Date(dateStr);
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const getActionIcon = (action) => {
    const icons = {
      'login': '🔐',
      'page_saved': '💾',
      'page_created': '➕',
      'page_deleted': '🗑️',
      'page_duplicated': '📋',
      'page_restored': '↩️',
      'image_uploaded': '🖼️',
      'image_deleted': '🗑️',
      'settings_updated': '⚙️',
      'redirect_created': '↗️',
      'lead_received': '📬',
      'email_notification_sent': '✉️',
    };
    return icons[action] || '📝';
  };

  const companyName = siteSettings?.companyName || siteSettings?.siteName || 'your site';

  return (
    <AdminLayout
      title="Dashboard"
      subtitle={`Welcome to ${companyName}`}
      actions={
        !showChecklist && (
          <button
            onClick={() => { localStorage.removeItem('setupDismissed'); setShowChecklist(true); }}
            className="admin-btn admin-btn-secondary"
            style={{ fontSize: 12 }}
          >
            🚀 Setup Checklist
          </button>
        )
      }
    >
      {/* Setup Checklist */}
      {showChecklist && siteSettings && (
        <SetupChecklist settings={siteSettings} onDismiss={dismissChecklist} />
      )}

      {/* Stats */}
      <div className="admin-section">
        <div className="stat-cards">
          <Link to="/leads" className="stat-card" style={{
            textDecoration: 'none',
            borderLeft: leadStats.new > 0 ? '3px solid var(--admin-primary)' : undefined
          }}>
            <div className="stat-card-label">New Leads</div>
            <div className="stat-card-value" style={{ color: leadStats.new > 0 ? 'var(--admin-primary)' : undefined }}>
              {leadStats.new}
            </div>
            <div className="stat-card-change">{leadStats.total} total</div>
          </Link>
          <div className="stat-card">
            <div className="stat-card-label">Total Pages</div>
            <div className="stat-card-value">{totalPages}</div>
            <div className="stat-card-change">All editable</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Services</div>
            <div className="stat-card-value">{services.length}</div>
            <div className="stat-card-change">Main categories</div>
          </div>
          <Link to="/trash" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-card-label">In Trash</div>
            <div className="stat-card-value">{trashCount}</div>
            <div className="stat-card-change">Recoverable</div>
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="admin-section">
        <h2>Quick Actions</h2>
        <div className="admin-cards">
          <Link to="/leads" className="admin-card">
            <h3>📬 View Leads</h3>
            <p>{leadStats.new > 0 ? `${leadStats.new} new lead${leadStats.new !== 1 ? 's' : ''} waiting` : 'Manage contact form submissions'}</p>
          </Link>
          <Link to="/edit/home" className="admin-card">
            <h3>🏠 Edit Home Page</h3>
            <p>Update hero section, images, and content</p>
          </Link>
          <Link to="/services" className="admin-card">
            <h3>🛠️ Manage Services</h3>
            <p>Add, edit, or reorder your services</p>
          </Link>
          <Link to="/media" className="admin-card">
            <h3>🖼️ Media Library</h3>
            <p>Upload and organize images</p>
          </Link>
          <Link to="/analytics" className="admin-card">
            <h3>📊 Analytics</h3>
            <p>Views, leads, sources, and conversions</p>
          </Link>
          <Link to="/site-settings" className="admin-card">
            <h3>⚙️ Site Settings</h3>
            <p>Company info, branding, SEO, analytics</p>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div className="admin-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Recent Activity</h2>
            <Link to="/activity" style={{ fontSize: '0.875rem', color: 'var(--admin-primary)' }}>View all →</Link>
          </div>
          <div className="activity-list">
            {recentActivity.map(a => (
              <div key={a.id} className="activity-item">
                <span className="activity-icon">{getActionIcon(a.action)}</span>
                <div className="activity-content">
                  <span className="activity-label">{a.action.replace(/_/g, ' ')}</span>
                  <span className="activity-time">{formatTime(a.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts */}
      <div className="admin-section">
        <h2>Keyboard Shortcuts</h2>
        <div className="admin-card" style={{ maxWidth: '500px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.875rem' }}>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>⌘K</kbd> Search</div>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>⌘S</kbd> Save</div>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>⌘Z</kbd> Undo</div>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>⌘⇧Z</kbd> Redo</div>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>⌘D</kbd> Dark Mode</div>
            <div><kbd style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>ESC</kbd> Close</div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminDashboard;
