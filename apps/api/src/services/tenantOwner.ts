// The owner's first name, for an email that greets a person. The Factory's tenants row holds the COMPANY; the owner's own
// name lives in the build config the signup wrote (factory_jobs.config.company.ownerFirstName, E2E run 1). The
// "welcome back" email greeted "Test Shop Co" (E2E Run 2, 10/15). Null when there is none — callers fall back.
import { supabase } from '../middleware/auth'

export async function ownerFirstName(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null
  try {
    const { data } = await supabase.from('factory_jobs').select('config').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const name = String((data as any)?.config?.company?.ownerFirstName || '').trim()
    return name || null
  } catch { return null }
}
