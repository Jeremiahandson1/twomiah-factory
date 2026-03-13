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
      console.error('Auth check failed:', err);
      api.clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

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
  const isAdmin = user?.role === 'admin';
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
