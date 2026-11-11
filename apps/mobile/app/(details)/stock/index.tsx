import React from 'react'
import { TradeList } from '../../../src/trades/TradeList'

/** Parity tier 2 #10: Stock, opened from More where barcode scanning is on (src/trades/stock.ts) — search or scan a part. */
export default function Screen() { return <TradeList spec="stock-parts" /> }
