/**
 * WEBSITE ENQUIRIES WRITTEN BEFORE T59 REACH THE INBOX TOO.
 *
 * Since T59 the website form writes a Lead Inbox row (routes/webhooks.ts). Every enquiry that arrived
 * before that was written as a Contact of type `lead` instead, so the inbox — and the dashboard's New
 * leads count, which is the inbox at `new` — never saw them. This gives each of those an inbox row.
 *
 * NOTHING IS MOVED OR DELETED. The contact stays exactly where it is; the inbox row points at it
 * (converted_contact_id), and Convert on that row links to THAT contact rather than searching for one
 * (leads.ts). Dismissing it leaves the contact alone. The person is not lost from Contacts either way.
 *
 * Only an enquiry nobody has started on:
 *   · the company has the Lead Inbox switched on (without it there is nowhere to show the row);
 *   · the contact is type `lead` and came from the website (source "website", any case);
 *   · NOTHING references it — no job, quote, invoice, appointment, project or anything else whose
 *     foreign key points at contact.id. The list is read from the database's own constraints, so a
 *     table added later is covered without anyone remembering to add it here. A contact somebody has
 *     already done anything with is being worked, and is not a "new" lead.
 *   · it is not already in the inbox. The row id is derived from the contact id, so a second boot
 *     inserts nothing.
 *
 * Received-at is the contact's own creation time, so the inbox orders it where it actually arrived.
 */
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows || [])
const ident = (s: string) => `"${String(s).replace(/"/g, '""')}"`

export async function moveLegacyWebsiteLeadsToInbox(db: any, sql: any): Promise<number> {
  const refs = rowsOf(await db.execute(sql.raw(`
    SELECT cl.relname AS tbl, a.attname AS col
      FROM pg_constraint k
      JOIN pg_class cl  ON cl.oid  = k.conrelid
      JOIN pg_class ref ON ref.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
     WHERE k.contype = 'f' AND ref.relname = 'contact' AND cl.relname <> 'lead'
  `)))
  const untouched = refs.map((r) => `NOT EXISTS (SELECT 1 FROM ${ident(r.tbl)} x WHERE x.${ident(r.col)} = c.id)`)
  const res: any = await db.execute(sql.raw(`
    INSERT INTO lead (id, source_platform, homeowner_name, email, phone, location, description, status,
                      raw_payload, converted_contact_id, received_at, company_id, created_at, updated_at)
    SELECT 'legacy' || md5(c.id), 'website', c.name, c.email, c.phone,
           NULLIF(concat_ws(', ', NULLIF(c.address, ''), NULLIF(c.city, ''), NULLIF(c.state, ''), NULLIF(c.zip, '')), ''),
           c.notes, 'new', json_build_object('movedFromContact', c.id), c.id, c.created_at, c.company_id, NOW(), NOW()
      FROM contact c
      JOIN company co ON co.id = c.company_id
     WHERE c.type = 'lead'
       AND lower(coalesce(c.source, '')) = 'website'
       AND co.enabled_features::jsonb ? 'lead_inbox'
       AND NOT EXISTS (SELECT 1 FROM lead l WHERE l.converted_contact_id = c.id OR l.id = 'legacy' || md5(c.id))
       ${untouched.length ? 'AND ' + untouched.join('\n       AND ') : ''}
  `))
  return Number(res?.rowCount ?? res?.rowsAffected ?? res?.affectedRows ?? 0)
}
