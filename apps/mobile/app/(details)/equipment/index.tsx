import React from 'react'
import { TradeList } from '../../../src/trades/TradeList'

/** Equipment, opened from More where barcode scanning is on (src/trades/stock.ts) — search or scan a unit's serial number. */
export default function Screen() { return <TradeList spec="equipment-units" /> }
