import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, verifyToken, logout as apiLogout } from './api';

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('adminDarkMode') === 'true';
  });

  useEffect(() => {
    // Check if already logged in
    const checkAuth = async () => {
      const token = localStorage.getItem('adminToken');
      if (token) {
        const valid = await verifyToken();
        setIsAuthenticated(valid);
        if (!valid) {
          localStorage.removeItem('adminToken');
        }
      }
      setLoading(false);
    };
    
    checkAuth();
  }, []);

  // Apply dark mode class to body
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
      toggleDarkMode
    }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
