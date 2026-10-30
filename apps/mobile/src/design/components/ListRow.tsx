import React from 'react'
import { Pressable, View } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { Badge } from './Badge'
import { MIN_TARGET, radius, space } from '../tokens'
import type { ToneName } from '../colors'

/**
 * One line of a list: a leading icon or avatar, a title and subtitle that wrap (never one clipped line), a right-hand value, an
 * optional status badge, a chevron when it opens something. At least 56 points tall; a screen reader gets one sentence.
 */
export function ListRow({ title, subtitle, meta, badge, badgeTone = 'neutral', icon, iconTone = 'accent', leading, onPress, divider = true, destructive }: {
  title: string; subtitle?: string; meta?: string; badge?: string; badgeTone?: ToneName; icon?: string; iconTone?: ToneName
  leading?: React.ReactNode; onPress?: () => void; divider?: boolean; destructive?: boolean
}) {
  const { c } = useDesign()
  const t = c.tones[iconTone]
  // The business's colour fills the square, as on the home tiles (StatTile); a status tone keeps its soft square and its meaning.
  const brand = iconTone === 'accent'
  const label = [title, subtitle, meta, badge].filter(Boolean).join(', ')
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: Math.max(56, MIN_TARGET), paddingVertical: space[2], paddingHorizontal: space[4] }}>
      {leading ?? (icon ? <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: brand ? t.fill : t.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} tone={brand ? 'onAccent' : iconTone} /></View> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <DText variant="bodyStrong" tone={destructive ? 'danger' : 'text'}>{title}</DText>
        {subtitle ? <DText variant="callout" tone="textSecondary">{subtitle}</DText> : null}
      </View>
      {badge ? <Badge label={badge} tone={badgeTone} /> : null}
      {meta ? <DText variant="bodyStrong" style={{ textAlign: 'right' }}>{meta}</DText> : null}
      {onPress ? <Icon name="chevron-forward" size={18} tone="subtle" /> : null}
    </View>
  )
  const line = divider ? <View style={{ height: 1, backgroundColor: c.border, marginLeft: space[4] }} /> : null
  if (!onPress) return <View accessible accessibilityLabel={label}>{body}{line}</View>
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [pressed && { backgroundColor: c.surfaceAlt }]}>{body}</Pressable>
      {line}
    </View>
  )
}
