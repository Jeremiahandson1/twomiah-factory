// Roofing parity row 22 — the job thread, company documents and packets in the homeowner portal (AccuLynx; crm/roof/portalFiles;
// portal_posts_packets, not ready). Fails without the change: the portal had no thread, no company documents and no packet share.
//   · a thread on each of the homeowner's own jobs — they write from the portal, the office reads and answers; another
//     customer's job is "not found";
//   · a company document ticked "show every homeowner" is listed under "From <company>" and downloads; unticked, it is not;
//   · a packet shares several of the job's files in one go;
//   · off: no thread, no company documents, no packet.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const ON = ['jobs', 'contacts', 'photo_capture', 'documents', 'client_portal', 'portal_job_files']
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...ON, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const homeowner = async (name: string) => ((await t.db.insert(t.schema.contact).values({ companyId, name, type: 'client', portalEnabled: true, portalToken: `tok${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` } as any).returning()) as any[])[0]
const jobOf = async (contactId: string) => ((await t.db.insert(t.schema.job).values({ companyId, number: `J-${Math.random().toString(36).slice(2, 7)}`, title: 'Roof', contactId, status: 'in_production', jobType: 'retail' } as any).returning()) as any[])[0]
async function addDocument(jobId: string | null, name: string) {
  const key = `${companyId}/documents/${crypto.randomUUID()}.pdf`
  await t.store.put(key, PDF, 'application/pdf')
  return ((await t.db.insert(t.schema.document).values({ companyId, name, type: 'warranty', filename: key.split('/').pop(), originalName: `${name}.pdf`, mimeType: 'application/pdf', size: PDF.length, path: key, url: `/api/documents/file/${key}`, jobId } as any).returning()) as any[])[0].id as string
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(['portal_posts_packets'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  Object.assign((t.services as any).crm.storage, { storageConfigured: () => true, put: async (k: string, b: Buffer, ty: string) => { await t.store.put(k, b, ty) }, getObject: async (k: string) => t.store.getObject(k), deleteFile: async (k: string) => { await t.store.remove(k) } })
}, 120_000)

describe('row 22', () => {
  test('the job thread: the homeowner writes, the office answers; another customer’s job is not found', async () => {
    const lee = await homeowner('Lee Marsh')
    const ann = await homeowner('Ann Other')
    const j = await jobOf(lee.id)
    await jobOf(ann.id)
    // The job has its place in the portal before anything is shared.
    const list = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files`))
    expect(list.body.data.some((i: any) => i.kind === 'job' && i.jobId === j.id)).toBe(true)
    const posted = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files/${j.id}/posts`, { method: 'POST', json: { body: 'When does the crew arrive?' } }))
    expect(posted.status).toBe(201)
    expect((await json(await t.call(`/api/portal/p/${ann.portalToken}/job-files/${j.id}/posts`))).status).toBe(404)
    expect((await t.call(`/api/portal/p/${ann.portalToken}/job-files/${j.id}/posts`, { method: 'POST', json: { body: 'hi' } })).status).toBe(404)
    const office = await json(await auth(`/api/job-files/posts?jobId=${j.id}`))
    expect(office.body.data.map((m: any) => [m.fromHomeowner, m.body])).toEqual([[true, 'When does the crew arrive?']])
    expect((await auth('/api/job-files/posts', { method: 'POST', json: { jobId: j.id, body: 'Monday at 7.' } })).status).toBe(201)
    const theirs = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files/${j.id}/posts`))
    expect(theirs.body.data.map((m: any) => [m.fromYou, m.body])).toEqual([[true, 'When does the crew arrive?'], [false, 'Monday at 7.']])
  })

  test('company documents: ticked, every homeowner sees and downloads it under “From the company”; unticked, nobody does', async () => {
    const lee = await homeowner('Pat Doc')
    await jobOf(lee.id)
    const doc = await addDocument(null, 'Warranty terms')
    const listed = await json(await auth('/api/job-files/company-documents'))
    expect(listed.body.data.find((d: any) => d.id === doc)?.shared).toBe(false)
    const before = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files`))
    expect(before.body.data.some((i: any) => i.id === doc)).toBe(false)
    expect((await t.call(`/api/portal/p/${lee.portalToken}/job-files/document/${doc}/file`)).status).toBe(404)
    expect((await auth(`/api/job-files/company-documents/${doc}`, { method: 'PUT', json: { shared: true } })).status).toBe(200)
    const after = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files`))
    const item = after.body.data.find((i: any) => i.id === doc)
    expect(item).toMatchObject({ jobId: 'company', jobTitle: 'From Ridgeline Roofing', name: 'Warranty terms' })
    const file = await t.call(`/api/portal/p/${lee.portalToken}/job-files/document/${doc}/file`)
    expect(file.status).toBe(200)
  })

  test('a packet shares several of the job’s files at once', async () => {
    const lee = await homeowner('Packet Pat')
    const j = await jobOf(lee.id)
    const d1 = await addDocument(j.id, 'Contract')
    const d2 = await addDocument(j.id, 'Scope')
    const r = await json(await auth('/api/job-files/packet', { method: 'PUT', json: { jobId: j.id, items: [{ kind: 'documents', id: d1 }, { kind: 'documents', id: d2 }] } }))
    expect(r.body.shared).toBe(2)
    const names = (await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files`))).body.data.filter((i: any) => i.kind === 'document' && i.jobId === j.id).map((i: any) => i.name).sort()
    expect(names).toEqual(['Contract', 'Scope'])
    expect((await auth('/api/job-files/packet', { method: 'PUT', json: { jobId: j.id, items: [] } })).status).toBe(400)
  })

  test('off: no thread, no company documents, no packet; the switch is hidden and roofing’s', async () => {
    const lee = await homeowner('Off Owner')
    const j = await jobOf(lee.id)
    await setFeatures([])
    try {
      expect((await t.call(`/api/portal/p/${lee.portalToken}/job-files/${j.id}/posts`)).status).toBe(404)
      expect((await auth('/api/job-files/company-documents')).status).toBe(404)
      expect((await auth('/api/job-files/packet', { method: 'PUT', json: { jobId: j.id, items: [] } })).status).toBe(404)
      const list = await json(await t.call(`/api/portal/p/${lee.portalToken}/job-files`))
      expect(list.body.data.some((i: any) => i.kind === 'job' || i.jobId === 'company')).toBe(false)
    } finally { await setFeatures(['portal_posts_packets']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'portal_posts_packets') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
