import { createContext, useContext, useState, useMemo, type ReactNode } from 'react'

interface ToastAPI {
  (msg: string, type?: 'success' | 'error' | 'info'): void
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

const noop: ToastAPI = (() => {}) as any
const ToastContext = createContext<ToastAPI>(noop)
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: string }>>([])

  const toast = useMemo(() => {
    const fn = ((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = Date.now() + Math.random()
      setToasts(prev => [...prev, { id, msg, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
    }) as ToastAPI
    fn.success = (msg: string) => fn(msg, 'success')
    fn.error = (msg: string) => fn(msg, 'error')
    fn.info = (msg: string) => fn(msg, 'info')
    return fn
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-lg shadow-lg text-sm text-white ${t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
