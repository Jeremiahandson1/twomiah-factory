import React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

export type PortalContactType = 'client' | 'lead' | 'vendor' | 'subcontractor' | 'architect' | 'consultant' | 'inspector' | 'supplier' | string;

interface PortalContextValue {
  token: string | undefined;
  contact: Record<string, unknown> | undefined;
  contactType: PortalContactType;
  company: Record<string, unknown> | undefined;
  summary: Record<string, unknown> | undefined;
  loading: boolean;
  error: string | null;
  fetch: (endpoint: string, options?: RequestInit) => Promise<any>;
}

const PortalContext = createContext<PortalContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || '';

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const { token } = useParams();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    
    async function loadPortal() {
      try {
        const response = await fetch(`${API_URL}/api/portal/p/${token}`);
        if (!response.ok) {
          let errMsg = 'Failed to load portal';
          try { const err = await response.json(); errMsg = err.error || errMsg; } catch {}
          throw new Error(errMsg);
        }
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    
    loadPortal();
  }, [token]);

  const portalFetch = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${API_URL}/api/portal/p/${token}${endpoint}`, {
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

  const contact = data?.contact as Record<string, unknown> | undefined;
  const contactType = ((contact?.type as string) || 'client') as PortalContactType;

  const value: PortalContextValue = {
    token,
    contact,
    contactType,
    company: data?.company as Record<string, unknown> | undefined,
    summary: data?.summary as Record<string, unknown> | undefined,
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
