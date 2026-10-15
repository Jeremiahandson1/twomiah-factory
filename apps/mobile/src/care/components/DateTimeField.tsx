/**
 * A date or time field on @react-native-community/datetimepicker (already a dependency): a button
 * showing the value; Android opens the system dialog, iOS shows the spinner inline with Done.
 * Values are 'YYYY-MM-DD' for dates and 'HH:MM' for times.
 */
import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../theme/ThemeContext'
import { formatTime12, formatYmdLong, pad2, ymdOf } from '../time'
import { Button } from '../ui'

export function DateTimeField({ label, mode, value, onChange, minimumDate, maximumDate }: {
  label: string; mode: 'date' | 'time'; value: string; onChange: (v: string) => void; minimumDate?: Date; maximumDate?: Date
}) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const asDate = (() => {
    if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12) }
    if (mode === 'time' && /^\d{1,2}:\d{2}/.test(value)) { const [h, m] = value.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d }
    return new Date()
  })()
  const handle = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setOpen(false)
    if (e.type !== 'set' || !d) return
    onChange(mode === 'date' ? ymdOf(d) : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
  }
  const shown = value ? (mode === 'date' ? formatYmdLong(value) : formatTime12(value)) : 'Choose…'
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={[styles.box, { borderColor: t.border, backgroundColor: t.surface }]} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}`}>
        <Ionicons name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={18} color={t.textSecondary} />
        <Text style={[styles.value, { color: value ? t.text : t.textSecondary }]}>{shown}</Text>
      </TouchableOpacity>
      {open && (
        <View>
          <DateTimePicker
            value={asDate}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handle}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            themeVariant={t.isDark ? 'dark' : 'light'}
            minuteInterval={mode === 'time' ? 5 : undefined}
          />
          {Platform.OS === 'ios' && <Button small label="Done" onPress={() => { if (!value) onChange(mode === 'date' ? ymdOf(asDate) : `${pad2(asDate.getHours())}:${pad2(asDate.getMinutes())}`); setOpen(false) }} />}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 13 },
  value: { fontSize: 16 },
})
