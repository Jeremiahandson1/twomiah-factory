import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Context, Next } from 'hono'
import { withSealedTenantSecrets } from '../lib/tenantSecrets'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    // Tenants' secrets are sealed on the way in and opened on the way out, here, once (lib/tenantSecrets.ts).
    _supabase = withSealedTenantSecrets(createClient(url, key))
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
    console.warn('[Auth] Missing or malformed Authorization header')
    return c.json({ error: 'Missing Authorization header' }, 401)
  }
  const token = auth.slice(7)
  if (!token || token === 'undefined' || token === 'null') {
    console.warn('[Auth] Token is empty or literal "undefined"/"null" — frontend session likely expired')
    return c.json({ error: 'Session expired — please sign in again' }, 401)
  }
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    const reason = error?.message || 'user not found'
    console.warn('[Auth] Token validation failed:', reason)
    return c.json({ error: 'Invalid token: ' + reason }, 401)
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
      // Who this is could not be read: nobody is let in on a guess (it used to be "a viewer").
      console.error('[Auth] factory_users lookup error:', fuErr.message)
      return c.json({ error: 'Sign-in could not be checked. Try again.' }, 503)
    } else if (factoryUser) {
      c.set('userRole', factoryUser.role)
      c.set('factoryUserId', factoryUser.id)
    } else {
      /**
       * A SIGN-IN THAT IS NOT STAFF GETS NOTHING (security review S5-1, 2026-11-13). Anyone could create a sign-in on
       * the Factory's auth (sign-up was open), and the first request made them a `viewer` here — or an OWNER when the
       * count below failed (`count === null`). Staff are added by an owner or admin (POST /settings/users). The one
       * sign-in made here is the very first: the table was read and is truly empty.
       */
      const { count, error: countErr } = await supabase
        .from('factory_users')
        .select('id', { count: 'exact', head: true })
      if (countErr || count !== 0) {
        console.warn('[Auth] sign-in with no staff account refused:', user.email || user.id)
        return c.json({ error: 'This sign-in is not a Factory staff account. Ask an owner to add you.' }, 403)
      }
      const { data: newUser, error: insertErr } = await supabase
        .from('factory_users')
        .insert({ auth_id: user.id, email: user.email || '', role: 'owner' })
        .select('id, role')
        .single()

      if (insertErr) {
        console.error('[Auth] factory_users auto-create error:', insertErr.message)
        return c.json({ error: 'Sign-in could not be checked. Try again.' }, 503)
      }
      c.set('userRole', newUser.role)
      c.set('factoryUserId', newUser.id)
    }
  } catch (err: any) {
    console.error('[Auth] RBAC error:', err.message)
    return c.json({ error: 'Sign-in could not be checked. Try again.' }, 503)
  }

  await next()
}

/**
 * Whose token is this, as STAFF — for the few routes that take the token in the address (a download link, an event
 * stream) and so cannot go through `authenticate`. They asked only "is this a valid sign-in", which any stranger's
 * was (security review S5-1). Null unless the sign-in has a staff row.
 */
export async function staffFromToken(token: string | undefined | null): Promise<{ authId: string; role: string } | null> {
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: row, error: rowErr } = await supabase.from('factory_users').select('role').eq('auth_id', user.id).maybeSingle()
  if (rowErr || !row?.role) return null
  return { authId: user.id, role: String(row.role) }
}

/**
 * Middleware factory that restricts access to users with one of the given roles.
 * Must be used AFTER authenticate().
 *
 * Role hierarchy (highest → lowest): owner > admin > editor > viewer
 */
export function requireRole(...roles: string[]) {
  // Generic over the route's path: a plain (c: Context) handler in front of a route made Hono drop the route's :params, so
  // every c.req.param('id') after it read as string | undefined (40 of the Factory's type errors).
  return async <P extends string>(c: Context<any, P>, next: Next) => {
    const userRole = c.get('userRole') as string | undefined
    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: 'Forbidden — requires role: ' + roles.join(' or ') }, 403)
    }
    await next()
  }
}

export { supabase }
