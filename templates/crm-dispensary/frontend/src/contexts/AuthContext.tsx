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
      // Not signed in yet: the account has a second factor and the password was only the first
      // half. Nothing about the session is set until a code is accepted. (T49 H4)
      if (data?.mfaRequired) return data;
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
      return data;
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  /**
   * Sign in with a till PIN. (T37)
   *
   * Deliberately the SAME shape as login(): it can come back `mfaRequired`, because /pin-login asks
   * the same gate and opens the same challenge as a password — a PIN is a convenience at the
   * counter, not a way around someone's second factor. So the caller hands the result to the same
   * code step, and nothing about the session is set until a code is accepted.
   */
  const pinLogin = async (pin) => {
    setError(null);
    try {
      const data = await api.pinLogin(pin);
      if (data?.mfaRequired) return data;
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
      return data;
    } catch (err) {
      setError(err.message || 'That PIN was not accepted');
      throw err;
    }
  };

  /** The second half of a sign-in: an authenticator code, or one of the recovery codes. (T49 H4) */
  const completeMfa = async (challengeId, code) => {
    setError(null);
    try {
      const data = await api.completeMfa(challengeId, code);
      setUser(data.user);
      setCompany(data.company);
      if (Array.isArray(data.permissions)) setPermissions(data.permissions);
      return data;
    } catch (err) {
      setError(err.message || 'That code was not accepted');
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

  /**
   * "At least this rank", on the server's own ladder. (T41)
   *
   * The dispensary's routes gate on requireRole('budtender') to ring a sale, requireRole('driver')
   * to move a delivery and requireRole('manager') to refund one — and this context offered only
   * isManager and isAdmin, so a screen that wanted to hide a till button from a viewer had nothing
   * correct to ask. That is why "viewer sees write buttons": not a missing check, a missing helper.
   *
   * The ladder and the legacy mapping are copied from backend/src/middleware/permissions.ts
   * (ROLE_HIERARCHY / ROLE_MAPPING). An unknown rank is a NO, so a typo hides a control rather than
   * offering it to everybody — which is what comparing indexOf values used to do.
   */
  const ROLE_LADDER = ['viewer', 'driver', 'budtender', 'manager', 'admin', 'owner'];
  const LEGACY_ROLE = { user: 'budtender', field: 'budtender' };
  const isAtLeast = (minRole) => {
    const want = ROLE_LADDER.indexOf(String(minRole || ''));
    if (want < 0) return false;
    const role = LEGACY_ROLE[user?.role] || user?.role || 'viewer';
    const have = ROLE_LADDER.indexOf(role);
    return have >= 0 && have >= want;
  };

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
      isAtLeast,
      permissions,
      can,
      token: localStorage.getItem('accessToken'),
      login,
      pinLogin,
      completeMfa,
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
