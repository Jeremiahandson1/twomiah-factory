import { createContext, useContext, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const PortalContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function PortalProvider({ children }) {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    
    async function loadPortal() {
      try {
        const response = await fetch(`${API_URL}/portal/p/${token}`);
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to load portal');
        }
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError(err.message);
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    
    loadPortal();
  }, [token]);

  const portalFetch = async (endpoint, options = {}) => {
    const response = await fetch(`${API_URL}/portal/p/${token}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Request failed');
    }
    
    return response.json();
  };

  const value = {
    token,
    contact: data?.contact,
    company: data?.company,
    summary: data?.summary,
    loading,
    error,
    fetch: portalFetch,
  };

  return (
    <PortalContext.Provider value={value}>
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error('usePortal must be used within PortalProvider');
  }
  return context;
}
