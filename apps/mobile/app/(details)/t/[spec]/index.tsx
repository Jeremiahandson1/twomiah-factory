/** A trade-kit list opened from a home tile or a More row: `spec` names the screen, `tile` (if any) the tile whose list it is. */
import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTile } from '../../../../src/home/useTile'
import { TradeList } from '../../../../src/trades/TradeList'

export default function TradeListRoute() {
  const { spec, tile: _tile, ...rest } = useLocalSearchParams<Record<string, string>>()
  // Anything else in the address is the list's own filter (a project's daily logs: ?projectId=…), passed to the list as-is.
  const params = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v === 'string' && v)) as Record<string, string>
  const { tile, clear } = useTile()
  const router = useRouter()
  return <TradeList spec={String(spec)} params={Object.keys(params).length ? params : undefined} from={tile?.list} banner={tile ? { label: tile.banner, onClear: () => { clear(); router.back() } } : undefined} />
}
