/**
 * A client, as the caregiver needs them at the door:
 *   GET /api/clients/:id          address, phone, allergies, assistance needs (server-scoped: own clients only)
 *   GET /api/care-plans?clientId  the care plan summary (goals, instructions, precautions, notes)
 * plus the caregiver's upcoming visits with them and, for a client in Sandata, the Medicaid ID.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../../../src/theme/ThemeContext'
import { useCare } from '../../../src/care/CareContext'
import { careGet, asList } from '../../../src/care/careApi'
import { CareScreen, callNumber, fullAddress, openDirections } from '../../../src/care/screen'
import { Banner, Button, Card, KeyValue, SectionTitle } from '../../../src/care/ui'
import { SandataIdBox } from '../../../src/care/components/Sandata'
import { formatTime12, formatYmdShort } from '../../../src/care/time'
import { SkeletonList } from '../../../src/components/SkeletonLoader'

const PLAN_FIELDS: [string, string][] = [
  ['serviceType', 'Service'], ['frequency', 'How often'], ['serviceDescription', 'What we do'], ['careGoals', 'Care goals'],
  ['specialInstructions', 'Special instructions'], ['precautions', 'Precautions'], ['medicationNotes', 'Medication notes'],
  ['mobilityNotes', 'Mobility'], ['dietaryNotes', 'Diet'], ['communicationNotes', 'Communication'],
]

export default function ClientScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const care = useCare()
  const [client, setClient] = useState<any>(care.clientById(id))
  const [plan, setPlan] = useState<any>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'failed' | 'notfound'>('loading')

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([careGet(`/api/clients/${id}`), careGet(`/api/care-plans?clientId=${encodeURIComponent(String(id))}`)])
    if (c.ok && c.data?.id) { setClient(c.data); setState('ok') } else setState(c.status === 404 ? 'notfound' : care.clientById(id) ? 'ok' : 'failed')
    if (p.ok) {
      // The CRM decides which plan is current (isActive: status Active and inside its dates — the
      // office's and the family portal's rule). A draft is never shown as the plan to follow.
      const plans = asList(p.data)
      setPlan(plans.find((x: any) => x.isActive === true) || null)
    }
  }, [id, care.clientById])
  useEffect(() => { load() }, [load])

  const name = client ? `${client.first_name || ''} ${client.last_name || ''}`.trim() : care.clientName(id)
  const addr = fullAddress(client)
  const upcoming = care.visits.filter((v) => v.clientId === id).slice(0, 6)

  if (state === 'loading' && !client) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={3} /></View>

  return (
    <CareScreen onRefresh={load}>
      <Stack.Screen options={{ title: name || 'Client' }} />
      {state === 'failed' && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Couldn't load this client. Tap to try again.</Banner>}
      {state === 'notfound' && <Banner tone="danger" icon="lock-closed-outline">This client isn't on your schedule.</Banner>}
      <Card>
        <Text style={[styles.name, { color: t.text }]}>{name}</Text>
        {addr ? <Text style={[styles.addr, { color: t.textSecondary }]}>{addr}</Text> : null}
        <View style={styles.actions}>
          {addr ? <Button small icon="navigate" label="Directions" onPress={() => openDirections(addr)} /> : null}
          {client?.phone ? <Button small variant="secondary" icon="call" label="Call" onPress={() => callNumber(client.phone)} /> : null}
          <Button small variant="secondary" icon="play-circle" label="Clock in here" onPress={() => router.push({ pathname: '/(tabs)/time-clock', params: { clientId: String(id) } } as any)} />
        </View>
        <SandataIdBox client={care.sandataClient(id)} />
      </Card>

      {(client?.allergies || client?.assistance_needs || client?.service_type) && (
        <Card>
          {client?.allergies ? <Banner tone="danger" icon="medkit-outline" title="Allergies">{String(client.allergies)}</Banner> : null}
          <KeyValue label="Assistance needs" value={client?.assistance_needs} />
          <KeyValue label="Service" value={client?.service_type} />
        </Card>
      )}

      <SectionTitle>Care plan</SectionTitle>
      {plan ? (
        <Card>
          {PLAN_FIELDS.map(([k, label]) => <KeyValue key={k} label={label} value={plan[k] ? String(plan[k]) : null} />)}
          {plan.updatedAt ? <Text style={[styles.meta, { color: t.textSecondary }]}>Plan updated {formatYmdShort(String(plan.updatedAt).slice(0, 10))}</Text> : null}
        </Card>
      ) : (
        <Text style={[styles.meta, { color: t.textSecondary, marginBottom: 12 }]}>No active care plan on file. Ask the office if you need instructions for this client.</Text>
      )}

      <SectionTitle>Your upcoming visits</SectionTitle>
      {upcoming.length === 0
        ? <Text style={[styles.meta, { color: t.textSecondary }]}>No visits with this client in the next two weeks.</Text>
        : upcoming.map((v) => (
          <Card key={v.key}>
            <Text style={[styles.visit, { color: t.text }]}>{formatYmdShort(v.date)} · {formatTime12(v.startTime)} – {formatTime12(v.endTime)}</Text>
            {v.notes ? <Text style={[styles.meta, { color: t.textSecondary }]}>{v.notes}</Text> : null}
          </Card>
        ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '800' },
  addr: { fontSize: 15, marginTop: 4, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  meta: { fontSize: 14, lineHeight: 20 },
  visit: { fontSize: 15, fontWeight: '700' },
})
