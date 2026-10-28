import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import type { ToneName } from '../colors'
import { useDesign } from '../DesignContext'

/** A decorative icon (hidden from screen readers — the words beside it carry the meaning). Colour by tone, never by hex. */
export function Icon({ name, size = 22, tone = 'neutral' as ToneName | 'text' | 'subtle' | 'onAccent' }: { name: string; size?: number; tone?: ToneName | 'text' | 'subtle' | 'onAccent' }) {
  const { c } = useDesign()
  const color = tone === 'text' ? c.text : tone === 'subtle' ? c.textSubtle : tone === 'onAccent' ? c.onAccent : c.tones[tone].fg
  return <Ionicons name={name as any} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />
}
