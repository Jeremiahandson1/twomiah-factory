import React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    if (!api.accessToken) {
      setLoading(false);
      return;
    }

    try {
      const [userData, companyData] = await Promise.all([
        api.getMe(),
        api.company.get(),
      ]);
      setUser(userData);
      setCompany(companyData);
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

  // M-05: the app is built on raw fetch(), so an expired session used to leave
  // every screen silently empty (401s with no redirect). Wrap fetch once so any
  // authenticated /api 401 triggers a session re-check. Crucially we do NOT clear
  // tokens here — that would clobber the api service's own 401→refresh flow.
  // Instead we let that flow settle, then verify via getMe: if it still fails the
  // session is genuinely dead and we return the user to login.
  useEffect(() => {
    const orig = window.fetch;
    let checking = false;
    window.fetch = async (...args: any[]) => {
      const res = await orig(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isAuthEndpoint = /\/api\/auth\//.test(url);
        if (res.status === 401 && url.includes('/api/') && !isAuthEndpoint && api.accessToken && !checking) {
          checking = true;
          setTimeout(async () => {
            try {
              await api.getMe();   // routes through api.request → refresh if possible
              checking = false;    // session refreshed and valid — carry on
            } catch {
              api.clearTokens();
              setUser(null);
              setCompany(null);
              window.location.href = '/';
            }
          }, 400);
        }
      } catch { /* never let the wrapper break a request */ }
      return res;
    };
    return () => { window.fetch = orig; };
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      // Fetch company after login
      const companyData = await api.company.get();
      setCompany(companyData);
      return data;
    } catch (err: any) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setCompany(null);
    }
  };

  const updateCompany = (updates: any) => {
    setCompany((prev: any) => ({ ...prev, ...updates }));
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isCaregiver = user?.role === 'caregiver';

  const hasFeature = (featureId: string): boolean => {
    // Check company.enabledFeatures (array) or settings.enabledFeatures
    if (company?.enabledFeatures?.includes(featureId)) return true;
    const settings = typeof company?.settings === 'string'
      ? (() => { try { return JSON.parse(company.settings); } catch { return {}; } })()
      : (company?.settings || {});
    return settings.enabledFeatures?.includes(featureId) ?? false;
  };

  // Expose token for components still using raw fetch() during migration
  const token = api.accessToken;

  return (
    <AuthContext.Provider value={{
      user,
      company,
      loading,
      error,
      isAuthenticated,
      isAdmin,
      isCaregiver,
      token,
      login,
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
