/**
 * Shared building blocks for the caregiver screens, on the app's theme (ThemeContext) so every
 * piece works in light and dark. Tinted banners use a fixed PAIR per theme — ground, border and
 * ink chosen together — never a light-mode tint on a dark screen.
 */
import React from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator,
  type TextInputProps, type ViewStyle, type StyleProp,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme/ThemeContext'
import { readableOn, contrast } from './rules'

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const TONES: Record<Tone, { light: { bg: string; border: string; text: string }; dark: { bg: string; border: string; text: string } }> = {
  info: { light: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e3a8a' }, dark: { bg: '#172554', border: '#1e40af', text: '#dbeafe' } },
  success: { light: { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' }, dark: { bg: '#052e16', border: '#166534', text: '#bbf7d0' } },
  warning: { light: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' }, dark: { bg: '#422006', border: '#92400e', text: '#fde68a' } },
  danger: { light: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' }, dark: { bg: '#450a0a', border: '#991b1b', text: '#fecaca' } },
  neutral: { light: { bg: '#f1f5f9', border: '#e2e8f0', text: '#334155' }, dark: { bg: '#242838', border: '#334155', text: '#e2e8f0' } },
}

export function useTone(tone: Tone) {
  const t = useTheme()
  return t.isDark ? TONES[tone].dark : TONES[tone].light
}

/** The agency colour as link / ghost-button text on the card surface — the tenant's colour can be
 * any shade, and a dark one on the dark theme's surface is unreadable (teal: 3.05:1). */
export function usePrimaryInk() {
  const t = useTheme()
  return readableOn(t.primary, t.surface, t.isDark)
}

/** Solid action colours (white ink passes 4.5:1 on each). */
export const SOLID = { danger: '#b91c1c', success: '#047857', warning: '#b45309' }

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme()
  const body = <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>
  if (!onPress) return body
  return <TouchableOpacity activeOpacity={0.75} onPress={onPress} accessibilityRole="button">{body}</TouchableOpacity>
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>{children}</Text>
      {right}
    </View>
  )
}

export function Banner({ tone, icon, title, children, onPress, right }: {
  tone: Tone; icon?: string; title?: string; children?: React.ReactNode; onPress?: () => void; right?: React.ReactNode
}) {
  const c = useTone(tone)
  const inner = (
    <View style={[styles.banner, { backgroundColor: c.bg, borderColor: c.border }]}>
      {icon ? <Ionicons name={icon as any} size={20} color={c.text} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1 }}>
        {title ? <Text style={[styles.bannerTitle, { color: c.text }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Text style={[styles.bannerText, { color: c.text }]}>{children}</Text> : children}
      </View>
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={c.text} /> : null}
    </View>
  )
  if (!onPress) return inner
  return <TouchableOpacity activeOpacity={0.8} onPress={onPress} accessibilityRole="button">{inner}</TouchableOpacity>
}

/** Body text inside a Banner, in that banner's ink. */
export function BannerText({ tone, children, bold }: { tone: Tone; children: React.ReactNode; bold?: boolean }) {
  const c = useTone(tone)
  return <Text style={[styles.bannerText, { color: c.text }, bold && { fontWeight: '700' }]}>{children}</Text>
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'

export function Button({ label, onPress, variant = 'primary', icon, disabled, loading, style, small }: {
  label: string; onPress: () => void; variant?: Variant; icon?: string; disabled?: boolean; loading?: boolean
  style?: StyleProp<ViewStyle>; small?: boolean
}) {
  const t = useTheme()
  const link = usePrimaryInk()
  const solid = variant === 'primary' ? t.primary : variant === 'danger' ? SOLID.danger : variant === 'success' ? SOLID.success : null
  // White on the agency's colour unless that colour is too light for it (then near-black).
  const onSolid = solid && /^#[0-9a-f]{6}$/i.test(solid) && contrast('#ffffff', solid) < 4.5 ? '#0f172a' : '#ffffff'
  const ink = solid ? onSolid : variant === 'ghost' ? link : t.text
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={[
        styles.btn, small && styles.btnSmall,
        solid ? { backgroundColor: solid } : variant === 'secondary' ? { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border } : { backgroundColor: 'transparent' },
        (disabled || loading) && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={ink} /> : icon ? <Ionicons name={icon as any} size={small ? 16 : 20} color={ink} /> : null}
      <Text style={[styles.btnText, small && { fontSize: 14 }, { color: ink }]}>{label}</Text>
    </TouchableOpacity>
  )
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const t = useTheme()
  const danger = useTone('danger')
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.textMuted}
        {...props}
        style={[
          styles.input,
          { color: t.text, backgroundColor: t.surface, borderColor: error ? danger.border : t.border },
          props.multiline && { minHeight: 88, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {error ? <Text style={[styles.hint, { color: danger.text, fontWeight: '600' }]}>{error}</Text> : hint ? <Text style={[styles.hint, { color: t.textSecondary }]}>{hint}</Text> : null}
    </View>
  )
}

/** A tappable choice (radio-like). */
export function Choice({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, { borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primaryLight : t.surface }]}
    >
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? t.primary : t.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceLabel, { color: t.text }]}>{label}</Text>
        {sub ? <Text style={[styles.choiceSub, { color: t.textSecondary }]}>{sub}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

export function KeyValue({ label, value }: { label: string; value?: string | null }) {
  const t = useTheme()
  if (!value) return null
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[styles.kvLabel, { color: t.textSecondary }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: t.text }]}>{value}</Text>
    </View>
  )
}

export function Badge({ count }: { count: number }) {
  if (!count) return null
  return (
    <View style={styles.badge}><Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text></View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  bannerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 12, minHeight: 50 },
  btnSmall: { paddingVertical: 9, paddingHorizontal: 12, minHeight: 40, borderRadius: 10 },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  hint: { fontSize: 13, marginTop: 4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 10, padding: 12, marginBottom: 8 },
  choiceLabel: { fontSize: 15, fontWeight: '600' },
  choiceSub: { fontSize: 13, marginTop: 2 },
  kvLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  kvValue: { fontSize: 15, marginTop: 2, lineHeight: 21 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
})
