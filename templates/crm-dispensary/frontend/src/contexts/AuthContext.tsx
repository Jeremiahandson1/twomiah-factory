import React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  // The permission list the SERVER computed for this person, including any one-off grants an owner
  // added in Settings. Screens ask this instead of re-deriving the matrix in the browser, which is
  // how a manager got editable fields and a Save button the API then refused. (T42 L1-L3)
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const data = await api.getMe();
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
    } catch (err) {
      const e = err as any;
      const isTransient = e?.isTransient === true || e?.status === 0 || (typeof e?.status === 'number' && e.status >= 500);
      if (isTransient) {
        // Server unreachable, not the session invalid — keep the token so a
        // refresh/retry recovers instead of forcing a re-login.
        console.warn('Auth check transient failure — session preserved:', err);
      } else {
        console.error('Auth check failed (session invalid):', err);
        api.clearTokens();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
      return data;
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  const register = async (formData) => {
    setError(null);
    try {
      const data = await api.register(formData);
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
      return data;
    } catch (err) {
      setError(err.message || 'Registration failed');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setCompany(null);
      setPermissions([]);
    }
  };

  const updateCompany = (updates) => {
    setCompany(prev => ({ ...prev, ...updates }));
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isManager = ['admin', 'manager', 'owner'].includes(user?.role);

  const hasFeature = (featureId) => {
    return company?.enabledFeatures?.includes(featureId) ?? false;
  };

  /**
   * May this person do `perm` — according to the SERVER, not a second copy of the matrix kept in the
   * browser. Understands the `resource:*` wildcard the backend grants with.
   *
   * Returns false while the list is still loading, so a screen never flashes a control that is about
   * to be taken away. A screen that gets this wrong shows a manager editable settings and a Save
   * button that answers "Insufficient permissions". (T42 L1-L3)
   */
  const can = (perm) => {
    if (!perm || !Array.isArray(permissions)) return false;
    if (permissions.includes('*') || permissions.includes(perm)) return true;
    const resource = String(perm).split(':')[0];
    return permissions.includes(`${resource}:*`);
  };

  return (
    <AuthContext.Provider value={{
      user,
      company,
      loading,
      error,
      isAuthenticated,
      isAdmin,
      isManager,
      permissions,
      can,
      token: localStorage.getItem('accessToken'),
      login,
      register,
      logout,
      checkAuth,
      updateCompany,
      hasFeature,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
