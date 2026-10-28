import React, { useState } from 'react'
import { View } from 'react-native'
import { Screen, SearchField, SectionHeader, Group, ListRow, DText, BottomBar, Badge, Card, space, useDesign } from '..'
import { MORE_GROUPS, MORE_OWNER, MORE_STAFF, type MoreItem } from './moreData'
import { barFor } from './homes'
import { COMPANY, PERSON, type Seat } from './sample'

/**
 * The More screen: the same menu the desktop shows this seat, grouped by what the person is doing (Sell, Work, Projects, …) not by the
 * desktop's long "Business" list. Search finds any item. A row with a chevron is a phone screen; a row with the "open" arrow opens the
 * real desktop page inside the app, signed in, until that page is built natively.
 */
export function MorePreview({ seat }: { seat: Seat }) {
  const { c } = useDesign()
  const [q, setQ] = useState('')
  const all: MoreItem[] = seat === 'owner' ? MORE_OWNER : MORE_STAFF
  const items = q ? all.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : all
  const native = all.filter((i) => i.kind === 'native').length
  return (
    <Screen title="More" subtitle={`${PERSON[seat]} · ${COMPANY.contractor} · ${all.length} pages`} bottomBar={<BottomBar items={barFor('contractor', seat)} active="more" />}
      actions={[{ icon: 'settings-outline', label: 'Settings' }]}>
      <SearchField value={q} onChangeText={setQ} placeholder="Search all pages" />
      <DText variant="caption" tone="textSubtle">{native} open as phone screens. The rest open the same page you use on your computer, inside the app.</DText>
      {MORE_GROUPS.map((g) => {
        const rows = items.filter((i) => i.group === g)
        if (!rows.length) return null
        return (
          <View key={g}>
            <SectionHeader title={`${g}  ·  ${rows.length}`} />
            <Group>{rows.map((r, i) => (
              <ListRow key={r.path} title={r.label} icon={r.icon} iconTone={r.kind === 'native' ? 'accent' : 'neutral'} onPress={() => {}} divider={i < rows.length - 1}
                badge={r.kind === 'web' ? 'Web page' : undefined} />
            ))}</Group>
          </View>
        )
      })}
    </Screen>
  )
}
