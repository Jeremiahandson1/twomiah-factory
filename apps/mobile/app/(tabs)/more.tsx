/**
 * More — every item the desktop's menu gives THIS seat in THIS business (src/more/menu.ts, generated from the desktop's own menu
 * definitions), grouped and searchable. A row with a phone screen opens it; every other row opens the real desktop page inside the
 * app, already signed in (app/(details)/web.tsx).
 */
import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/auth/AuthContext'
import { isFieldRole } from '../../src/auth/roles'
import { useVertical } from '../../src/vertical/VerticalContext'
import { itemsFor, sectionsFor, type Shown } from '../../src/more/menu'
import { Screen, Group, ListRow, SectionHeader, SearchField, EmptyState, Button, layout, space } from '../../src/design'

export default function MoreScreen() {
  const router = useRouter()
  const { user, can, logout } = useAuth()
  const { vertical, hasFeature } = useVertical()
  const [search, setSearch] = useState('')
  const field = isFieldRole(user?.role)
  const items = useMemo(() => itemsFor(vertical, { role: user?.role, can, hasFeature }, field), [vertical, user?.role, can, hasFeature, field])
  const sections = useMemo(() => sectionsFor(items, search), [items, search])

  const open = (i: Shown) => {
    if (i.open.kind === 'native') router.push(i.open.route as any)
    else router.push({ pathname: '/(details)/web', params: { path: i.open.path, title: i.label } } as any)
  }

  return (
    <Screen title="More">
      <View style={{ gap: layout.sectionGap }}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search the menu" label="Search the menu" />
        {sections.length === 0 ? <EmptyState icon="search" title="Nothing matches" body="Try a shorter word." /> : sections.map((s) => (
          <View key={s.group}>
            <SectionHeader title={s.group} />
            <Group>
              {s.items.map((i, n) => (
                <ListRow key={i.path + i.label} icon={i.icon} title={i.label} divider={n < s.items.length - 1} onPress={() => open(i)}
                  meta={i.open.kind === 'web' ? 'Opens the full page' : undefined} />
              ))}
            </Group>
          </View>
        ))}
        {!search ? <Button label="Sign out" variant="secondary" icon="log-out" onPress={() => logout()} /> : null}
      </View>
    </Screen>
  )
}
