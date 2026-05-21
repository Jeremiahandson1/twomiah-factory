// Bulk-resync: for every active tenant, POST authoritative Factory features
// to the CRM sync endpoint. Idempotent (sets CRM to match Factory).
// Tenants missing connection info are reported and skipped.
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: tenants, error } = await sb
  .from('tenants').select('*')
  .neq('status', 'deleted');

if (error) { console.error(error.message); process.exit(1); }

type Result = {
  slug: string;
  status: string;
  result: 'OK' | 'SKIP_NO_CONNECTION' | 'KEY_MISMATCH_401' | 'CRM_NO_KEY_503' | 'NETWORK_ERROR' | 'BAD_HTTP' | 'OTHER';
  http?: number;
  detail?: string;
  factoryCount?: number;
  factoryHasVisualizer?: boolean;
};

const results: Result[] = [];

for (const t of tenants ?? []) {
  const features: string[] = Array.isArray(t.features) ? t.features : [];
  const hasUrl = !!t.render_backend_url;
  const hasKey = !!t.factory_sync_key;
  const base: Result = {
    slug: t.slug, status: t.status,
    factoryCount: features.length, factoryHasVisualizer: features.includes('visualizer'),
    result: 'OTHER',
  };

  if (!hasUrl || !hasKey) {
    results.push({
      ...base,
      result: 'SKIP_NO_CONNECTION',
      detail: `hasBackendUrl=${hasUrl} hasSyncKey=${hasKey} hasDbUrl=${!!t.database_url}`,
    });
    continue;
  }

  const endpoint = `${String(t.render_backend_url).replace(/\/+$/, '')}/api/internal/sync-features`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': String(t.factory_sync_key) },
      body: JSON.stringify({ features }),
      signal: AbortSignal.timeout(30000),
    });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }

    if (res.status === 200) {
      const ret = body?.features;
      const ok = Array.isArray(ret) && features.every(f => ret.includes(f));
      results.push({ ...base, result: 'OK', http: 200, detail: ok ? `CRM now has ${ret.length} features` : `WARNING: CRM returned ${Array.isArray(ret) ? ret.length : '?'} features` });
    } else if (res.status === 401) {
      results.push({ ...base, result: 'KEY_MISMATCH_401', http: 401, detail: body?.error });
    } else if (res.status === 503) {
      results.push({ ...base, result: 'CRM_NO_KEY_503', http: 503, detail: body?.error });
    } else {
      results.push({ ...base, result: 'BAD_HTTP', http: res.status, detail: JSON.stringify(body) });
    }
  } catch (e: any) {
    results.push({ ...base, result: 'NETWORK_ERROR', detail: e.message?.slice(0, 100) });
  }
}

// Summary
const tally = (r: Result['result']) => results.filter(x => x.result === r).length;
console.log(`\n═══ BULK RESYNC RESULT ═══`);
console.log(`total tenants:        ${results.length}`);
console.log(`  OK (synced):        ${tally('OK')}`);
console.log(`  no connection info: ${tally('SKIP_NO_CONNECTION')}`);
console.log(`  key mismatch 401:   ${tally('KEY_MISMATCH_401')}`);
console.log(`  CRM no key 503:     ${tally('CRM_NO_KEY_503')}`);
console.log(`  network error:      ${tally('NETWORK_ERROR')}`);
console.log(`  other HTTP:         ${tally('BAD_HTTP')}`);

console.log(`\n─── per tenant ───`);
for (const r of results) {
  const tag = r.http ? ` [HTTP ${r.http}]` : '';
  console.log(`  ${r.result.padEnd(20)} ${r.slug.padEnd(34)}${tag} ${r.detail ?? ''}`);
}
console.log('');
