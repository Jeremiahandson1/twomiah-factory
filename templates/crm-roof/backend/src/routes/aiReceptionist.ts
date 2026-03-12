import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import aiReceptionist from '../services/aiReceptionist.ts'

const app = new Hono()

// --- Twilio Recording Webhook (no auth -- called by Twilio) ---

app.post('/webhook/recording/:companyId', async (c) => {
  const companyId = c.req.param('companyId')

  // Twilio sends form-encoded data
  let payload: any
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    payload = await c.req.parseBody()
  } else {
    payload = await c.req.json()
  }

  // Process async -- don't block Twilio's webhook response
  aiReceptionist.processRecordingWebhook(companyId, payload).catch(err => {
    console.error('[AIReceptionist] Recording webhook error:', err.message)
  })

  return c.body(null, 200)
})

// --- Twilio Status Callback (tracks missed calls / voicemails) ---

app.post('/webhook/status/:companyId', async (c) => {
  const companyId = c.req.param('companyId')
  let payload: any
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    payload = await c.req.parseBody()
  } else {
    payload = await c.req.json()
  }

  // If call was not answered, evaluate rules for missed_call / after_hours triggers
  if (payload.CallStatus === 'no-answer' || payload.CallStatus === 'busy' || payload.CallStatus === 'failed') {
    const callStatus = payload.CallStatus === 'no-answer' ? 'missed' : payload.CallStatus

    aiReceptionist.evaluateRules(companyId, {
      callLogId: '', // Will need to look up by CallSid
      callerNumber: payload.From,
      status: callStatus,
    }).catch(err => {
      console.error('[AIReceptionist] Status webhook error:', err.message)
    })
  }

  return c.body(null, 200)
})

// --- Authenticated Routes ---
app.use('*', authenticate)

// --- Rules CRUD ---

app.get('/rules', async (c) => {
  const user = c.get('user') as any
  const rules = await aiReceptionist.getRules(user.companyId)
  return c.json({ data: rules })
})

app.post('/rules', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const rule = await aiReceptionist.createRule(user.companyId, body)
  return c.json(rule, 201)
})

app.put('/rules/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const rule = await aiReceptionist.updateRule(id, user.companyId, body)
  if (!rule) return c.json({ error: 'Rule not found' }, 404)
  return c.json(rule)
})

app.delete('/rules/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await aiReceptionist.deleteRule(id, user.companyId)
  return c.json({ success: true })
})

// --- Settings ---

app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const settings = await aiReceptionist.getSettings(user.companyId)
  return c.json(settings)
})

app.put('/settings', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const settings = await aiReceptionist.upsertSettings(user.companyId, body)
  return c.json(settings)
})

// --- Manual transcribe (admin can trigger on existing call) ---

app.post('/transcribe/:callId', async (c) => {
  const user = c.get('user') as any
  const callId = c.req.param('callId')

  // This would look up the call's recording URL and run transcription
  // For now, return a message indicating the feature
  return c.json({ message: 'Transcription queued', callId })
})

export default app
