/**
 * useDesign() — the colour roles (colors.ts) for the current screen: the business colour and light/dark from the app's ThemeContext,
 * or, in the dev-only preview, set explicitly by <DesignProvider> so one screen can be shown in either scheme and any business colour.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { colorRoles, type Roles } from './colors'

const Override = createContext<{ primary: string; dark: boolean } | null>(null)

export function DesignProvider({ primary, dark, children }: { primary: string; dark: boolean; children: React.ReactNode }) {
  const v = useMemo(() => ({ primary, dark }), [primary, dark])
  return <Override.Provider value={v}>{children}</Override.Provider>
}

export function useDesign(): { c: Roles } {
  const o = useContext(Override)
  const t = useTheme()
  const primary = o?.primary ?? t.primary ?? '#1e40af'
  const dark = o?.dark ?? !!t.isDark
  return useMemo(() => ({ c: colorRoles(primary, dark) }), [primary, dark])
}

/** True when the phone's "remove animations" setting is on: components then skip their movement. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (live) setReduce(!!v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v))
    return () => { live = false; sub?.remove?.() }
  }, [])
  return reduce
}
