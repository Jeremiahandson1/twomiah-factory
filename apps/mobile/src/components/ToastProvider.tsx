/**
 * Toast notification system — non-blocking, auto-dismissing notifications.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
})

const TOAST_CONFIG: Record<ToastType, { icon: string; bg: string; text: string }> = {
  success: { icon: 'checkmark-circle', bg: '#dcfce7', text: '#166534' },
  error: { icon: 'close-circle', bg: '#fee2e2', text: '#991b1b' },
  info: { icon: 'information-circle', bg: '#dbeafe', text: '#1d4ed8' },
  warning: { icon: 'warning', bg: '#fef3c7', text: '#92400e' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const insets = useSafeAreaInsets()
  const counterRef = useRef(0)

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const ctx: ToastContextValue = {
    show,
    success: (msg) => show(msg, 'success'),
    error: (msg) => show(msg, 'error'),
    info: (msg) => show(msg, 'info'),
    warning: (msg) => show(msg, 'warning'),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <View style={[styles.container, { top: insets.top + 8 }]} pointerEvents="box-none">
        {toasts.map(toast => {
          const config = TOAST_CONFIG[toast.type]
          return (
            <Animated.View
              key={toast.id}
              entering={FadeInUp.duration(250)}
              exiting={FadeOutUp.duration(200)}
            >
              <Pressable
                style={[styles.toast, { backgroundColor: config.bg }]}
                onPress={() => dismiss(toast.id)}
              >
                <Ionicons name={config.icon as any} size={20} color={config.text} />
                <Text style={[styles.message, { color: config.text }]} numberOfLines={2}>
                  {toast.message}
                </Text>
              </Pressable>
            </Animated.View>
          )
        })}
      </View>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

const styles = StyleSheet.create({
  container: {
    position: 'absolute', left: 16, right: 16,
    zIndex: 9999, gap: 6,
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  message: { flex: 1, fontSize: 14, fontWeight: '500' },
})
