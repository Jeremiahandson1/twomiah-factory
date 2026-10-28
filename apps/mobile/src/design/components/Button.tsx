import React from 'react'
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { MIN_TARGET, radius, space, motion } from '../tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'danger' | 'ghost'
/** Buttons: primary is the business colour; every size is at least 44 points tall; loading and disabled are announced. */
export function Button({ label, onPress, variant = 'primary', size = 'md', icon, loading, disabled, fullWidth, accessibilityHint }: {
  label: string; onPress?: () => void; variant?: ButtonVariant; size?: 'md' | 'lg'; icon?: string; loading?: boolean; disabled?: boolean; fullWidth?: boolean; accessibilityHint?: string
}) {
  const { c } = useDesign()
  const v = {
    primary: { bg: c.accentFill, fg: c.onAccent, border: c.accentFill },
    secondary: { bg: 'transparent', fg: c.text, border: c.borderStrong },
    tonal: { bg: c.accentSoft, fg: c.accentText, border: 'transparent' },
    danger: { bg: c.tones.danger.fill, fg: c.tones.danger.onFill, border: c.tones.danger.fill },
    ghost: { bg: 'transparent', fg: c.accentText, border: 'transparent' },
  }[variant]
  const off = disabled || loading
  const box: ViewStyle = { minHeight: size === 'lg' ? 56 : Math.max(48, MIN_TARGET), minWidth: MIN_TARGET, borderRadius: radius.md, borderWidth: 1.5, borderColor: v.border, backgroundColor: v.bg, paddingHorizontal: space[5], alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space[2], alignSelf: fullWidth ? 'stretch' : 'flex-start' }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [box, off && { opacity: 0.5 }, pressed && { transform: [{ scale: motion.pressScale }], opacity: 0.88 }]}>
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicon name={icon} color={v.fg} /> : null}
      <DText variant="bodyStrong" style={{ color: v.fg, textAlign: 'center', flexShrink: 1 }}>{label}</DText>
    </Pressable>
  )
}
import { Ionicons } from '@expo/vector-icons'
function Ionicon({ name, color }: { name: string; color: string }) {
  return <View accessibilityElementsHidden importantForAccessibility="no"><Ionicons name={name as any} size={20} color={color} /></View>
}
