/** Invoices — opened from "Open invoices" / "Outstanding" it lists exactly the invoices still owed (GET /api/invoices?tile=open). */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button, ChipRow, Chip, space } from '../../src/design'
import { invoiceStatusLabel } from '../../src/home/labels'
import { useList } from '../../src/home/useList'
import { useTile } from '../../src/home/useTile'
import { FilterBanner } from '../../src/home/FilterBanner'
import { reqUrl } from '../../src/home/tiles'
import { useVertical } from '../../src/vertical/VerticalContext'

const money = (v: unknown) => `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STATUSES: ReadonlyArray<readonly [string, string]> = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['overdue', 'Overdue']]
/** A tab still running (a salon visit, a bar tab, a restaurant check) — the desktop's extraInvoiceStatuses for these trades
 *  (apps/unified/verticals/{salon,bar,restaurant}/settings.ts), placed after All as it does. */
const OPEN_TRADES = ['salon', 'bar', 'restaurant']

export default function InvoicesScreen() {
  const router = useRouter()
  const { vertical } = useVertical()
  const statuses = OPEN_TRADES.includes(String(vertical)) ? [STATUSES[0], ['open', 'Open'] as const, ...STATUSES.slice(1)] : STATUSES
  const { tile, clear } = useTile()
  const [status, setStatus] = useState('')
  const url = tile ? reqUrl(tile.list) : (status ? '/api/invoices?status=' + status : '/api/invoices')
  const { rows, total, loading, error, refresh, loadMore } = useList(url)
  const [refreshing, setRefreshing] = useState(false)
  return (
    <Screen title="Invoices" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}>
      <View style={{ gap: space[3] }}>
        {tile ? <FilterBanner label={tile.banner} count={total} onClear={clear} /> : (
          <ChipRow>{statuses.map(([k, l]) => <Chip key={k} label={l} selected={status === k} onPress={() => setStatus(k)} />)}</ChipRow>
        )}
        {loading ? <SkeletonRows count={5} /> : error ? <EmptyState icon="alert-circle" title="Could not load invoices" body={error} action="Try again" onAction={refresh} />
          : rows.length === 0 ? <EmptyState icon="receipt" title="No invoices here" body={tile ? 'Nothing is owed right now.' : 'No invoices match this filter.'} />
          : <Group>{rows.map((r, i) => (
            <ListRow key={r.id} title={r.number || 'Invoice'} subtitle={r.contact?.name} meta={Number(r.balance) > 0 ? `${money(r.balance)} owed` : money(r.total)}
              badge={invoiceStatusLabel(r.status)} divider={i < rows.length - 1} onPress={() => router.push(`/(details)/invoice/${r.id}` as any)} />
          ))}</Group>}
        {!loading && total != null && rows.length < total ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
    </Screen>
  )
}
