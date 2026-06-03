/**
 * Vertical context — produces tab configuration for the rest of the app.
 *
 * Resolution order:
 *   1. extra.lockedVertical from app.config.ts (set by APP_VARIANT) — highest precedence.
 *      Branded variant builds (Twomiah Build / Twomiah Roofer) lock the UI to one vertical
 *      regardless of which tenant logs in.
 *   2. company.vertical from the logged-in tenant.
 *   3. Inferred from enabledFeatures.
 *   4. Default ('contractor').
 */

import React, { createContext, useContext, useMemo } from 'react'
import Constants from 'expo-constants'
import { useAuth } from '../auth/AuthContext'
import { detectVertical } from './detectVertical'
import { Vertical, VERTICAL_TABS, VERTICAL_INITIAL_TAB, TabDef } from './verticals'

interface VerticalContextValue {
  vertical: Vertical
  tabs: TabDef[]
  initialTab: string
  hasFeature: (feature: string) => boolean
  /** True if app variant locks vertical AND tenant's vertical doesn't match. */
  verticalMismatch: boolean
  /** The locked vertical from app config, if any. */
  lockedVertical: Vertical | null
}

const VALID_VERTICALS: Vertical[] = ['contractor', 'fieldservice', 'homecare', 'roofing', 'landscaping', 'dispensary']

function readLockedVertical(): Vertical | null {
  const raw = (Constants.expoConfig?.extra as any)?.lockedVertical
  if (typeof raw === 'string' && VALID_VERTICALS.includes(raw as Vertical)) {
    return raw as Vertical
  }
  return null
}

const LOCKED_VERTICAL = readLockedVertical()

const DEFAULT_VERTICAL: Vertical = LOCKED_VERTICAL || 'contractor'

const VerticalContext = createContext<VerticalContextValue>({
  vertical: DEFAULT_VERTICAL,
  tabs: VERTICAL_TABS[DEFAULT_VERTICAL],
  initialTab: VERTICAL_INITIAL_TAB[DEFAULT_VERTICAL],
  hasFeature: () => false,
  verticalMismatch: false,
  lockedVertical: LOCKED_VERTICAL,
})

export function VerticalProvider({ children }: { children: React.ReactNode }) {
  const { company } = useAuth()

  const value = useMemo<VerticalContextValue>(() => {
    const tenantVertical = detectVertical(company?.vertical, company?.enabledFeatures)
    const vertical: Vertical = LOCKED_VERTICAL || tenantVertical

    const verticalMismatch = !!(
      LOCKED_VERTICAL &&
      company &&
      tenantVertical &&
      tenantVertical !== LOCKED_VERTICAL
    )

    const featureSet = new Set((company?.enabledFeatures || []).map(f => f.toLowerCase()))

    return {
      vertical,
      tabs: VERTICAL_TABS[vertical],
      initialTab: VERTICAL_INITIAL_TAB[vertical],
      hasFeature: (f: string) => featureSet.has(f.toLowerCase()),
      verticalMismatch,
      lockedVertical: LOCKED_VERTICAL,
    }
  }, [company?.vertical, company?.enabledFeatures, company?.id])

  return (
    <VerticalContext.Provider value={value}>
      {children}
    </VerticalContext.Provider>
  )
}

export const useVertical = () => useContext(VerticalContext)
