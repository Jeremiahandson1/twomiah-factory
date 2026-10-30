// Records the demo's data from the real server, per trade (demo/record.ts), and writes demo/public/demo-data/<trade>.json.
//
//   cd apps/unified && bun scripts/record-demo.ts              every trade
//   cd apps/unified && bun scripts/record-demo.ts salon store  those trades
import { DEMO_TRADES } from '../demo/trades.ts'
import { readManifest, recordTrade, writeData } from '../demo/record.ts'

const only = process.argv.slice(2)
const trades = DEMO_TRADES.filter((t) => !only.length || only.includes(t.id))
if (!trades.length) { console.error(`No such trade. Trades: ${DEMO_TRADES.map((t) => t.id).join(', ')}`); process.exit(2) }

for (const trade of trades) {
  const manifest = readManifest(trade)
  if (!manifest) { console.error(`${trade.id}: no demo/routes/${trade.id}.json yet — run scripts/discover-demo-routes.ts ${trade.id} first`); process.exit(1) }
  const started = Date.now()
  const data = await recordTrade(trade, manifest)
  writeData(data)
  console.log(`${trade.id}: ${Object.keys(data.responses).length} answers recorded (${((Date.now() - started) / 1000).toFixed(1)}s)`)
}
process.exit(0)
