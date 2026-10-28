import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { MIN_TARGET, radius, space } from '../tokens'

/** One filter chip: 44 points tall, selected = business-colour fill, and it says "selected" to a screen reader. */
export function Chip({ label, count, selected, onPress }: { label: string; count?: number; selected?: boolean; onPress?: () => void }) {
  const { c } = useDesign()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={count != null ? `${label}, ${count}` : label} accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={({ pressed }) => ({ minHeight: MIN_TARGET, minWidth: MIN_TARGET, paddingHorizontal: space[4], borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: space[2],
        backgroundColor: selected ? c.accentFill : c.surface, borderWidth: 1.5, borderColor: selected ? c.accentFill : c.borderStrong, opacity: pressed ? 0.85 : 1 })}>
      <DText variant="bodyStrong" style={{ color: selected ? c.onAccent : c.text }}>{label}</DText>
      {count != null ? <DText variant="captionStrong" style={{ color: selected ? c.onAccent : c.textSecondary }}>{count}</DText> : null}
    </Pressable>
  )
}
/** A row of chips that scrolls sideways; it never grows taller than a chip. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2], paddingHorizontal: space[4], flexGrow: 0 }} style={{ flexGrow: 0 }}><View style={{ flexDirection: 'row', gap: space[2] }}>{children}</View></ScrollView>
}
