import React from 'react'
import { View } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { radius, space } from '../tokens'
import type { ToneName } from '../colors'

/** A status pill: soft tint, tone-coloured words, and (optionally) an icon — status is never colour alone. */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: ToneName; icon?: string }) {
  const { c } = useDesign()
  const t = c.tones[tone]
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start', backgroundColor: t.soft, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: space[1] }}>
      {icon ? <Icon name={icon} size={13} tone={tone} /> : null}
      <DText variant="captionStrong" style={{ color: t.fg }}>{label}</DText>
    </View>
  )
}
