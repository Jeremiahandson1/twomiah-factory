/**
 * A unified tenant's repo: the unified app and the shared packages it imports, laid out exactly as they are tested
 * in the monorepo (apps/unified beside packages/*, a small workspace). Nothing about the business is written into it —
 * its facts go into its database (POST /api/internal/provision) and its settings onto its service — so every tenant's
 * repo at one version is the same code, and Update Code is the same push for all of them.
 *
 * The lockfile is the monorepo's, cut down to this workspace: the tenant installs the versions the checks ran against.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * The monorepo packages the unified app depends on — every `workspace:` dependency in apps/unified/package.json, and
 * theirs in turn — as directory names under packages/. Read from the manifests, never listed by hand: a fixed list
 * (tenant-backend, tenant-ui) missed @twomiah/roof-core when roofing came in, and every tenant's install then failed
 * (found by a dry run before the first Render build, 2026-10-19).
 */
export function workspacePackages(root: string): string[] {
  const byName = new Map<string, string>()
  const pkgsDir = path.join(root, 'packages')
  for (const d of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
    const manifest = path.join(pkgsDir, d.name, 'package.json')
    if (d.isDirectory() && fs.existsSync(manifest)) byName.set(JSON.parse(fs.readFileSync(manifest, 'utf8')).name, d.name)
  }
  const wanted = new Set<string>()
  const visit = (manifestPath: string) => {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    for (const [dep, range] of Object.entries({ ...(m.dependencies || {}), ...(m.devDependencies || {}) })) {
      if (!String(range).startsWith('workspace:')) continue
      const dir = byName.get(dep)
      if (!dir) throw new Error(`workspace dependency ${dep} is not a package under packages/`)
      if (wanted.has(dir)) continue
      wanted.add(dir)
      visit(path.join(pkgsDir, dir, 'package.json'))
    }
  }
  visit(path.join(root, 'apps', 'unified', 'package.json'))
  return [...wanted].sort()
}

/** Never copied: installs, builds, the test suites and their sandboxes, local settings. */
const SKIP_NAMES = new Set(['node_modules', 'dist', '.suite', '.git', '.env', '.DS_Store', '.turbo'])
const SKIP_TOP = new Set(['tests'])

export interface TreeResult {
  dir: string
  /** The engine commit this tree was built from (apps/unified/VERSION). */
  version: string
  files: number
}

function copyDir(src: string, dest: string, top: boolean, counter: { n: number }) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.name.startsWith('.env') || (top && SKIP_TOP.has(entry.name))) continue
    if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d, false, counter)
    else if (entry.isFile()) { fs.copyFileSync(s, d); counter.n++ }
  }
}

/** The tenant repo's root package.json: the workspace, and the monorepo's security overrides. */
export function rootManifest(monorepo: { packageManager?: string; overrides?: Record<string, string> }, packages: string[]) {
  return {
    name: 'twomiah-tenant',
    private: true,
    ...(monorepo.packageManager ? { packageManager: monorepo.packageManager } : {}),
    workspaces: ['apps/unified', ...packages.map((p) => 'packages/' + p)],
    ...(monorepo.overrides ? { overrides: monorepo.overrides } : {}),
  }
}

/**
 * Writes the tenant repo into `dest` (which must not exist yet) from the monorepo at `root`.
 * `prune` cuts the lockfile to this workspace (bun install --lockfile-only); tests that only look at the files skip it.
 */
export function buildTenantTree(root: string, dest: string, version: string, opts: { prune?: boolean } = {}): TreeResult {
  if (!/^[0-9a-f]{7,40}$/.test(version)) throw new Error(`version '${version}' is not a commit`)
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists`)
  const app = path.join(root, 'apps', 'unified')
  if (!fs.existsSync(path.join(app, 'package.json'))) throw new Error(`no unified app at ${app}`)

  const counter = { n: 0 }
  copyDir(app, path.join(dest, 'apps', 'unified'), true, counter)
  const packages = workspacePackages(root)
  for (const p of packages) {
    const src = path.join(root, 'packages', p)
    if (!fs.existsSync(path.join(src, 'src'))) throw new Error(`shared package ${p} not found at ${src}`)
    fs.mkdirSync(path.join(dest, 'packages', p), { recursive: true })
    fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'packages', p, 'package.json'))
    copyDir(path.join(src, 'src'), path.join(dest, 'packages', p, 'src'), false, counter)
  }

  const monorepo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(rootManifest(monorepo, packages), null, 2) + '\n')
  fs.writeFileSync(path.join(dest, '.gitignore'), 'node_modules\ndist\n.env\n')
  fs.writeFileSync(path.join(dest, 'apps', 'unified', 'VERSION'), version + '\n')
  counter.n += 3

  const lock = path.join(root, 'bun.lock')
  if (opts.prune !== false && fs.existsSync(lock)) {
    fs.copyFileSync(lock, path.join(dest, 'bun.lock'))
    const r = spawnSync('bun', ['install', '--lockfile-only'], { cwd: dest, encoding: 'utf8', timeout: 300_000 })
    if (r.status !== 0) throw new Error('could not cut the lockfile to the tenant workspace: ' + (r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | '))
    counter.n++
  }
  return { dir: dest, version, files: counter.n }
}

/** The engine commit at `root` (what a tree built from it is stamped with). */
export function engineVersion(root: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('could not read the engine commit: ' + r.stderr.trim())
  return r.stdout.trim()
}
