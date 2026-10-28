import React from 'react'
import { View } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'

/** Initials in a soft disc. The name is spoken by the row next to it, so the disc is hidden from screen readers. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { c } = useDesign()
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><DText variant="captionStrong" tone="accentText">{initials}</DText></View>
}
