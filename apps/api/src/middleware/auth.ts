import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Context, Next } from 'hono'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    _supabase = createClient(url, key)
  }
  return _supabase
}

const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as any)[prop]
  },
})

export async function authenticate(c: Context, next: Next) {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', user)
  c.set('userId', user.id)

  // ─── RBAC: resolve factory_users role ───────────────────────────────────────
  try {
    const { data: factoryUser, error: fuErr } = await supabase
      .from('factory_users')
      .select('id, role')
      .eq('auth_id', user.id)
      .maybeSingle()

    if (fuErr) {
      // Table may not exist yet — treat as viewer
      console.error('[Auth] factory_users lookup error:', fuErr.message)
      c.set('userRole', 'viewer')
      c.set('factoryUserId', null)
    } else if (factoryUser) {
      c.set('userRole', factoryUser.role)
      c.set('factoryUserId', factoryUser.id)
    } else {
      // Auto-create: first user ever gets 'owner', rest get 'viewer'
      const { count } = await supabase
        .from('factory_users')
        .select('id', { count: 'exact', head: true })

      const role = (count === 0 || count === null) ? 'owner' : 'viewer'
      const { data: newUser, error: insertErr } = await supabase
        .from('factory_users')
        .insert({ auth_id: user.id, email: user.email || '', role })
        .select('id, role')
        .single()

      if (insertErr) {
        console.error('[Auth] factory_users auto-create error:', insertErr.message)
        c.set('userRole', 'viewer')
        c.set('factoryUserId', null)
      } else {
        c.set('userRole', newUser.role)
        c.set('factoryUserId', newUser.id)
      }
    }
  } catch (err: any) {
    console.error('[Auth] RBAC error:', err.message)
    c.set('userRole', 'viewer')
    c.set('factoryUserId', null)
  }

  await next()
}

/**
 * Middleware factory that restricts access to users with one of the given roles.
 * Must be used AFTER authenticate().
 *
 * Role hierarchy (highest → lowest): owner > admin > editor > viewer
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get('userRole') as string | undefined
    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: 'Forbidden — requires role: ' + roles.join(' or ') }, 403)
    }
    await next()
  }
}

export { supabase }
