import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// POST /send
app.post('/send', async (c) => {
  const { to, body } = await c.req.json()
  if (!process.env.TWILIO_ACCOUNT_SID) {
    return c.json({ error: 'SMS not configured. Add Twilio credentials to enable SMS.' }, 503)
  }
  // Dynamic import to avoid crash if twilio not configured
  const twilio = await import('twilio')
  const client = (twilio.default as any)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  const message = await client.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, to, body })
  return c.json({ sid: message.sid, status: message.status })
})

export default app
