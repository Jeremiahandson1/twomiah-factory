/**
 * My clients — the caregiver's own clients (GET /api/clients is scoped server-side to clients on the
 * caregiver's schedule or assigned to them). Tap for address, care plan and upcoming visits.
 */
import React from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { CareScreen, fullAddress } from '../../src/care/screen'
import { Banner, Card } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { formatTime12, formatYmdShort } from '../../src/care/time'

export default function ClientsScreen() {
  const t = useTheme()
  const router = useRouter()
  const care = useCare()
  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      {care.loadFailed && <Banner tone="warning" icon="cloud-offline-outline" onPress={() => care.reload()}>Showing names saved on this phone. Tap to try again.</Banner>}
      {care.clients.length === 0 && <EmptyState icon="people-outline" title="No clients yet" subtitle="Clients on your schedule appear here." />}
      {care.clients.map((c) => {
        const next = care.visits.find((v) => v.clientId === c.id)
        return (
          <Card key={c.id} onPress={() => router.push(`/(care)/client/${c.id}` as any)}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.text }]}>{`${c.firstName || ''} ${c.lastName || ''}`.trim()}</Text>
                {fullAddress(c) ? <Text style={[styles.meta, { color: t.textSecondary }]}>{fullAddress(c)}</Text> : null}
                {next ? <Text style={[styles.meta, { color: t.text }]}>Next visit {next.date === care.today ? 'today' : formatYmdShort(next.date)} at {formatTime12(next.startTime)}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
            </View>
          </Card>
        )
      })}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 17, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 3 },
})
