import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // Route legacy window.alert() through the in-app toast instead of a blocking native popup.
  useEffect(() => {
    const original = window.alert;
    window.alert = (message) => {
      const msg = message == null ? '' : String(message);
      const isError = /fail|error|invalid|unable|cannot|can.t|denied|wrong|not found|required|must /i.test(msg);
      toast(msg, isError ? 'error' : 'info');
    };
    return () => { window.alert = original; };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} onClick={() => dismiss(t.id)}
            className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium cursor-pointer pointer-events-auto max-w-sm
              ${t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : t.type === 'warning' ? 'bg-yellow-600' : 'bg-gray-800'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.toast;
};
