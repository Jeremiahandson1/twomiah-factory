/**
 * Vertical context — detects which CRM vertical the user logged into
 * and provides tab configuration for the rest of the app.
 */

import React, { createContext, useContext, useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { detectVertical } from './detectVertical'
import { Vertical, VERTICAL_TABS, VERTICAL_INITIAL_TAB, TabDef } from './verticals'

interface VerticalContextValue {
  vertical: Vertical
  tabs: TabDef[]
  initialTab: string
  hasFeature: (feature: string) => boolean
}

const VerticalContext = createContext<VerticalContextValue>({
  vertical: 'contractor',
  tabs: VERTICAL_TABS.contractor,
  initialTab: 'dashboard',
  hasFeature: () => false,
})

export function VerticalProvider({ children }: { children: React.ReactNode }) {
  const { company } = useAuth()

  const value = useMemo<VerticalContextValue>(() => {
    const vertical = detectVertical(company?.vertical, company?.enabledFeatures)
    const featureSet = new Set((company?.enabledFeatures || []).map(f => f.toLowerCase()))

    return {
      vertical,
      tabs: VERTICAL_TABS[vertical],
      initialTab: VERTICAL_INITIAL_TAB[vertical],
      hasFeature: (f: string) => featureSet.has(f.toLowerCase()),
    }
  }, [company?.vertical, company?.enabledFeatures])

  return (
    <VerticalContext.Provider value={value}>
      {children}
    </VerticalContext.Provider>
  )
}

export const useVertical = () => useContext(VerticalContext)
