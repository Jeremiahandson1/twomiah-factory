import type { Context, Next } from 'hono'

const authorizeAdmin = async (c: Context, next: Next) => {
  const user = c.get('user') as any
  if (user?.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403)
  }
  await next()
}

export default authorizeAdmin
