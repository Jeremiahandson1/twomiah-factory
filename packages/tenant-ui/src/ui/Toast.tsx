// In-app notifications — one implementation for every admin. Each CRM template kept its own contexts/ToastContext.tsx
// and they had drifted into three versions; this is crm-salon's (typed, and the warning colours carry their full dark
// pair), which the unified app uses and the templates can switch to.
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'
export interface ToastItem { id: number; message: string; type: ToastType }
export interface ToastActions {
  success: (msg: string, duration?: number) => number
  error: (msg: string, duration?: number) => number
  info: (msg: string, duration?: number) => number
  warning: (msg: string, duration?: number) => number
}

const ToastContext = createContext<ToastActions | null>(null)

const icons: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const colors: Record<ToastType, string> = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:text-green-300 dark:bg-green-950/40',
  error: 'bg-red-50 border-red-200 text-red-800 dark:text-red-400 dark:bg-red-950/40',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  warning: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700/50 text-yellow-800 dark:text-yellow-100',
}

const iconColors: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-500',
  warning: 'text-yellow-500',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // Long enough to read: four seconds for every message was gone before a refusal could be read (salon live test,
  // 2026-10-25: "the red message disappears within about a second"). A refusal or warning stays at least 8s, any message
  // ~20 characters a second longer; the close button is always there. A caller's own duration still wins.
  const addToast = useCallback((message: string, type: ToastType = 'info', duration?: number): number => {
    if (duration === undefined) duration = Math.max(type === 'error' || type === 'warning' ? 8000 : 4000, String(message).length * 50)
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])
    if (duration > 0) setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
    return id
  }, [])

  const removeToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  // A safety net for code not yet converted: a legacy window.alert() becomes an in-app toast instead of a blocking
  // native popup (which also showed the server's hostname). Failure wording, or anything that isn't a plain
  // confirmation, shows as an error. A page that means to report a failure should call toast.error.
  useEffect(() => {
    const original = window.alert
    window.alert = (message?: unknown) => {
      const msg = message == null ? '' : String(message)
      const looksFailed = /fail|error|invalid|unable|cannot|can.t|could not|couldn|denied|wrong|not found|required|must |already|no longer|exceed|refused|not allowed|too /i.test(msg)
      const looksDone = /\b(saved|sent|copied|done|updated|created|added|removed|scheduled|success|complete)\b/i.test(msg)
      addToast(msg, looksFailed || !looksDone ? 'error' : 'info')
    }
    return () => { window.alert = original }
  }, [addToast])

  const toast: ToastActions = {
    success: (msg, duration) => addToast(msg, 'success', duration),
    error: (msg, duration) => addToast(msg, 'error', duration),
    info: (msg, duration) => addToast(msg, 'info', duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Above the z-50 dialogs: a toast reporting a dialog's error is useless underneath it.
          ON THE SCREEN, WHATEVER IT SAYS (roofing live test 2026-10-22: "Toast messages are cut off at the right edge").
          The stack was pinned to the right with only a max width, and the message was a flex item at its default
          min-width (its longest word), so a long unbroken token — "character(s);", an address, an id — pushed the box
          past the edge, and at 390px a 384px-wide stack 16px from the right started off the left. Now the stack is held
          16px inside BOTH edges on a phone (right-aligned, at most 24rem, on a wider screen) and the message wraps
          anywhere it must. */}
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[100] flex flex-col items-stretch sm:items-end gap-2 sm:max-w-sm" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.type]
          return (
            <div key={t.id} className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-toast-in max-w-full min-w-0 ${colors[t.type]}`}>
              <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColors[t.type]}`} />
              <p className="flex-1 min-w-0 text-sm break-words [overflow-wrap:anywhere]">{t.message}</p>
              <button aria-label="Dismiss notification" onClick={() => removeToast(t.id)} className="flex-shrink-0 hover:opacity-70">
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes toast-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-toast-in { animation: toast-in 0.2s ease-out; }
        @media (prefers-reduced-motion: reduce) { .animate-toast-in { animation: none; } }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastActions {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}
