import React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import type { AuthContextValue, User, Company, AuthData } from '../types';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const data = await api.getMe() as Record<string, unknown>;
      setUser(data.user as User);
      setCompany(data.company as Company);
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

  // Handle session expiry from API client without hard navigation
  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      setCompany(null);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  const login = async (email: string, password: string): Promise<AuthData> => {
    setError(null);
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      setCompany(data.company);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    }
  };

  const register = async (formData: Record<string, string>): Promise<AuthData> => {
    setError(null);
    try {
      const data = await api.register(formData);
      setUser(data.user);
      setCompany(data.company);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
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

  const updateCompany = (updates: Partial<Company>) => {
    setCompany(prev => prev ? { ...prev, ...updates } : null);
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';
  const isManager = ['admin', 'manager'].includes(user?.role ?? '');

  const getToken = useCallback(() => localStorage.getItem('accessToken'), []);

  const hasFeature = (featureId: string): boolean => {
    return company?.enabledFeatures?.includes(featureId) ?? false;
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
      login,
      register,
      logout,
      checkAuth,
      updateCompany,
      hasFeature,
      getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
