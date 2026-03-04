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
  await next()
}

export { supabase }
