/**
 * End-to-end QA for home care client signable documents, run against a LIVE
 * deployed test tenant.
 *
 *   bun run homecare-docs-qa.ts <crmUrl> <ownerEmail> <ownerPassword>
 *
 * Proves the things a build cannot: that the migration ran, that a client can
 * actually sign, that the evidence is stored, and that the obvious ways to
 * cheat it are refused.
 */

const [, , BASE_RAW, EMAIL, PASSWORD] = process.argv
if (!BASE_RAW || !EMAIL || !PASSWORD) {
  console.error('usage: bun run homecare-docs-qa.ts <crmUrl> <email> <password>')
  process.exit(1)
}
const BASE = BASE_RAW.replace(/\/$/, '')

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

async function req(path: string, opts: any = {}, token?: string) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

// A 1x1 png — enough to be a real data URL without shipping a blob into the log.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  console.log('\nHome care signable documents — live QA against ' + BASE + '\n')

  // ── staff session ────────────────────────────────────────────────────
  const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
  const token = login.body?.token || login.body?.accessToken
  check('owner can log in', !!token, login.body)
  if (!token) { console.log('\nCannot continue without a staff session.\n'); process.exit(1) }

  // ── the migration actually ran ───────────────────────────────────────
  const templates = await req('/api/client-documents/templates', {}, token)
  check('GET /client-documents/templates responds 200 (table exists → migration ran)', templates.status === 200, templates.body)
  const tpls = templates.body?.data || []
  check('default paperwork seeded', tpls.length >= 4, tpls.map((t: any) => t.key))
  const serviceAgreement = tpls.find((t: any) => t.key === 'service_agreement')
  check('service agreement template present', !!serviceAgreement)
  check('starter wording tells the agency to replace it', !!serviceAgreement && serviceAgreement.body.startsWith('REPLACE THIS TEXT'))

  // ── a client to send it to ───────────────────────────────────────────
  const clientsRes = await req('/api/clients?limit=5', {}, token)
  let client = (clientsRes.body?.clients || [])[0]
  if (!client) {
    const created = await req('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Eleanor', lastName: 'Whitfield', email: 'twomiah14@gmail.com', phone: '+1-608-555-0177', isActive: true }),
    }, token)
    client = created.body?.client || created.body
  }
  check('a client exists to send documents to', !!client?.id, clientsRes.body?.clients?.length)
  if (!client?.id) { console.log('\nNo client available.\n'); process.exit(1) }

  // ── send ─────────────────────────────────────────────────────────────
  const sent = await req('/api/client-documents', {
    method: 'POST',
    body: JSON.stringify({ clientId: client.id, templateId: serviceAgreement.id }),
  }, token)
  check('staff can send a document', sent.status === 201 && !!sent.body?.id, sent.body)
  const docId = sent.body?.id
  check('document is snapshot, not a template reference', typeof sent.body?.body === 'string' && sent.body.body.length > 50)
  check('placeholders were filled in', !!sent.body?.body && !sent.body.body.includes('{{AGENCY_NAME}}'), sent.body?.body?.slice(0, 120))
  check('send reports honestly whether the client was emailed', 'emailed' in (sent.body || {}), sent.body?.emailNote)

  const missingClient = await req('/api/client-documents', { method: 'POST', body: JSON.stringify({ templateId: serviceAgreement.id }) }, token)
  check('sending without a client is refused', missingClient.status === 400, missingClient.body)

  // ── portal access for that client ────────────────────────────────────
  const enable = await req('/api/portal/contacts/' + client.id + '/enable', { method: 'POST' }, token)
  // enable returns the link, with the token in its query string
  const portalToken = enable.body?.token
    || enable.body?.portalToken
    || (enable.body?.portalUrl || '').split('token=')[1]
  check('portal access can be enabled for the client', !!portalToken, enable.body)
  if (!portalToken) { console.log('\nNo portal token — cannot test signing.\n'); process.exit(1) }

  const portal = (path: string, opts: any = {}) => req(path, { ...opts, headers: { 'x-portal-token': portalToken } })

  // ── client sees it ───────────────────────────────────────────────────
  const list = await portal('/api/portal/documents')
  check('client sees their documents', list.status === 200 && (list.body?.data || []).some((d: any) => d.id === docId), list.body)

  const opened = await portal('/api/portal/documents/' + docId)
  check('client can open the document', opened.status === 200 && opened.body?.id === docId, opened.body)
  check('client is shown the full text', typeof opened.body?.body === 'string' && opened.body.body.length > 50)

  const afterOpen = await req('/api/client-documents/' + docId, {}, token)
  check('opening is recorded as viewed', !!afterOpen.body?.viewedAt, afterOpen.body?.status)

  // ── the ways to cheat it are refused ─────────────────────────────────
  const noSig = await portal('/api/portal/documents/' + docId + '/sign', {
    method: 'POST', body: JSON.stringify({ signedBy: 'Eleanor Whitfield', consent: true }),
  })
  check('signing with no signature image is refused', noSig.status === 400, noSig.body)

  const noName = await portal('/api/portal/documents/' + docId + '/sign', {
    method: 'POST', body: JSON.stringify({ signature: SIGNATURE, consent: true }),
  })
  check('signing with no typed name is refused', noName.status === 400, noName.body)

  const noConsent = await portal('/api/portal/documents/' + docId + '/sign', {
    method: 'POST', body: JSON.stringify({ signature: SIGNATURE, signedBy: 'Eleanor Whitfield' }),
  })
  check('signing without the consent checkbox is refused', noConsent.status === 400, noConsent.body)

  const noAuth = await req('/api/portal/documents/' + docId + '/sign', {
    method: 'POST', body: JSON.stringify({ signature: SIGNATURE, signedBy: 'Somebody Else', consent: true }),
  })
  check('signing with no portal token is refused', noAuth.status === 401, noAuth.status)

  // ── sign for real ────────────────────────────────────────────────────
  const signed = await portal('/api/portal/documents/' + docId + '/sign', {
    method: 'POST',
    body: JSON.stringify({ signature: SIGNATURE, signedBy: 'Eleanor Whitfield', signerRelationship: 'Daughter', consent: true }),
  })
  check('client can sign', signed.status === 200 && signed.body?.status === 'signed', signed.body)
  check('typed name stored', signed.body?.signedBy === 'Eleanor Whitfield')
  check('relationship stored (signer is often not the client)', signed.body?.signerRelationship === 'Daughter')
  check('signature image stored', typeof signed.body?.signatureImage === 'string' && signed.body.signatureImage.startsWith('data:image/'))
  check('consent timestamp stored', !!signed.body?.consentAt)
  check('IP captured', !!signed.body?.signedIp, signed.body?.signedIp)
  check('user agent captured', !!signed.body?.signedUserAgent)
  check('document hash captured', typeof signed.body?.documentHash === 'string' && signed.body.documentHash.length === 64)

  const twice = await portal('/api/portal/documents/' + docId + '/sign', {
    method: 'POST',
    body: JSON.stringify({ signature: SIGNATURE, signedBy: 'Someone Else', consent: true }),
  })
  check('a signed document cannot be signed again', twice.status === 400, twice.body)

  const voidAfterSign = await req('/api/client-documents/' + docId + '/void', { method: 'POST' }, token)
  check('a signed document cannot be voided away', voidAfterSign.status === 400, voidAfterSign.body)

  // ── the signed record staff see ──────────────────────────────────────
  const record = await req('/api/client-documents/' + docId, {}, token)
  check('staff see the signature evidence', record.body?.signedIp && record.body?.documentHash && record.body?.signatureImage, {
    ip: record.body?.signedIp, hash: record.body?.documentHash?.slice(0, 12),
  })
  check('signed body is unchanged from what was presented', record.body?.body === opened.body?.body)

  // Editing the template must not rewrite a signed document. Compare against
  // the body captured moments ago rather than a marker string — the marker
  // persists in the template between runs, which made a clean product look
  // broken on the second pass.
  const bodyBeforeEdit = record.body?.body
  await req('/api/client-documents/templates/' + serviceAgreement.id, {
    method: 'PUT', body: JSON.stringify({ body: serviceAgreement.body + '\n\nEDITED LATER' }),
  }, token)
  const afterEdit = await req('/api/client-documents/' + docId, {}, token)
  check('editing the template does NOT change what was already signed', afterEdit.body?.body === bodyBeforeEdit, {
    before: (bodyBeforeEdit || '').slice(-30), after: (afterEdit.body?.body || '').slice(-30),
  })

  // ── decline path on a second document ────────────────────────────────
  const rights = tpls.find((t: any) => t.key === 'client_rights')
  const second = await req('/api/client-documents', {
    method: 'POST', body: JSON.stringify({ clientId: client.id, templateId: rights.id }),
  }, token)
  const declined = await portal('/api/portal/documents/' + second.body.id + '/decline', {
    method: 'POST', body: JSON.stringify({ reason: 'Want to read it with my sister first' }),
  })
  check('client can decline instead of signing', declined.status === 200 && declined.body?.status === 'declined', declined.body)
  check('decline reason recorded', declined.body?.declineReason === 'Want to read it with my sister first')

  // ── voiding an unsigned document hides it from the client ────────────
  const third = await req('/api/client-documents', {
    method: 'POST', body: JSON.stringify({ clientId: client.id, templateId: rights.id }),
  }, token)
  const voided = await req('/api/client-documents/' + third.body.id + '/void', { method: 'POST' }, token)
  check('unsigned document can be voided', voided.status === 200 && voided.body?.status === 'void', voided.body)
  const listAfterVoid = await portal('/api/portal/documents')
  check('voided document is hidden from the client', !(listAfterVoid.body?.data || []).some((d: any) => d.id === third.body.id))
  const openVoided = await portal('/api/portal/documents/' + third.body.id)
  check('voided document cannot be opened by the client', openVoided.status === 404, openVoided.status)

  // ── one client cannot reach another client's documents ───────────────
  const otherClient = (clientsRes.body?.clients || []).find((cl: any) => cl.id !== client.id)
  if (otherClient) {
    const otherDoc = await req('/api/client-documents', {
      method: 'POST', body: JSON.stringify({ clientId: otherClient.id, templateId: rights.id }),
    }, token)
    const cross = await portal('/api/portal/documents/' + otherDoc.body.id)
    check("a client cannot open another client's document", cross.status === 404, cross.status)
  } else {
    console.log('  SKIP  cross-client check (only one client on this tenant)')
  }

  console.log('\n' + '─'.repeat(52))
  console.log(`Pass: ${pass}   Fail: ${fail}`)
  console.log('─'.repeat(52) + '\n')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => { console.error('QA CRASHED:', err); process.exit(1) })
