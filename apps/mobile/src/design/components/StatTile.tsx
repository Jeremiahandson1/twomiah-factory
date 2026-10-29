import React from 'react'
import { Pressable, View } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { radius, elevationStyle, motion, space } from '../tokens'
import type { ToneName } from '../colors'

/**
 * A dashboard tile that is a BUTTON: it opens exactly the list it counts. Three things say so — a chevron badge in the corner,
 * a pressed state (the tile sinks and darkens), and a screen-reader label that reads "<label>: <value>. Opens <what>." The number
 * is the tile's heaviest element; the label is a full phrase, never clipped (it wraps, up to two lines at 130% text).
 */
export function StatTile({ label, value, icon, tone = 'accent', opens, hint, onPress, width }: {
  label: string; value: string | number; icon: string; tone?: ToneName; opens: string; hint?: string; onPress?: () => void; width?: number
}) {
  const { c } = useDesign()
  // Every tile wears the BUSINESS's colour (owner, 2026-10-29: "it should look like our brand" — not a pink, a yellow and a blue
  // per tile). A tile's tone keeps only its meaning, in the small hint line ("2 overdue" red, "1 waiting" amber).
  const t = c.tones.accent
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}. Opens ${opens}.`} onPress={onPress}
      style={({ pressed }) => [{
        width, minHeight: 96, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: space[3], gap: space[2],
      }, elevationStyle(1, c.dark), pressed && { backgroundColor: c.surfaceAlt, transform: [{ scale: motion.pressScale }] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} tone="accent" />
        </View>
        <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron-forward" size={16} tone="subtle" />
        </View>
      </View>
      <View>
        <DText variant="stat" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</DText>
        <DText variant="callout" tone="textSecondary" numberOfLines={2}>{label}</DText>
        {hint ? <DText variant="caption" tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'textSubtle'} numberOfLines={1}>{hint}</DText> : null}
      </View>
    </Pressable>
  )
}
