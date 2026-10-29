/** One row of a trade-kit list (a client chart, an event file, an order …). */
import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { TradeDetail } from '../../../../src/trades/TradeDetail'

export default function TradeDetailRoute() {
  const { spec, id } = useLocalSearchParams<{ spec: string; id: string }>()
  return <TradeDetail spec={String(spec)} rowId={String(id)} />
}
