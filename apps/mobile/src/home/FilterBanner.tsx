/** The short banner over a list a home tile opened: "New leads · 4" and an × that clears the filter. No developer wording. */
import React from 'react'
import { Pressable, View } from 'react-native'
import { DText, Icon, useDesign, MIN_TARGET, radius, space } from '../design'

export function FilterBanner({ label, count, onClear }: { label: string; count?: number; onClear: () => void }) {
  const { c } = useDesign()
  const text = count == null ? label : `${label} · ${count}`
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.accentSoft, borderRadius: radius.pill, paddingLeft: space[4], minHeight: MIN_TARGET, alignSelf: 'flex-start' }}>
      <DText variant="bodyStrong" tone="accentText">{text}</DText>
      <Pressable accessibilityRole="button" accessibilityLabel={`Clear filter: ${label}`} onPress={onClear}
        style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={20} tone="accent" />
      </Pressable>
    </View>
  )
}
