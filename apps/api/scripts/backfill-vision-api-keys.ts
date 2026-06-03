// Backfills Vision (home-visualizer) tenant api_keys and pushes VISION_API_KEY /
// VISION_URL onto each tenant's Render CRM backend, so existing tenants get the
// in-CRM "choose what products show on my visualizer" feature without a manual
// redeploy. New tenants are handled automatically by registerVisualizerTenant().
//
// Usage:
//   # Vision-side backfill only (safe — no redeploys), prints what it would push:
//   VISION_SUPABASE_URL=... VISION_SUPABASE_SERVICE_KEY=... \
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... RENDER_API_KEY=... \
//   bun scripts/backfill-vision-api-keys.ts
//
//   # Also push env vars to Render (this triggers a redeploy of each backend):
//   ... bun scripts/backfill-vision-api-keys.ts --push-render
//
//   # Limit to specific slugs:
//   ... bun scripts/backfill-vision-api-keys.ts --slug=claflin-construction --slug=straight-lyons-construction

import crypto from 'crypto'
import { findRenderServicesBySlug, updateRenderEnvVars } from '../src/services/deploy.ts'

const visionUrl = process.env.VISION_SUPABASE_URL
const visionKey = process.env.VISION_SUPABASE_SERVICE_KEY
const factoryUrl = process.env.SUPABASE_URL
const factoryKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const sharedVisionAppUrl = process.env.TWOMIAH_VISION_URL || 'https://home-visualizer.onrender.com'

if (!visionUrl || !visionKey) {
  console.error('VISION_SUPABASE_URL and VISION_SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}

const args = process.argv.slice(2)
const pushRender = args.includes('--push-render')
const onlySlugs = args.filter(a => a.startsWith('--slug=')).map(a => a.slice('--slug='.length))

const visionHeaders = {
  'apikey': visionKey,
  'Authorization': 'Bearer ' + visionKey,
  'Content-Type': 'application/json',
}

async function visionReq(path: string, init?: RequestInit) {
  const res = await fetch(visionUrl + '/rest/v1' + path, {
    ...init,
    headers: { ...visionHeaders, ...(init?.headers || {}) },
  })
  if (!res.ok) throw new Error(`Vision ${init?.method || 'GET'} ${path} → ${res.status}: ${await res.text()}`)
  return res
}

async function main() {
  // 1. Pull all Vision tenants (active) with their current api_key
  const tenants: Array<{ id: string; slug: string; api_key: string | null; active: boolean }> =
    await (await visionReq('/tenants?select=id,slug,api_key,active')).json()

  const targets = tenants.filter(t =>
    t.active !== false && (onlySlugs.length === 0 || onlySlugs.includes(t.slug))
  )
  console.log(`Found ${targets.length} Vision tenant(s)${onlySlugs.length ? ' (filtered)' : ''}`)

  const slugToKey: Record<string, string> = {}

  // 2. Backfill api_key where missing
  for (const t of targets) {
    if (t.api_key) {
      slugToKey[t.slug] = t.api_key
      console.log(`  ✓ ${t.slug} — already has api_key`)
      continue
    }
    const apiKey = 'vis_' + crypto.randomBytes(24).toString('hex')
    await visionReq('/tenants?id=eq.' + t.id, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ api_key: apiKey }),
    })
    slugToKey[t.slug] = apiKey
    console.log(`  + ${t.slug} — generated api_key`)
  }

  // 3. Push VISION_URL + VISION_API_KEY onto each tenant's Render CRM backend.
  //    Only tenants whose factory record has the visualizer feature enabled.
  if (!factoryUrl || !factoryKey) {
    console.log('\nSkipping Render env push — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set.')
    console.log('Vision api_keys are backfilled. Set the env vars below on each CRM backend manually,')
    console.log('or re-run with factory creds + RENDER_API_KEY + --push-render.\n')
    for (const [slug, key] of Object.entries(slugToKey)) {
      console.log(`  ${slug}:  VISION_URL=${sharedVisionAppUrl}  VISION_API_KEY=${key}`)
    }
    return
  }

  const fRes = await fetch(
    factoryUrl + '/rest/v1/tenants?select=slug,features,render_backend_url&status=eq.active',
    { headers: { apikey: factoryKey, Authorization: 'Bearer ' + factoryKey } }
  )
  const factoryTenants: Array<{ slug: string; features: string[] | null; render_backend_url: string | null }> =
    fRes.ok ? await fRes.json() : []
  const factoryBySlug = new Map(factoryTenants.map(t => [t.slug, t]))

  for (const [slug, key] of Object.entries(slugToKey)) {
    const ft = factoryBySlug.get(slug)
    if (!ft || !(ft.features || []).includes('visualizer')) {
      console.log(`  - ${slug} — no factory tenant with visualizer feature, skipping Render env`)
      continue
    }
    if (!pushRender) {
      console.log(`  · ${slug} — would set VISION_URL + VISION_API_KEY on Render backend (dry-run; pass --push-render)`)
      continue
    }
    const services = await findRenderServicesBySlug(slug)
    const backendId = services.backend
    if (!backendId) {
      console.log(`  ! ${slug} — no Render backend service found, skipping`)
      continue
    }
    await updateRenderEnvVars(backendId, [
      { key: 'VISION_URL', value: sharedVisionAppUrl },
      { key: 'VISION_API_KEY', value: key },
    ])
    console.log(`  ✓ ${slug} — pushed VISION_URL + VISION_API_KEY (backend ${backendId} will redeploy)`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
