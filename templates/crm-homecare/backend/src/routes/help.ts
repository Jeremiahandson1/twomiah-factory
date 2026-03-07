import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';

const app = new Hono();
app.use('*', authenticate);

// ─── Knowledge Base ──────────────────────────────────────────────────────────
// Articles are stored in a simple table. Seeded from Factory on deployment.

app.get('/kb', async (c) => {
  const user = c.get('user') as any;
  const search = c.req.query('search');
  const category = c.req.query('category');

  try {
    let query = `SELECT * FROM help_articles WHERE agency_id = $1 AND published = true`;
    const params: any[] = [user.agencyId];
    let idx = 2;

    if (category) {
      query += ` AND category = $${idx}`;
      params.push(category);
      idx++;
    }
    if (search) {
      query += ` AND (title ILIKE $${idx} OR content ILIKE $${idx})`;
      params.push('%' + search + '%');
      idx++;
    }

    query += ' ORDER BY sort_order ASC, view_count DESC LIMIT 100';
    const result = await db.execute(sql.raw(query + ';-- ' + JSON.stringify(params)));
    // Drizzle raw query workaround — use direct pg query
    const articles = await db.execute(sql`
      SELECT * FROM help_articles
      WHERE agency_id = ${user.agencyId} AND published = true
      ORDER BY sort_order ASC, view_count DESC
      LIMIT 100
    `);
    return c.json(articles.rows || []);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json([]);
    throw e;
  }
});

app.get('/kb/:id', async (c) => {
  const user = c.get('user') as any;
  const id = c.req.param('id');

  try {
    // Increment view count
    await db.execute(sql`UPDATE help_articles SET view_count = view_count + 1 WHERE id = ${id} AND agency_id = ${user.agencyId}`);
    const result = await db.execute(sql`SELECT * FROM help_articles WHERE id = ${id} AND agency_id = ${user.agencyId}`);
    const article = (result.rows || [])[0];
    if (!article) return c.json({ error: 'Article not found' }, 404);
    return c.json(article);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json({ error: 'Not found' }, 404);
    throw e;
  }
});

// Admin: create/update/delete articles
app.post('/kb', async (c) => {
  const user = c.get('user') as any;
  if (user.role !== 'admin') return c.json({ error: 'Admin required' }, 403);
  const body = await c.req.json();

  try {
    const result = await db.execute(sql`
      INSERT INTO help_articles (agency_id, title, content, category, tags, sort_order, is_faq)
      VALUES (${user.agencyId}, ${body.title}, ${body.content}, ${body.category || null}, ${JSON.stringify(body.tags || [])}, ${body.sort_order || 0}, ${body.is_faq || false})
      RETURNING *
    `);
    return c.json((result.rows || [])[0], 201);
  } catch (e: any) {
    if (e.message?.includes('does not exist')) return c.json({ error: 'Help articles table not set up' }, 500);
    throw e;
  }
});

app.put('/kb/:id', async (c) => {
  const user = c.get('user') as any;
  if (user.role !== 'admin') return c.json({ error: 'Admin required' }, 403);
  const id = c.req.param('id');
  const body = await c.req.json();

  try {
    const result = await db.execute(sql`
      UPDATE help_articles SET
        title = ${body.title}, content = ${body.content}, category = ${body.category || null},
        tags = ${JSON.stringify(body.tags || [])}, sort_order = ${body.sort_order || 0},
        is_faq = ${body.is_faq || false}, published = ${body.published !== false},
        updated_at = now()
      WHERE id = ${id} AND agency_id = ${user.agencyId}
      RETURNING *
    `);
    const article = (result.rows || [])[0];
    if (!article) return c.json({ error: 'Not found' }, 404);
    return c.json(article);
  } catch (e: any) {
    throw e;
  }
});

app.delete('/kb/:id', async (c) => {
  const user = c.get('user') as any;
  if (user.role !== 'admin') return c.json({ error: 'Admin required' }, 403);
  const id = c.req.param('id');

  try {
    await db.execute(sql`DELETE FROM help_articles WHERE id = ${id} AND agency_id = ${user.agencyId}`);
    return c.json({ success: true });
  } catch (e: any) {
    throw e;
  }
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────

app.post('/ai-chat', async (c) => {
  const user = c.get('user') as any;
  const { message, conversationHistory } = await c.req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: 'AI support is not configured. Please contact your administrator.', resolved: false });

  // Fetch KB articles for context
  let kbContext = '';
  try {
    const articles = await db.execute(sql`
      SELECT title, content FROM help_articles
      WHERE agency_id = ${user.agencyId} AND published = true
      LIMIT 20
    `);
    const rows = articles.rows || [];
    if (rows.length > 0) {
      kbContext = '\n\nKnowledge Base:\n' + rows.map((a: any) => `## ${a.title}\n${a.content}`).join('\n\n');
    }
  } catch {}

  const systemPrompt = `You are a helpful support assistant for a home care management platform. Answer questions based on the knowledge base provided. If you cannot find a relevant answer, suggest the user submit a support ticket.${kbContext}`;

  const messages = [
    ...(conversationHistory || []).map((m: any) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await res.json() as any;
    const reply = data.content?.[0]?.text || 'Sorry, I could not process that request.';
    const resolved = !reply.toLowerCase().includes('support ticket') && !reply.toLowerCase().includes('contact');

    return c.json({ reply, resolved });
  } catch {
    return c.json({ reply: 'AI service is temporarily unavailable.', resolved: false });
  }
});

export default app;
