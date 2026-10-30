// What the demo's browser tests share: the built demo (built here if it is not), served as the real host serves it.
import fs from 'node:fs'
import path from 'node:path'
import { DEMO_DIST, serveDemo } from '../../demo/serve.ts'

export function ensureBuilt() {
  if (fs.existsSync(path.join(DEMO_DIST, 'app.html')) && !process.env.REBUILD_DEMO) return
  const run = Bun.spawnSync([process.execPath, 'run', 'build:demo'], { cwd: path.resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(`build:demo failed\n${run.stdout.toString()}${run.stderr.toString()}`)
}

export function startHost() {
  ensureBuilt()
  const server = serveDemo(DEMO_DIST, 0)
  return { server, base: `http://localhost:${server.port}` }
}

/** Every file of the build, as [relative path, bytes] — text or not. */
export function* builtFiles(dir = DEMO_DIST, prefix = ''): Generator<[string, Buffer]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) yield* builtFiles(path.join(dir, entry.name), rel)
    else yield [rel, fs.readFileSync(path.join(dir, entry.name))]
  }
}
