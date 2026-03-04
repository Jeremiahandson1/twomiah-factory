import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAdmin();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const success = await login(password);
    
    if (success) {
      navigate('/');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
    setLoading(false);
  };

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-logo">
          <svg viewBox="0 0 40 40" fill="none">
            <path d="M20 4L4 16V36H36V16L20 4Z" stroke="currentColor" strokeWidth="2" fill="none"/>
            <rect x="15" y="22" width="10" height="14" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <span>{{COMPANY_NAME}} Admin</span>
        </div>
        
        <h1>Sign In</h1>
        
        {error && <div className="admin-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              disabled={loading}
            />
          </div>
          
          <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        
        <p style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>
          Default password: <code style={{ background: 'var(--admin-surface-hover)', padding: '2px 6px', borderRadius: '4px' }}>y6uvBZarNsDz</code>
        </p>
      </div>
    </div>
  );
}

export default AdminLogin;
