// Prints the menu a business of one vertical is shown, as the page builds it (web/src/shell.ts reads `document` on
// import, so a test runs this in a child process, as scripts/check-unified-feature-has-screen.ts does).
// Usage: bun run tests/support/menu-child.ts <vertical>
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { getAdvertisableFeaturesForTemplate } from '../../../../packages/tenant-backend/src/featureRegistry.ts'

const UNIFIED = join(import.meta.dir, '../..')
const v = process.argv[2]
const s: any = (await import(join(UNIFIED, 'verticals', v, 'settings.ts'))).default
const w: any = new Window({ url: 'https://tenant.test/crm' })
w.document.body.innerHTML = `<script type="application/json" id="vertical-screens">${JSON.stringify(s.screens || {}).replace(/</g, '\\u003c')}</script>`
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'getComputedStyle']) (globalThis as any)[k] = k === 'window' ? w : w[k]
const shell = await import(join(UNIFIED, 'web/src/shell.ts'))
const offered = new Set(getAdvertisableFeaturesForTemplate(s.featureSet).map((d) => d.id))
const shown = shell.SHELL_HERE.nav
  .filter((i: any) => !i.features || i.features.some((f: string) => offered.has(f)))
  .map((i: any) => ({ to: i.to, section: i.section ?? null, label: i.label }))
process.stdout.write('\n@@MENU@@' + JSON.stringify({ collapsible: shell.SHELL_HERE.collapsibleSections === true, shown }) + '\n')
