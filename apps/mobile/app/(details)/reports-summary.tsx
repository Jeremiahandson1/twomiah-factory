/**
 * Reports on the phone: a summary, not the desktop's report pages (owner 10/30, Tier 2 — "today, this week, money owed").
 * The figures are the desktop Reports page's own: GET /api/reports/dashboard?startDate&endDate (reports:read), asked for
 * today and for the last seven days — a plain YYYY-MM-DD is the business's own day on the server (parseRange). Its revenue
 * block: invoiced, collected, outstanding (+count), overdue (+count); jobs when the business has them. The full reports, by
 * month and by customer, stay on the desktop ("Open full reports").
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { get } from '../../src/api/client'
import { Screen, Card, Group, ListRow, SectionHeader, DText, Button, EmptyState, SkeletonRows, space } from '../../src/design'

const money = (v: unknown) => `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ReportsSummary() {
  const router = useRouter()
  const [today, setToday] = useState<any>(null)
  const [week, setWeek] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const now = new Date()
    const day = ymd(now), weekStart = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
    const [a, b] = await Promise.all([
      get(`/api/reports/dashboard?startDate=${day}&endDate=${day}`),
      get(`/api/reports/dashboard?startDate=${weekStart}&endDate=${day}`),
    ])
    if (a.ok && b.ok) { setToday(a.data); setWeek(b.data); setError('') } else setError((a.ok ? b : a).error || 'Could not load the reports')
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const owed = week?.revenue
  const block = (title: string, d: any) => (
    <View>
      <SectionHeader title={title} />
      <Group>
        <ListRow title="Invoiced" subtitle={d?.revenue?.invoiceCount != null ? `${d.revenue.invoiceCount} invoice${d.revenue.invoiceCount === 1 ? '' : 's'}` : undefined} meta={money(d?.revenue?.invoiced)} />
        <ListRow title="Collected" meta={money(d?.revenue?.collected)} divider={!!d?.jobs} />
        {d?.jobs ? <ListRow title="Jobs completed" meta={String(d.jobs.completed ?? 0)} divider={false} /> : null}
      </Group>
    </View>
  )

  return (
    <Screen title="Reports" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
      footer={<Button label="Open full reports" variant="secondary" fullWidth onPress={() => router.push({ pathname: '/(details)/web', params: { path: '/crm/reports', title: 'Reports' } } as any)} />}>
      {loading ? <SkeletonRows count={6} /> : error ? <EmptyState icon="alert-circle" title="Could not load the reports" body={error} action="Try again" onAction={load} /> : (
        <View style={{ gap: space[4] }}>
          <Card>
            <DText variant="callout" tone="textSecondary">Owed to you now</DText>
            <DText variant="stat">{money(owed?.outstanding)}</DText>
            <DText variant="callout" tone={Number(owed?.overdueCount) > 0 ? 'danger' : 'textSecondary'}>
              {`${owed?.outstandingCount ?? 0} unpaid · ${owed?.overdueCount ?? 0} overdue (${money(owed?.overdue)})`}
            </DText>
          </Card>
          {block('Today', today)}
          {block('Last 7 days', week)}
        </View>
      )}
    </Screen>
  )
}
