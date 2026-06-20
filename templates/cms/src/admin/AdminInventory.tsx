import React, { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const PROVIDERS = [
  { value: 'generic', label: 'Generic CSV/XML' },
  { value: 'lightspeed', label: 'Lightspeed' },
  { value: 'motility', label: 'Motility (IDS)' },
  { value: 'dx1', label: 'DX1' },
  { value: 'blackpurl', label: 'Blackpurl' }
];

const statusColors: Record<string, { bg: string; color: string }> = {
  available: { bg: 'var(--admin-success-bg)', color: 'var(--admin-success)' },
  pending: { bg: 'var(--admin-warning-bg)', color: '#92400e' },
  sold: { bg: 'var(--admin-error-bg)', color: 'var(--admin-error)' }
};

interface InventoryConfig {
  enabled: boolean;
  provider: string;
  feedUrl: string;
  format: 'csv' | 'xml';
}

interface Unit {
  stockNumber?: string;
  vin?: string;
  condition?: string;
  category?: string;
  year?: number | string;
  make?: string;
  modelName?: string;
  trim?: string;
  status?: string;
  listedPrice?: number;
  internetPrice?: number;
  photos?: string[];
  source?: string;
  importedAt?: string;
}

function authHeaders() {
  const token = localStorage.getItem('adminToken');
  return { Authorization: `Bearer ${token}` };
}

function AdminInventory() {
  const [config, setConfig] = useState<InventoryConfig>({
    enabled: false,
    provider: 'generic',
    feedUrl: '',
    format: 'csv'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [count, setCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [bySource, setBySource] = useState<Record<string, number>>({});
  const toast = useToast();

  useEffect(() => {
    loadAll();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/inventory-config`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setConfig({
          enabled: !!data.enabled,
          provider: data.provider || 'generic',
          feedUrl: data.feedUrl || '',
          format: data.format === 'xml' ? 'xml' : 'csv'
        });
      }
    } catch (err) {
      toast.error('Failed to load feed settings');
    }
  };

  const loadInventory = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/inventory`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUnits(data.units || []);
        setCount(data.count || 0);
        setLastSync(data.lastSync || null);
        setBySource(data.bySource || {});
      }
    } catch (err) {
      toast.error('Failed to load inventory');
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadConfig(), loadInventory()]);
    setLoading(false);
  };

  const handleChange = (field: keyof InventoryConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/inventory-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        toast.success('Feed settings saved!');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Failed to save: ' + (err.error || err.message || 'Request failed'));
      }
    } catch (err: any) {
      toast.error('Failed to save: ' + (err.message || 'Request failed'));
    }
    setSaving(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/admin/inventory/sync`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(`Imported ${data.imported ?? data.count ?? 0} units`);
        await loadInventory();
      } else {
        toast.error('Sync failed: ' + (data.error || 'Request failed'));
      }
    } catch (err: any) {
      toast.error('Sync failed: ' + (err.message || 'Request failed'));
    }
    setSyncing(false);
  };

  const formatSyncTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    return date.toLocaleString();
  };

  const formatPrice = (unit: Unit) => {
    const price = unit.listedPrice ?? unit.internetPrice;
    if (price == null) return '—';
    return '$' + Number(price).toLocaleString();
  };

  const formatYMM = (unit: Unit) => {
    return [unit.year, unit.make, unit.modelName, unit.trim].filter(Boolean).join(' ') || '—';
  };

  if (loading) {
    return (
      <AdminLayout title="Inventory">
        <div className="loading-skeleton">
          <div className="skeleton-content" style={{ height: '400px' }}></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Inventory"
      subtitle="Import your DMS inventory feed onto your website"
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
      {/* Feed Config */}
      <div className="admin-section">
        <div className="settings-panel">
          <h3 style={{ marginBottom: '8px' }}>Feed Settings</h3>
          <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '20px' }}>
            Point this at the inventory export feed your DMS already generates (the same feed that
            syndicates to RV Trader). We import it into your site automatically every few hours.
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={e => handleChange('enabled', e.target.checked)}
                style={{ marginRight: '8px' }}
              />
              Enabled
            </label>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Provider</label>
              <select
                value={config.provider}
                onChange={e => handleChange('provider', e.target.value)}
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Format</label>
              <select
                value={config.format}
                onChange={e => handleChange('format', e.target.value)}
              >
                <option value="csv">CSV</option>
                <option value="xml">XML</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Feed URL</label>
            <input
              type="text"
              value={config.feedUrl}
              onChange={e => handleChange('feedUrl', e.target.value)}
              placeholder="https://your-dms.com/inventory-feed.csv"
            />
          </div>
        </div>
      </div>

      {/* Sync */}
      <div className="admin-section">
        <div className="settings-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ marginBottom: '4px' }}>Sync</h3>
              <p style={{ color: 'var(--admin-text-secondary)', margin: 0 }}>
                Last sync: <strong>{formatSyncTime(lastSync)}</strong>
              </p>
            </div>
            <button
              className="admin-btn admin-btn-primary"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : '↻ Sync Now'}
            </button>
          </div>

          {Object.keys(bySource).length > 0 && (
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {Object.entries(bySource).map(([source, n]) => (
                <span
                  key={source}
                  style={{
                    background: 'var(--admin-info-bg)',
                    color: '#1e40af',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '13px'
                  }}
                >
                  {source}: {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Units Table */}
      <div className="admin-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}>Units</h3>
          <span style={{ color: 'var(--admin-text-secondary)', fontSize: '14px' }}>{count} total</span>
        </div>

        {units.length === 0 ? (
          <div className="empty-state">
            <p>No inventory yet — save your feed settings and click Sync Now.</p>
          </div>
        ) : (
          <div className="settings-panel" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--admin-border, #e5e7eb)' }}>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px', width: 80 }}>Photo</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px' }}>Stock #</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px' }}>Year/Make/Model</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px' }}>Condition</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px' }}>Status</th>
                  <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: '12px' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit, i) => {
                  const photo = unit.photos && unit.photos.length > 0 ? unit.photos[0] : '';
                  return (
                    <tr key={unit.stockNumber || unit.vin || i} style={{ borderBottom: '1px solid var(--admin-border, #e5e7eb)' }}>
                      <td style={{ padding: '8px' }}>
                        {photo ? (
                          <img
                            src={getImageUrl(photo)}
                            alt={formatYMM(unit)}
                            style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                          />
                        ) : (
                          <div style={{
                            width: 64, height: 48, borderRadius: 6,
                            background: 'var(--admin-bg, #f3f4f6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--admin-text-muted)', fontSize: 18
                          }}>
                            🚐
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 500 }}>{unit.stockNumber || '—'}</td>
                      <td style={{ padding: '8px' }}>{formatYMM(unit)}</td>
                      <td style={{ padding: '8px', textTransform: 'capitalize' }}>{unit.condition || '—'}</td>
                      <td style={{ padding: '8px' }}>
                        {unit.status ? (
                          <span style={{
                            background: statusColors[unit.status]?.bg || 'var(--admin-bg, #f3f4f6)',
                            color: statusColors[unit.status]?.color || 'var(--admin-text)',
                            padding: '3px 10px',
                            borderRadius: '20px',
                            fontSize: '12px',
                            textTransform: 'capitalize'
                          }}>
                            {unit.status}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{formatPrice(unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminInventory;
