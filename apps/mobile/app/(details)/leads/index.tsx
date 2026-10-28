/**
 * Leads — the enquiries. Opened from the New leads tile it lists exactly the rows that tile counts (GET /api/dashboard/new-leads);
 * otherwise it is the inbox (GET /api/leads) filtered by the server's own statuses: new, contacted, converted, dismissed.
 * Call / text / email open the phone's own apps.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../../src/auth/AuthContext'
import { Screen, ListRow, Group, ChipRow, Chip, SearchField, EmptyState, SkeletonRows, Button, space, Icon } from '../../../src/design'
import { useList } from '../../../src/home/useList'
import { useTile } from '../../../src/home/useTile'
import { FilterBanner } from '../../../src/home/FilterBanner'
import { callPhone, textPhone, emailTo } from '../../../src/home/phoneActions'
import { reqUrl } from '../../../src/home/tiles'
import { useDebounce } from '../../../src/hooks/useDebounce'

export const LEAD_STATUS_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', converted: 'Converted', dismissed: 'Dismissed' }
const STATUS_TONE: Record<string, any> = { new: 'info', contacted: 'warning', converted: 'success', dismissed: 'neutral' }

export default function LeadsScreen() {
  const router = useRouter()
  const { can } = useAuth()
  const { tile, clear } = useTile()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const inbox = !tile
  const url = tile ? reqUrl(tile.list) : `/api/leads?${new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { search: q.trim() } : {}) })}`
  const { rows, total, loading, error, refresh, loadMore } = useList(url)
  const [refreshing, setRefreshing] = useState(false)

  return (
    <Screen title="Leads" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}>
      <View style={{ gap: space[3] }}>
        {tile ? <FilterBanner label={tile.banner} count={total} onClear={clear} /> : (
          <>
            <SearchField value={search} onChangeText={setSearch} placeholder="Search leads" />
            <ChipRow>
              <Chip label="All" selected={!status} onPress={() => setStatus('')} />
              {Object.entries(LEAD_STATUS_LABEL).map(([k, l]) => <Chip key={k} label={l} selected={status === k} onPress={() => setStatus(k)} />)}
            </ChipRow>
          </>
        )}
        {loading ? <SkeletonRows count={5} /> : error ? <EmptyState icon="alert-circle" title="Could not load leads" body={error} action="Try again" onAction={refresh} /> : rows.length === 0 ? (
          <EmptyState icon="person-add" title="No leads here" body={tile ? 'Nothing is waiting on a reply.' : 'No leads match this filter.'} />
        ) : (
          <Group>
            {rows.map((r, i) => {
              const name = r.homeownerName || r.name || 'Unnamed'
              const status = r.status || undefined
              const isContact = r.kind === 'contact'
              return (
                <View key={`${r.kind || 'lead'}-${r.id}`}>
                  <ListRow title={name} subtitle={[r.jobType, r.location || r.source || r.sourcePlatform].filter(Boolean).join(' · ') || undefined}
                    badge={status ? LEAD_STATUS_LABEL[status] || status : undefined} badgeTone={status ? STATUS_TONE[status] : undefined}
                    divider={false}
                    onPress={() => router.push((isContact ? `/(details)/contact/${r.id}` : `/(details)/leads/${r.id}`) as any)} />
                  {(r.phone || r.email) ? (
                    <View style={{ flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingBottom: space[3] }}>
                      {r.phone ? <Button size="md" variant="tonal" icon="call" label="Call" accessibilityHint={`Calls ${name}`} onPress={() => callPhone(r.phone)} /> : null}
                      {r.phone ? <Button size="md" variant="tonal" icon="chatbubble" label="Text" accessibilityHint={`Texts ${name}`} onPress={() => textPhone(r.phone)} /> : null}
                      {r.email ? <Button size="md" variant="tonal" icon="mail" label="Email" accessibilityHint={`Emails ${name}`} onPress={() => emailTo(r.email)} /> : null}
                    </View>
                  ) : null}
                  {i < rows.length - 1 ? <View style={{ height: 1, backgroundColor: 'rgba(128,128,128,0.2)' }} /> : null}
                </View>
              )
            })}
          </Group>
        )}
        {!loading && rows.length > 0 && rows.length < (total ?? 0) ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
    </Screen>
  )
}
