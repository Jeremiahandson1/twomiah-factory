import React from 'react'
import { Pressable, View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { tabBarMetrics } from '../../theme/insets'
import { MIN_TARGET } from '../tokens'

export interface BarItem { key: string; label: string; icon: string; activeIcon: string; badge?: number }
/**
 * The bottom bar as drawn in the design (the real app's bar is expo-router's Tabs — theme/insets.ts sizes it). Five items at most;
 * the active one is business-colour text with a filled icon and a short bar above it (so it is not colour alone); labels are 12 points.
 */
export function BottomBar({ items, active, onPress }: { items: BarItem[]; active: string; onPress?: (key: string) => void }) {
  const { c } = useDesign()
  const insets = useSafeAreaInsets()
  const m = tabBarMetrics(insets.bottom)
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', minHeight: m.height, paddingBottom: m.paddingBottom, paddingTop: 6, backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
      {items.map((it) => {
        const on = it.key === active
        return (
          <Pressable key={it.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.badge ? `${it.label}, ${it.badge} new` : it.label} onPress={() => onPress?.(it.key)}
            style={{ flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <View style={{ position: 'absolute', top: 0, width: 28, height: 3, borderRadius: 2, backgroundColor: on ? c.accent : 'transparent' }} />
            <View><Icon name={on ? it.activeIcon : it.icon} size={24} tone={on ? 'accent' : 'subtle'} />
              {it.badge ? <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.tones.danger.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><DText variant="overline" style={{ color: c.tones.danger.onFill, textTransform: 'none', lineHeight: 14 }}>{it.badge}</DText></View> : null}</View>
            <DText variant="captionStrong" tone={on ? 'accentText' : 'textSubtle'} numberOfLines={1}>{it.label}</DText>
          </Pressable>
        )
      })}
    </View>
  )
}
