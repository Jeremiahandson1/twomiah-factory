import React from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { MIN_TARGET, layout, space } from '../tokens'

export interface HeaderAction { icon: string; label: string; onPress?: () => void; badge?: number }
/**
 * The screen scaffold. A header (back button when there is somewhere to go back to, a title that wraps instead of clipping, a
 * subtitle, up to two icon actions of 44×44), then a body that scrolls with the gutter and the bottom system inset built in, and an
 * optional pinned footer (the primary action — e.g. "Record payment") that sits above the system buttons.
 * Top inset: the status bar. Bottom inset: the gesture bar / buttons — the same rule as theme/insets.ts.
 */
export function Screen({ title, subtitle, onBack, actions, children, footer, scroll = true, scrollEnabled = true, refreshing, onRefresh, bottomBar, topInset }: {
  title: string; subtitle?: string; onBack?: () => void; actions?: HeaderAction[]; children: React.ReactNode; footer?: React.ReactNode
  scroll?: boolean; /** false while a finger is drawing on the screen (a signature), so the stroke is not taken for a scroll */ scrollEnabled?: boolean; refreshing?: boolean; onRefresh?: () => void; bottomBar?: React.ReactNode; topInset?: number
}) {
  const { c } = useDesign()
  const insets = useSafeAreaInsets()
  const top = topInset ?? insets.top
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingTop: top, backgroundColor: c.background, paddingHorizontal: layout.gutter - 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: space[1] }}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevron-back" size={26} tone="text" />
            </Pressable>
          ) : <View style={{ width: space[1] }} />}
          <View style={{ flex: 1, paddingVertical: space[2] }}>
            <DText variant={onBack ? 'headline' : 'display'} accessibilityRole="header" numberOfLines={2}>{title}</DText>
            {subtitle ? <DText variant="callout" tone="textSecondary" numberOfLines={2}>{subtitle}</DText> : null}
          </View>
          {(actions || []).slice(0, 2).map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.badge ? `${a.label}, ${a.badge} new` : a.label} onPress={a.onPress} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={a.icon} size={24} tone="text" />
              {a.badge ? <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.tones.danger.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><DText variant="overline" style={{ color: c.tones.danger.onFill, textTransform: 'none', fontSize: 12, lineHeight: 14 }}>{a.badge}</DText></View> : null}
            </Pressable>
          ))}
        </View>
      </View>
      {scroll ? (
        <ScrollView style={{ flex: 1 }} scrollEnabled={scrollEnabled} contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space[2], paddingBottom: footer || bottomBar ? space[4] : insets.bottom + space[6], gap: layout.gap }}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accentText} /> : undefined}>
          {children}
        </ScrollView>
      ) : <View style={{ flex: 1, paddingHorizontal: layout.gutter }}>{children}</View>}
      {footer ? <View style={{ paddingHorizontal: layout.gutter, paddingTop: space[3], paddingBottom: bottomBar ? space[3] : insets.bottom + space[3], backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>{footer}</View> : null}
      {bottomBar}
    </View>
  )
}
