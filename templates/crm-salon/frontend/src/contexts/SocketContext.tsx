import React from 'react';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import type { SocketContextValue } from '../types';

const SocketContext = createContext<SocketContextValue | null>(null);

const SOCKET_URL = import.meta.env.VITE_API_URL || '';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isAuthenticated } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef(new Map<string, Set<(...args: unknown[]) => void>>());

  useEffect(() => {
    const currentToken = getToken();
    if (!isAuthenticated || !currentToken) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    const newSocket = io(SOCKET_URL, {
      auth: { token: currentToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      setConnected(true);
      console.log('Socket connected');
    });

    newSocket.on('disconnect', (reason) => {
      setConnected(false);
      console.log('Socket disconnected:', reason);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
    });

    // Notification handler
    newSocket.on('notification', (data: { message?: string }) => {
      toast.info(data.message || 'New notification');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated, getToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to event
  const subscribe = useCallback((event: string, callback: (...args: unknown[]) => void) => {
    if (!socket) return () => {};

    socket.on(event, callback as (...args: unknown[]) => void);

    // Track listener
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      socket.off(event, callback as (...args: unknown[]) => void);
      listenersRef.current.get(event)?.delete(callback);
    };
  }, [socket]);

  // Emit event
  const emit = useCallback((event: string, data?: unknown) => {
    if (socket && connected) {
      socket.emit(event, data);
    }
  }, [socket, connected]);

  // Join room (e.g., project)
  const joinRoom = useCallback((room: string) => {
    if (socket && connected) {
      socket.emit(`join:${room.split(':')[0]}`, room.split(':')[1]);
    }
  }, [socket, connected]);

  // Leave room
  const leaveRoom = useCallback((room: string) => {
    if (socket && connected) {
      socket.emit(`leave:${room.split(':')[0]}`, room.split(':')[1]);
    }
  }, [socket, connected]);

  const value: SocketContextValue = {
    socket,
    connected,
    subscribe,
    emit,
    joinRoom,
    leaveRoom,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}

// Hook for subscribing to real-time updates
export function useRealTimeUpdates(event: string, callback: (...args: unknown[]) => void, deps: React.DependencyList = []) {
  const { subscribe } = useSocket();

  useEffect(() => {
    const unsubscribe = subscribe(event, callback);
    return unsubscribe;
  }, [event, subscribe, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Event types (match backend)
export const EVENTS = {
  CONTACT_CREATED: 'contact:created',
  CONTACT_UPDATED: 'contact:updated',
  CONTACT_DELETED: 'contact:deleted',
  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  PROJECT_DELETED: 'project:deleted',
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:updated',
  JOB_DELETED: 'job:deleted',
  JOB_STATUS_CHANGED: 'job:status_changed',
  QUOTE_CREATED: 'quote:created',
  QUOTE_UPDATED: 'quote:updated',
  QUOTE_SENT: 'quote:sent',
  QUOTE_APPROVED: 'quote:approved',
  INVOICE_CREATED: 'invoice:created',
  INVOICE_UPDATED: 'invoice:updated',
  INVOICE_SENT: 'invoice:sent',
  INVOICE_PAID: 'invoice:paid',
  PAYMENT_RECEIVED: 'invoice:payment_received',
  RFI_CREATED: 'rfi:created',
  RFI_RESPONDED: 'rfi:responded',
  CO_CREATED: 'change_order:created',
  CO_APPROVED: 'change_order:approved',
  NOTIFICATION: 'notification',
} as const;

export default SocketContext;
