/**
 * My points and rewards (care_pickup_rewards): the balance, how points are earned, the rewards the agency set, and what has been asked for.
 *   GET  /api/care-rewards/me      { balance, rules, history, rewards, requests }
 *   POST /api/care-rewards/redeem  { rewardId } — points are held at once; the office hands the reward over (or declines and they come back)
 * Asking for a reward spends points, so it needs signal and is never kept for later: a second tap while waiting could spend them twice.
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { careGet, carePost } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, SectionTitle } from '../../src/care/ui'
import { formatYmdShort } from '../../src/care/time'
import { rewardAffordText } from '../../src/care/rules'

export default function RewardsScreen() {
  const t = useTheme()
  const toast = useToast()
  const [me, setMe] = useState<any | null>(null)
  const [failed, setFailed] = useState(false)
  const [sure, setSure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await careGet<any>('/api/care-rewards/me')
    if (r.ok && r.data) { setMe(r.data); setFailed(false) } else setFailed(true)
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const ask = async (id: string) => {
    setBusy(id); setProblem(null)
    const r = await carePost('/api/care-rewards/redeem', { rewardId: id })
    setBusy(null); setSure(null)
    if (!r.ok) { setProblem(r.status === 0 ? 'No signal — try again when you have a connection. Your points were not spent.' : r.error || 'That could not be done. Try again.'); load(); return }
    toast.success('Asked for. The office will give it to you.')
    load()
  }

  const rules = me?.rules
  return (
    <CareScreen onRefresh={load}>
      {failed && !me && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Your points didn't load. Tap to try again.</Banner>}
      {me && (
        <>
          <Card>
            <Text style={[styles.big, { color: t.text }]}>{me.balance} points</Text>
            {rules?.enabled ? (
              <Text style={[styles.meta, { color: t.textSecondary }]}>
                {[rules.pointsPerExtraShift > 0 && `${rules.pointsPerExtraShift} for each extra shift you pick up and work`, rules.pointsPerOnTime > 0 && `${rules.pointsPerOnTime} for each visit you clock in on time`,
                  rules.minHoursPerWeek > 0 && rules.pointsForMinHours > 0 && `${rules.pointsForMinHours} for a week of ${rules.minHoursPerWeek}+ hours`].filter(Boolean).join(' · ') || 'Your agency has not set what earns points yet.'}
              </Text>
            ) : <Text style={[styles.meta, { color: t.textSecondary }]}>Your agency has not started earning points yet.</Text>}
          </Card>
          {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}

          <SectionTitle>Rewards</SectionTitle>
          {me.rewards.length === 0 ? <Text style={[styles.meta, { color: t.textSecondary }]}>No rewards have been set up yet.</Text> : me.rewards.map((r: any) => (
            <Card key={r.id}>
              <Text style={[styles.title, { color: t.text }]}>{r.name}</Text>
              {r.description ? <Text style={[styles.meta, { color: t.textSecondary }]}>{r.description}</Text> : null}
              <Text style={[styles.meta, { color: t.text }]}>{rewardAffordText(me.balance, r.costPoints)}</Text>
              {sure === r.id ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={[styles.meta, { color: t.text }]}>Use {r.costPoints} points for “{r.name}”?</Text>
                  <View style={styles.row}>
                    <Button small label="Yes, ask for it" loading={busy === r.id} onPress={() => ask(r.id)} />
                    <Button small variant="secondary" label="Not now" disabled={!!busy} onPress={() => setSure(null)} />
                  </View>
                </View>
              ) : <Button style={{ marginTop: 10 }} small label="Ask for this" icon="gift-outline" disabled={!r.canAfford || !!busy} onPress={() => { setSure(r.id); setProblem(null) }} />}
            </Card>
          ))}

          {me.requests.length > 0 && (
            <>
              <SectionTitle>What I asked for</SectionTitle>
              {me.requests.map((q: any) => (
                <Card key={q.id}>
                  <Text style={[styles.title, { color: t.text }]}>{q.name} · {q.points} points</Text>
                  <Text style={[styles.meta, { color: t.textSecondary }]}>{q.statusLabel}{q.handledNote ? ` — ${q.handledNote}` : ''}</Text>
                </Card>
              ))}
            </>
          )}

          <SectionTitle>How I earned them</SectionTitle>
          {me.history.length === 0 ? <Text style={[styles.meta, { color: t.textSecondary }]}>Nothing yet. Pick up an open shift or clock in on time.</Text> : me.history.map((h: any) => (
            <View key={h.id} style={styles.line}>
              <Text style={[styles.meta, { color: t.text, flex: 1 }]}>{h.label}{h.note ? ` — ${h.note}` : ''}</Text>
              <Text style={[styles.meta, { color: h.points < 0 ? t.textSecondary : t.text, fontWeight: '700' }]}>{h.points > 0 ? `+${h.points}` : h.points}</Text>
              <Text style={[styles.meta, { color: t.textSecondary, marginLeft: 8 }]}>{formatYmdShort(String(h.createdAt).slice(0, 10))}</Text>
            </View>
          ))}
        </>
      )}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  big: { fontSize: 28, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
})
