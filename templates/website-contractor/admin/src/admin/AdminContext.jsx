import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, verifyToken, logout as apiLogout, getSiteSettings as getSettings } from './api';

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('adminDarkMode') === 'true';
  });

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('adminToken');
      if (token) {
        const valid = await verifyToken();
        setIsAuthenticated(valid);
        if (!valid) {
          localStorage.removeItem('adminToken');
        } else {
          // Load settings once authenticated
          try {
            const s = await getSettings();
            if (s) setSettings(s);
          } catch (e) { /* settings load is non-fatal */ }
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('admin-dark-mode');
    } else {
      document.body.classList.remove('admin-dark-mode');
    }
    localStorage.setItem('adminDarkMode', darkMode);
  }, [darkMode]);

  const login = async (password) => {
    try {
      await apiLogin(password);
      setIsAuthenticated(true);
      return true;
    } catch (err) {
      console.error('Login error:', err);
      return false;
    }
  };

  const logout = () => {
    apiLogout();
    setIsAuthenticated(false);
  };

  const toggleDarkMode = () => {
    setDarkMode(prev => !prev);
  };

  return (
    <AdminContext.Provider value={{ 
      isAuthenticated, 
      loading, 
      login, 
      logout,
      darkMode,
      toggleDarkMode,
      settings,
      refreshSettings: async () => {
        try { const s = await getSettings(); if (s) setSettings(s); } catch(e) {}
      }
    }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
