import React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext<any>(null);

/**
 * The agency record for the screens — or, when the agency is LOCKED (cancelled in the Factory), the summary sign-in and
 * /me sent, whose settings.accountLock sends every role to the lock page (App.tsx). A locked agency's /api/company is a
 * 402, and treating that as "session invalid" signed the person out instead of showing them the way back.
 */
async function agencyOrLock(summary: any) {
  if (summary?.settings?.accountLock) return summary;
  try {
    return await api.company.get();
  } catch (err: any) {
    if (err?.status === 402 && err?.data?.code === 'ACCOUNT_LOCKED') {
      return { ...(summary || {}), settings: { ...(summary?.settings || {}), accountLock: err.data.lock || 'subscription_ended' } };
    }
    throw err;
  }
}

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
      const userData = await api.getMe();
      // /me carries the agency's lock (settings.accountLock); a locked agency's /api/company is a 402.
      const companyData = await agencyOrLock(userData?.company);
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

  // An expired session (M-05, Run 3 HIGH 10) is handled under fetch itself — refreshed and replayed, or sent to sign in —
  // for every screen at once: services/sessionFetch.ts, installed by services/api.ts.

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      // Fetch company after login. A cancelled agency answers 402 here: sign-in's own company summary carries the lock.
      const companyData = await agencyOrLock(data.company);
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
