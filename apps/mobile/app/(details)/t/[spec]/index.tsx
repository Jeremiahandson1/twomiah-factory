/** A trade-kit list opened from a home tile or a More row: `spec` names the screen, `tile` (if any) the tile whose list it is. */
import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTile } from '../../../../src/home/useTile'
import { TradeList } from '../../../../src/trades/TradeList'

export default function TradeListRoute() {
  const { spec } = useLocalSearchParams<{ spec: string }>()
  const { tile, clear } = useTile()
  const router = useRouter()
  return <TradeList spec={String(spec)} banner={tile ? { label: tile.banner, onClear: () => { clear(); router.back() } } : undefined} />
}
