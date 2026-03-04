import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
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

  const login = async (email, password) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      setCompany(data.company);
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
    }
  };

  const updateCompany = (updates) => {
    setCompany(prev => ({ ...prev, ...updates }));
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';
  const isManager = ['admin', 'manager'].includes(user?.role);

  const hasFeature = (featureId) => {
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
