// Boots the real unified app on an in-memory database, with the built admin screens, so a screen can be looked at in a
// browser (Playwright). Not a test and not a deploy: nothing is sent anywhere.
//   cd apps/unified && bun run build:web && bun ../../docs/claims-true/tools/serve.ts [vertical] [port]
// Signs in as owner@test.example / Correct-horse-1 (manager@test.example / Manager-pass-1).
import path from 'node:path'
import { bootTenant, seedOwner } from '../../../apps/unified/tests/harness.ts'

const vertical = process.argv[2] || 'contractor'
const port = Number(process.argv[3] || 4310)
const dist = path.resolve(import.meta.dir, '../../../apps/unified/web/dist')
const t = await bootTenant({ adminDist: dist, vertical })
const s = await seedOwner(t)
await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId: s.company.id } as any)
await t.db.update(t.schema.company).set({ onboardingCompleted: true } as any).catch(() => {})
// A little business to export.
await t.db.insert(t.schema.contact).values([
  { companyId: s.company.id, name: 'Ann Able', email: 'ann@example.com', type: 'client' },
  { companyId: s.company.id, name: 'Bo Baker', email: 'bo@example.com', type: 'client' },
] as any)
const extra = process.argv[5] ? await import(path.resolve(process.argv[5])) : null
if (extra?.seed) await extra.seed(t, s)
Bun.serve({ port, fetch: (req) => t.app.fetch(req) })
console.log(`serving ${vertical} on http://localhost:${port}`)
