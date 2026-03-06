import React, { useState } from 'react';
import AdminLayout from './AdminLayout';
import { useAdmin } from './AdminContext';
import { useToast } from './Toast';
import { changePassword } from './api';

function AdminSettings() {
  const { darkMode, toggleDarkMode } = useAdmin();
  const toast = useToast();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setSaving(true);

    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    }

    setSaving(false);
  };

  return (
    <AdminLayout title="Settings" subtitle="Manage admin settings and preferences">
      {/* Appearance */}
      <div className="admin-section">
        <h2>Appearance</h2>
        <div className="admin-card" style={{ maxWidth: '500px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ margin: '0 0 4px' }}>Dark Mode</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--admin-text-secondary)' }}>
                Toggle dark theme for the admin panel
              </p>
            </div>
            <button 
              className={`admin-btn ${darkMode ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
              onClick={toggleDarkMode}
            >
              {darkMode ? '🌙 On' : '☀️ Off'}
            </button>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="admin-section">
        <h2>Change Password</h2>
        <form onSubmit={handleChangePassword} className="settings-form">
          <div className="form-group">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
            />
          </div>
          
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 6 characters)"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
            />
          </div>
          
          <button 
            type="submit" 
            className="admin-btn admin-btn-primary"
            disabled={saving}
          >
            {saving ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* Site Info */}
      <div className="admin-section">
        <h2>Site Information</h2>
        <div className="settings-info">
          <p><strong>Site:</strong> {{COMPANY_NAME}}</p>
          <p><strong>Admin Panel Version:</strong> 2.0.0</p>
          <p><strong>Data Location:</strong> backend/data/</p>
          <p><strong>Uploads Location:</strong> frontend/public/uploads/</p>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="admin-section">
        <h2>Keyboard Shortcuts</h2>
        <div className="admin-card" style={{ maxWidth: '500px' }}>
          <div style={{ display: 'grid', gap: '12px', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Open Command Palette</span>
              <kbd style={{ background: 'var(--admin-surface-hover)', padding: '4px 8px', borderRadius: '4px' }}>⌘K</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Save Page</span>
              <kbd style={{ background: 'var(--admin-surface-hover)', padding: '4px 8px', borderRadius: '4px' }}>⌘S</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Toggle Dark Mode</span>
              <kbd style={{ background: 'var(--admin-surface-hover)', padding: '4px 8px', borderRadius: '4px' }}>⌘D</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Close Dialogs</span>
              <kbd style={{ background: 'var(--admin-surface-hover)', padding: '4px 8px', borderRadius: '4px' }}>ESC</kbd>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminSettings;
