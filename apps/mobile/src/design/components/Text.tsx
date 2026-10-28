import React from 'react'
import { Text, type TextProps, type TextStyle } from 'react-native'
import { useDesign } from '../DesignContext'
import { type, MAX_FONT_SCALE, type TypeVariant } from '../tokens'
import type { Roles } from '../colors'

export type TextTone = 'text' | 'textSecondary' | 'textSubtle' | 'accentText' | 'onAccent' | 'success' | 'warning' | 'danger' | 'info'
/** The only Text the design system uses: a variant from the scale, a colour ROLE (never a hex), and text that scales to 130% and no further. */
export function DText({ variant = 'body', tone = 'text', style, children, ...rest }: TextProps & { variant?: TypeVariant; tone?: TextTone; children?: React.ReactNode }) {
  const { c } = useDesign()
  const v = type[variant]
  const s: TextStyle = { fontSize: v.size, lineHeight: v.line, fontWeight: v.weight, color: c[tone as keyof Roles] as string }
  if (v.letterSpacing) s.letterSpacing = v.letterSpacing
  if (v.uppercase) s.textTransform = 'uppercase'
  return <Text allowFontScaling maxFontSizeMultiplier={MAX_FONT_SCALE} style={[s, style]} {...rest}>{children}</Text>
}
