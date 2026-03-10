import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const toastStyles: Record<ToastType, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-blue-600 text-white',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `toast-${++counterRef.current}`
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => removeToast(id), 3000)
    },
    [removeToast]
  )

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${toastStyles[toast.type]} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-in min-w-[280px]`}
          >
            <span className="flex-1 text-base font-medium">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded-full hover:bg-white/20 transition-colors touch-manipulation"
              aria-label="Dismiss"
            >
              <X size={20} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
