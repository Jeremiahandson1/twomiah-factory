/**
 * White-label theme — reads branding from the tenant's company config at runtime.
 * Falls back to Twomiah defaults if no company data is available.
 */

import React, { createContext, useContext, useMemo } from 'react'
import { useColorScheme } from 'react-native'
import { useAuth } from '../auth/AuthContext'

interface Theme {
  primary: string
  primaryLight: string
  background: string
  surface: string
  surfaceAlt: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  error: string
  success: string
  warning: string
  isDark: boolean
  companyName: string
  logo: string | null
}

const ThemeContext = createContext<Theme>({} as Theme)

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme()
  const { company } = useAuth()
  const isDark = colorScheme === 'dark'

  const primary = company?.primaryColor || '#1e40af'

  const theme = useMemo<Theme>(() => ({
    primary,
    primaryLight: hexToRgba(primary, 0.12),
    background: isDark ? '#0f1117' : '#f8fafc',
    surface: isDark ? '#1a1d2e' : '#ffffff',
    surfaceAlt: isDark ? '#242838' : '#f1f5f9',
    text: isDark ? '#f1f5f9' : '#0f172a',
    textSecondary: isDark ? '#94a3b8' : '#475569',
    textMuted: isDark ? '#64748b' : '#94a3b8',
    border: isDark ? '#334155' : '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    isDark,
    companyName: company?.name || 'Twomiah',
    logo: company?.logo || null,
  }), [primary, isDark, company])

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
