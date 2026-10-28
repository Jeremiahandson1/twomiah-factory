import React from 'react'
import { TextInput, View, type KeyboardTypeOptions } from 'react-native'
import { useDesign } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { MAX_FONT_SCALE, radius, space, type as t } from '../tokens'

/**
 * A form field: the label sits ABOVE the box (a placeholder is not a label), the box is at least 48 points, the edge reads at 3:1,
 * and an error is a sentence with an icon under the field — never just a red border.
 */
export function TextField({ label, value, onChangeText, placeholder, helper, error, multiline, keyboardType, prefix, required }: {
  label: string; value: string; onChangeText?: (s: string) => void; placeholder?: string; helper?: string; error?: string; multiline?: boolean
  keyboardType?: KeyboardTypeOptions; prefix?: string; required?: boolean
}) {
  const { c } = useDesign()
  return (
    <View style={{ gap: space[1] }}>
      <DText variant="captionStrong" tone="textSecondary">{label}{required ? ' (required)' : ''}</DText>
      <View style={{ flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', minHeight: multiline ? 96 : 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: error ? c.danger : c.borderStrong, backgroundColor: c.surface, paddingHorizontal: space[3] }}>
        {prefix ? <DText variant="body" tone="textSecondary" style={{ marginRight: space[1] }}>{prefix}</DText> : null}
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.textSubtle} multiline={multiline} keyboardType={keyboardType} maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{ flex: 1, color: c.text, fontSize: t.body.size, minHeight: multiline ? 88 : 46, paddingVertical: space[2], textAlignVertical: multiline ? 'top' : 'center' }} />
      </View>
      {error ? <View style={{ flexDirection: 'row', gap: space[1], alignItems: 'center' }}><Icon name="alert-circle" size={16} tone="danger" /><DText variant="caption" tone="danger" style={{ flex: 1 }}>{error}</DText></View>
        : helper ? <DText variant="caption" tone="textSubtle">{helper}</DText> : null}
    </View>
  )
}
