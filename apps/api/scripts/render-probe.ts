/**
 * Directly test the Render API + GitHub API credentials used by runDeploy.
 * Tells us exactly which deploy dependency is broken.
 *
 *   bun scripts/render-probe.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
const envVars: Record<string, string> = {}
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) envVars[match[1].trim()] = match[2].trim()
}

const RENDER_KEY = envVars.RENDER_API_KEY
const RENDER_OWNER = envVars.RENDER_OWNER_ID
const GH_TOKEN = envVars.GITHUB_TOKEN
const GH_ORG = envVars.GITHUB_ORG

console.log('── Credentials present ──')
console.log('RENDER_API_KEY  :', RENDER_KEY ? '✓' : '✗ MISSING')
console.log('RENDER_OWNER_ID :', RENDER_OWNER ? '✓ ' + RENDER_OWNER : '✗ MISSING')
console.log('GITHUB_TOKEN    :', GH_TOKEN ? '✓ ' + GH_TOKEN.substring(0, 10) + '…' : '✗ MISSING')
console.log('GITHUB_ORG      :', GH_ORG ? '✓ ' + GH_ORG : '✗ MISSING')

async function probe(label: string, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers })
    const body = await res.text()
    console.log(`\n── ${label} ──`)
    console.log('Status:', res.status, res.statusText)
    if (res.status >= 400) {
      console.log('Body:', body.substring(0, 400))
    } else {
      console.log('OK — auth works')
      try {
        const j = JSON.parse(body)
        if (Array.isArray(j)) console.log('Got', j.length, 'items')
        else if (j?.login) console.log('Logged in as:', j.login)
        else if (j?.email) console.log('Email:', j.email)
      } catch {}
    }
  } catch (e: any) {
    console.log(`\n── ${label} ──`)
    console.log('Network error:', e.message)
  }
}

async function main() {
  if (RENDER_KEY) {
    await probe(
      'Render API (list services)',
      'https://api.render.com/v1/services?limit=1',
      { 'Authorization': 'Bearer ' + RENDER_KEY, 'Accept': 'application/json' }
    )
  }
  if (RENDER_KEY && RENDER_OWNER) {
    await probe(
      'Render API (owner info)',
      `https://api.render.com/v1/owners/${RENDER_OWNER}`,
      { 'Authorization': 'Bearer ' + RENDER_KEY, 'Accept': 'application/json' }
    )
  }
  if (GH_TOKEN) {
    await probe(
      'GitHub API (authenticated user)',
      'https://api.github.com/user',
      { 'Authorization': 'token ' + GH_TOKEN, 'Accept': 'application/vnd.github+json' }
    )
  }
  if (GH_TOKEN && GH_ORG) {
    await probe(
      `GitHub API (org ${GH_ORG})`,
      `https://api.github.com/orgs/${GH_ORG}`,
      { 'Authorization': 'token ' + GH_TOKEN, 'Accept': 'application/vnd.github+json' }
    )
  }
}

main().catch(e => { console.error(e); process.exit(1) })
