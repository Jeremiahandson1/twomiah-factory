// Which unified app this tenant runs: the engine commit the Factory built its repo from, written to apps/unified/VERSION
// when it builds the repo (apps/api/src/unified/tree.ts). Absent outside a tenant repo.
import fs from 'node:fs'
import path from 'node:path'

function read(): string | null {
  try { return fs.readFileSync(path.join(import.meta.dir, '..', '..', 'VERSION'), 'utf8').trim() || null } catch { return null }
}

export const APP_VERSION = read()
