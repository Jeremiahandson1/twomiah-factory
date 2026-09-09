import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw db.execute rows come back snake_case; the frontend reads camelCase
// (courseTitle, courseCategory, estimatedMinutes, …). Convert row keys before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// ─── Courses ────────────────────────────────────────────────────────────────

// List courses
app.get('/courses', async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const required = c.req.query('required')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let categoryFilter = sql``
  let requiredFilter = sql``
  if (category) categoryFilter = sql`AND c.category = ${category}`
  if (required !== undefined) requiredFilter = sql`AND c.is_required = ${required === 'true'}`

  const dataResult = await db.execute(sql`
    SELECT c.*,
           c.is_required AS required,
           (SELECT COUNT(*)::int FROM training_enrollments te WHERE te.course_id = c.id) as enrolled_count,
           (SELECT COUNT(*)::int FROM training_enrollments te WHERE te.course_id = c.id AND te.status = 'completed') as completed_count
    FROM training_courses c
    WHERE c.company_id = ${currentUser.companyId}
      AND c.is_active = true
      ${categoryFilter} ${requiredFilter}
    ORDER BY c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM training_courses c
    WHERE c.company_id = ${currentUser.companyId} AND c.is_active = true
      ${categoryFilter} ${requiredFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create course (manager+)
app.post('/courses', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const courseSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.string().default('general'), // compliance, product_knowledge, safety, general
    required: z.boolean().default(false),
    // The create dialog sends `steps` (loose shape: { type, order, title, content/videoUrl/question/... }).
    // Older callers may send `content`. Accept either loosely and normalize below. Either may be omitted
    // so a course is creatable with just a title.
    steps: z.array(z.any()).optional(),
    content: z.array(z.any()).optional(),
    passingScore: z.number().int().min(0).max(100).default(80),
    estimatedMinutes: z.number().int().min(1).optional(),
    expiresAfterDays: z.number().int().optional(), // certification expiry
    sortOrder: z.number().int().default(0),
  })
  const data = courseSchema.parse(await c.req.json())

  // Normalize the dialog's step shape into the stored content structure.
  const rawSteps: any[] = data.content ?? data.steps ?? []
  const content = rawSteps.map((s: any, i: number) => {
    const type = ['text', 'video', 'quiz', 'interactive'].includes(s?.type) ? s.type : 'text'
    const normalized: any = {
      step: s?.step ?? s?.order ?? (i + 1),
      type,
      title: s?.title || '',
    }
    if (type === 'quiz') {
      normalized.questions = Array.isArray(s?.questions)
        ? s.questions
        : (s?.question
            ? [{ question: s.question, options: s.options || [], correctIndex: s.correctIndex ?? 0 }]
            : [])
      if (!normalized.title) normalized.title = s?.question || 'Quiz'
    } else if (type === 'video') {
      normalized.mediaUrl = s?.mediaUrl || s?.videoUrl || null
      if (s?.body || s?.content) normalized.body = s.body ?? s.content
    } else {
      normalized.body = s?.body ?? s?.content ?? null
    }
    return normalized
  })

  const result = await db.execute(sql`
    INSERT INTO training_courses(id, title, description, category, is_required, content, passing_score, estimated_minutes, is_active, company_id, created_by, created_at)
    VALUES (gen_random_uuid(), ${data.title}, ${data.description || null}, ${data.category}, ${data.required}, ${JSON.stringify(content)}::jsonb, ${data.passingScore}, ${data.estimatedMinutes || null}, true, ${currentUser.companyId}, ${currentUser.userId}, NOW())
    RETURNING *
  `)
  const course = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'training_course',
    entityId: course?.id,
    entityName: data.title,
    metadata: { category: data.category, required: data.required, steps: content.length },
    req: c.req,
  })

  return c.json(course, 201)
})

// Update course
app.put('/courses/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    required: z.boolean().optional(),
    content: z.array(z.object({
      step: z.number().int().min(1),
      type: z.enum(['text', 'video', 'quiz', 'interactive']),
      title: z.string(),
      body: z.string().optional(),
      mediaUrl: z.string().optional(),
      questions: z.array(z.object({
        question: z.string(),
        options: z.array(z.string()),
        correctIndex: z.number().int(),
      })).optional(),
    })).optional(),
    passingScore: z.number().int().min(0).max(100).optional(),
    estimatedMinutes: z.number().int().min(1).optional(),
    expiresAfterDays: z.number().int().optional(),
    sortOrder: z.number().int().optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM training_courses WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Course not found' }, 404)

  const result = await db.execute(sql`
    UPDATE training_courses SET
      title = COALESCE(${data.title || null}, title),
      description = COALESCE(${data.description || null}, description),
      category = COALESCE(${data.category || null}, category),
      is_required = COALESCE(${data.required ?? null}, is_required),
      content = COALESCE(${data.content ? JSON.stringify(data.content) : null}::jsonb, content),
      passing_score = COALESCE(${data.passingScore ?? null}, passing_score),
      estimated_minutes = COALESCE(${data.estimatedMinutes ?? null}, estimated_minutes),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'training_course',
    entityId: id,
    entityName: updated?.title,
    changes: audit.diff(existing, updated),
    req: c.req,
  })

  return c.json(updated)
})

// Deactivate course
app.delete('/courses/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE training_courses SET is_active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Course not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'training_course',
    entityId: id,
    entityName: updated.title,
    req: c.req,
  })

  return c.json({ message: 'Course deactivated' })
})

// Assign course to user(s)
app.post('/courses/:id/assign', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const assignSchema = z.object({
    userIds: z.array(z.string().min(1)).min(1),
  })
  const data = assignSchema.parse(await c.req.json())

  // Verify course exists
  const courseResult = await db.execute(sql`
    SELECT * FROM training_courses WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true LIMIT 1
  `)
  const course = ((courseResult as any).rows || courseResult)?.[0]
  if (!course) return c.json({ error: 'Course not found' }, 404)

  const created: any[] = []
  for (const userId of data.userIds) {
    // Check if already enrolled
    const existingResult = await db.execute(sql`
      SELECT id FROM training_enrollments WHERE course_id = ${id} AND user_id = ${userId} AND company_id = ${currentUser.companyId} LIMIT 1
    `)
    const existing = ((existingResult as any).rows || existingResult)?.[0]
    if (existing) continue // skip already enrolled

    const result = await db.execute(sql`
      INSERT INTO training_enrollments(id, course_id, user_id, status, percent_complete, current_step, assigned_by_id, company_id, created_at)
      VALUES (gen_random_uuid(), ${id}, ${userId}, 'assigned', 0, 0, ${currentUser.userId}, ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    created.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'training_enrollment',
    entityName: `Assigned "${course.title}" to ${created.length} user(s)`,
    metadata: { courseId: id, userIds: data.userIds, enrollmentsCreated: created.length },
    req: c.req,
  })

  return c.json({ message: `Assigned to ${created.length} user(s)`, enrollments: created }, 201)
})

// Assign course to all users with a role
app.post('/courses/:id/assign-role', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const roleSchema = z.object({
    role: z.string().min(1),
  })
  const data = roleSchema.parse(await c.req.json())

  // Verify course exists
  const courseResult = await db.execute(sql`
    SELECT * FROM training_courses WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true LIMIT 1
  `)
  const course = ((courseResult as any).rows || courseResult)?.[0]
  if (!course) return c.json({ error: 'Course not found' }, 404)

  // Get all users with the specified role
  const usersResult = await db.execute(sql`
    SELECT id FROM "user" WHERE company_id = ${currentUser.companyId} AND role = ${data.role} AND is_active = true
  `)
  const users = (usersResult as any).rows || usersResult

  let enrolled = 0
  for (const user of users) {
    // Skip if already enrolled
    const existingResult = await db.execute(sql`
      SELECT id FROM training_enrollments WHERE course_id = ${id} AND user_id = ${user.id} AND company_id = ${currentUser.companyId} LIMIT 1
    `)
    const existing = ((existingResult as any).rows || existingResult)?.[0]
    if (existing) continue

    await db.execute(sql`
      INSERT INTO training_enrollments(id, course_id, user_id, status, percent_complete, current_step, assigned_by_id, company_id, created_at)
      VALUES (gen_random_uuid(), ${id}, ${user.id}, 'assigned', 0, 0, ${currentUser.userId}, ${currentUser.companyId}, NOW())
    `)
    enrolled++
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'training_enrollment',
    entityName: `Assigned "${course.title}" to role "${data.role}"`,
    metadata: { courseId: id, role: data.role, usersFound: users.length, enrolled },
    req: c.req,
  })

  return c.json({ message: `Assigned to ${enrolled} user(s) with role "${data.role}"`, usersFound: users.length, enrolled }, 201)
})

// ─── Enrollments ────────────────────────────────────────────────────────────

// List enrollments
app.get('/enrollments', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const courseId = c.req.query('courseId')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let userFilter = sql``
  let courseFilter = sql``
  let statusFilter = sql``
  if (userId) userFilter = sql`AND te.user_id = ${userId}`
  if (courseId) courseFilter = sql`AND te.course_id = ${courseId}`
  if (status) statusFilter = sql`AND te.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT te.*,
           u.first_name || ' ' || u.last_name as user_name,
           tc.title as course_title,
           tc.category as course_category,
           tc.is_required as course_required
    FROM training_enrollments te
    LEFT JOIN "user" u ON u.id = te.user_id
    LEFT JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.company_id = ${currentUser.companyId}
      ${userFilter} ${courseFilter} ${statusFilter}
    ORDER BY te.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM training_enrollments te
    WHERE te.company_id = ${currentUser.companyId}
      ${userFilter} ${courseFilter} ${statusFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Enrollment detail
app.get('/enrollments/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT te.*,
           u.first_name || ' ' || u.last_name as user_name,
           tc.title as course_title,
           tc.category as course_category,
           tc.content as course_content,
           tc.passing_score
    FROM training_enrollments te
    LEFT JOIN "user" u ON u.id = te.user_id
    LEFT JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.id = ${id} AND te.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const enrollment = ((result as any).rows || result)?.[0]
  if (!enrollment) return c.json({ error: 'Enrollment not found' }, 404)

  return c.json(enrollment)
})

// Update progress
app.put('/enrollments/:id/progress', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const progressSchema = z.object({
    currentStep: z.number().int().min(0),
    answers: z.record(z.any()).optional(), // step -> answer mapping
    timeSpent: z.number().int().min(0).optional(), // minutes
  })
  const data = progressSchema.parse(await c.req.json())

  // Fetch enrollment + course
  const enrollmentResult = await db.execute(sql`
    SELECT te.*, tc.content, tc.passing_score
    FROM training_enrollments te
    LEFT JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.id = ${id} AND te.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const enrollment = ((enrollmentResult as any).rows || enrollmentResult)?.[0]
  if (!enrollment) return c.json({ error: 'Enrollment not found' }, 404)

  const content = typeof enrollment.content === 'string' ? JSON.parse(enrollment.content) : enrollment.content
  const totalSteps = Array.isArray(content) ? content.length : 0
  const percentComplete = totalSteps > 0 ? Math.round((data.currentStep / totalSteps) * 100) : 0
  const totalTimeSpent = (enrollment.time_spent_minutes || 0) + (data.timeSpent || 0)

  let status = enrollment.status
  let score: number | null = null
  let completedAt: string | null = null

  // If all steps done, evaluate quiz scores
  if (data.currentStep >= totalSteps && data.answers) {
    // Grade quiz questions
    let totalQuestions = 0
    let correctAnswers = 0

    for (const step of content) {
      if (step.type === 'quiz' && step.questions) {
        for (const q of step.questions) {
          totalQuestions++
          const userAnswer = data.answers[`${step.step}-${q.question}`]
          if (userAnswer === q.correctIndex) correctAnswers++
        }
      }
    }

    score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 100
    const passingScore = enrollment.passing_score || 80

    if (score >= passingScore) {
      status = 'completed'
      completedAt = 'NOW()'
    } else {
      status = 'failed'
    }
  } else if (data.currentStep > 0 && status === 'assigned') {
    status = 'in_progress'
  }

  const result = await db.execute(sql`
    UPDATE training_enrollments SET
      current_step = ${data.currentStep},
      percent_complete = ${Math.min(percentComplete, 100)},
      answers = COALESCE(answers, '{}'::jsonb) || ${data.answers ? JSON.stringify(data.answers) : '{}'}::jsonb,
      time_spent_minutes = ${totalTimeSpent},
      score = COALESCE(${score}, score),
      status = ${status},
      completed_at = ${status === 'completed' ? sql`NOW()` : sql`completed_at`},
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'training_enrollment',
    entityId: id,
    metadata: { currentStep: data.currentStep, percentComplete, status, score },
    req: c.req,
  })

  return c.json(updated)
})

// My training (current user's courses)
app.get('/my-training', async (c) => {
  const currentUser = c.get('user') as any

  const dataResult = await db.execute(sql`
    SELECT te.*,
           tc.title as course_title,
           tc.description as course_description,
           tc.category as course_category,
           tc.is_required as course_required,
           tc.estimated_minutes,
           tc.renewal_months
    FROM training_enrollments te
    LEFT JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.user_id = ${currentUser.userId}
      AND te.company_id = ${currentUser.companyId}
      AND tc.is_active = true
    ORDER BY
      CASE te.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'failed' THEN 2 WHEN 'completed' THEN 3 END,
      te.created_at DESC
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  return c.json({ data })
})

// Compliance status
app.get('/compliance-status', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Users with overdue required courses (assigned but not completed)
  const overdueResult = await db.execute(sql`
    SELECT
      u.id as user_id,
      u.first_name || ' ' || u.last_name as user_name,
      u.role,
      tc.id as course_id,
      tc.title as course_title,
      te.status,
      te.created_at as assigned_at,
      EXTRACT(DAY FROM NOW() - te.created_at)::int as days_since_assigned
    FROM training_enrollments te
    JOIN "user" u ON u.id = te.user_id
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.company_id = ${currentUser.companyId}
      AND tc.is_required = true
      AND te.status IN ('assigned', 'in_progress', 'failed')
      AND te.created_at < NOW() - INTERVAL '7 days'
    ORDER BY te.created_at ASC
  `)

  // Expiring certifications (completed courses that recertify every renewal_months)
  const expiringResult = await db.execute(sql`
    SELECT
      u.id as user_id,
      u.first_name || ' ' || u.last_name as user_name,
      tc.id as course_id,
      tc.title as course_title,
      te.completed_at,
      tc.renewal_months,
      te.completed_at + (tc.renewal_months || ' months')::interval as expires_at,
      CASE
        WHEN te.completed_at + (tc.renewal_months || ' months')::interval < NOW() THEN 'expired'
        WHEN te.completed_at + (tc.renewal_months || ' months')::interval < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'valid'
      END as certification_status
    FROM training_enrollments te
    JOIN "user" u ON u.id = te.user_id
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.company_id = ${currentUser.companyId}
      AND te.status = 'completed'
      AND tc.renewal_months IS NOT NULL
      AND te.completed_at + (tc.renewal_months || ' months')::interval < NOW() + INTERVAL '90 days'
    ORDER BY te.completed_at + (tc.renewal_months || ' months')::interval ASC
  `)

  const overdueRows = (overdueResult as any).rows || overdueResult
  const expiringRows = (expiringResult as any).rows || expiringResult

  return c.json({
    overdue: overdueRows.map(camel),
    expiring: expiringRows.map(camel),
    summary: {
      overdueCount: overdueRows.length,
      expiringCount: expiringRows.filter((e: any) => e.certification_status === 'expiring_soon').length,
      expiredCount: expiringRows.filter((e: any) => e.certification_status === 'expired').length,
    },
  })
})

// Completion certificate data
app.get('/certificates/:enrollmentId', async (c) => {
  const currentUser = c.get('user') as any
  const enrollmentId = c.req.param('enrollmentId')

  const result = await db.execute(sql`
    SELECT te.*,
           u.first_name || ' ' || u.last_name as user_name,
           u.email as user_email,
           tc.title as course_title,
           tc.category as course_category,
           tc.renewal_months,
           comp.name as company_name
    FROM training_enrollments te
    JOIN "user" u ON u.id = te.user_id
    JOIN training_courses tc ON tc.id = te.course_id
    JOIN company comp ON comp.id = te.company_id
    WHERE te.id = ${enrollmentId} AND te.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const enrollment = ((result as any).rows || result)?.[0]
  if (!enrollment) return c.json({ error: 'Enrollment not found' }, 404)
  if (enrollment.status !== 'completed') return c.json({ error: 'Course not completed' }, 400)

  let expiresAt: string | null = null
  if (enrollment.renewal_months) {
    const d = new Date(enrollment.completed_at)
    d.setMonth(d.getMonth() + Number(enrollment.renewal_months))
    expiresAt = d.toISOString()
  }

  return c.json({
    certificateId: enrollment.id,
    userName: enrollment.user_name,
    userEmail: enrollment.user_email,
    courseTitle: enrollment.course_title,
    courseCategory: enrollment.course_category,
    companyName: enrollment.company_name,
    score: enrollment.score,
    completedAt: enrollment.completed_at,
    expiresAt,
    issuedBy: enrollment.company_name,
  })
})

// ─── Budtender Training page endpoints ───────────────────────────────────────
// The training_enrollments schema stores step position inside the `progress` json
// ({ currentStep, answers }); there is no current_step/answers/updated_at column.
// currentStep is 1-based (the step the learner is on); completedSteps = currentStep - 1.

const parseJson = (v: any, fallback: any): any => {
  if (v == null) return fallback
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return fallback } }
  return v
}

// GET /my-courses — the current user's enrollments shaped for the "My Training" tab.
app.get('/my-courses', async (c) => {
  const currentUser = c.get('user') as any

  const dataResult = await db.execute(sql`
    SELECT te.id, te.course_id, te.status, te.percent_complete, te.progress, te.completed_at,
           tc.title AS course_title, tc.category AS course_category,
           tc.estimated_minutes, tc.content
    FROM training_enrollments te
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.user_id = ${currentUser.userId}
      AND te.company_id = ${currentUser.companyId}
      AND tc.is_active = true
    ORDER BY
      CASE te.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'failed' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
      te.created_at DESC
  `)
  const rows = (dataResult as any).rows || dataResult

  const data = rows.map((r: any) => {
    const content = parseJson(r.content, [])
    const progress = parseJson(r.progress, {})
    const totalSteps = Array.isArray(content) ? content.length : 0
    const currentStep = Number(progress?.currentStep ?? 1)
    const completed = r.status === 'completed' || (totalSteps > 0 && currentStep > totalSteps)
    const completedSteps = completed ? totalSteps : Math.max(0, currentStep - 1)
    return {
      id: r.id,
      courseId: r.course_id,
      courseTitle: r.course_title,
      courseCategory: r.course_category,
      estimatedMinutes: r.estimated_minutes,
      status: r.status,
      completed,
      currentStep,
      totalSteps,
      completedSteps,
    }
  })

  return c.json({ data })
})

// GET /compliance — per-employee required-course compliance (Compliance tab).
// Manager-level data; non-managers receive an empty list (no leak, no error toast).
app.get('/compliance', async (c) => {
  const currentUser = c.get('user') as any
  const canView = ['owner', 'admin', 'manager'].includes(String(currentUser.role || '').toLowerCase())
  if (!canView) return c.json({ data: [] })

  const usersResult = await db.execute(sql`
    SELECT id, first_name || ' ' || last_name AS name, role
    FROM "user"
    WHERE company_id = ${currentUser.companyId} AND is_active = true
    ORDER BY first_name ASC
  `)
  const users = (usersResult as any).rows || usersResult

  const coursesResult = await db.execute(sql`
    SELECT id, title, renewal_months
    FROM training_courses
    WHERE company_id = ${currentUser.companyId} AND is_active = true AND is_required = true
  `)
  const reqCourses = (coursesResult as any).rows || coursesResult

  const enrollResult = await db.execute(sql`
    SELECT te.user_id, te.course_id, te.status, te.created_at, te.completed_at,
           tc.title AS course_title, tc.renewal_months
    FROM training_enrollments te
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.company_id = ${currentUser.companyId}
      AND tc.is_required = true AND tc.is_active = true
  `)
  const enrollments = (enrollResult as any).rows || enrollResult

  const now = Date.now()
  const byUser: Record<string, any[]> = {}
  for (const e of enrollments) { (byUser[e.user_id] ||= []).push(e) }

  const data = users.map((u: any) => {
    const userEnrolls = byUser[u.id] || []
    const enrollByCourse: Record<string, any> = {}
    for (const e of userEnrolls) enrollByCourse[e.course_id] = e

    const courses = reqCourses.map((rc: any) => {
      const e = enrollByCourse[rc.id]
      let status = 'not_started'
      let overdue = false
      if (e) {
        if (e.status === 'completed') status = 'completed'
        else if (e.status === 'in_progress') status = 'in_progress'
        else status = 'not_started'
        if (e.status !== 'completed') {
          const assignedMs = e.created_at ? new Date(e.created_at).getTime() : now
          overdue = (now - assignedMs) > 7 * 86400000
        }
      }
      return { title: rc.title, status, overdue }
    })

    const certifications = userEnrolls
      .filter((e: any) => e.status === 'completed' && e.renewal_months && e.completed_at)
      .map((e: any) => {
        const exp = new Date(e.completed_at)
        exp.setMonth(exp.getMonth() + Number(e.renewal_months))
        return {
          name: e.course_title,
          expiring: exp.getTime() < now + 30 * 86400000,
          expiresAt: exp.toISOString().split('T')[0],
        }
      })

    const allComplete = courses.length > 0 && courses.every((cc: any) => cc.status === 'completed')
    const hasOverdue = courses.some((cc: any) => cc.overdue)

    return {
      employeeId: u.id,
      employeeName: u.name,
      role: u.role,
      courses,
      certifications,
      allComplete,
      hasOverdue,
    }
  })

  return c.json({ data })
})

// GET /courses/:id/content — course content shaped as { steps: [...] } for the player.
app.get('/courses/:id/content', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT id, title, category, content
    FROM training_courses
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    LIMIT 1
  `)
  const course = ((result as any).rows || result)?.[0]
  if (!course) return c.json({ error: 'Course not found' }, 404)

  const content = parseJson(course.content, [])
  const steps = (Array.isArray(content) ? content : []).map((s: any, i: number) => {
    const order = Number(s?.step ?? s?.order ?? (i + 1))
    const type = s?.type || 'text'
    const step: any = { order, type, title: s?.title || '' }
    if (type === 'quiz') {
      const q = Array.isArray(s?.questions) ? s.questions[0] : null
      step.question = q?.question ?? s?.question ?? ''
      step.options = q?.options ?? s?.options ?? []
      step.correctIndex = q?.correctIndex ?? s?.correctIndex ?? 0
    } else if (type === 'video') {
      step.videoUrl = s?.mediaUrl ?? s?.videoUrl ?? null
      step.body = s?.body ?? null
    } else {
      step.body = s?.body ?? null
    }
    return step
  })

  return c.json({ id: course.id, title: course.title, category: course.category, steps })
})

// POST /assign — assign a course to specific users and/or every user in a role.
app.post('/assign', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const assignSchema = z.object({
    courseId: z.string().min(1),
    userIds: z.array(z.string().min(1)).optional(),
    role: z.string().optional(),
  })
  const data = assignSchema.parse(await c.req.json())

  const courseResult = await db.execute(sql`
    SELECT id, title FROM training_courses
    WHERE id = ${data.courseId} AND company_id = ${currentUser.companyId} AND is_active = true
    LIMIT 1
  `)
  const course = ((courseResult as any).rows || courseResult)?.[0]
  if (!course) return c.json({ error: 'Course not found' }, 404)

  let targetIds: string[] = []
  if (data.userIds && data.userIds.length > 0) {
    targetIds = data.userIds
  } else if (data.role) {
    const usersResult = await db.execute(sql`
      SELECT id FROM "user"
      WHERE company_id = ${currentUser.companyId} AND role = ${data.role} AND is_active = true
    `)
    targetIds = ((usersResult as any).rows || usersResult).map((u: any) => u.id)
  } else {
    return c.json({ error: 'Provide userIds or a role' }, 400)
  }

  const initialProgress = JSON.stringify({ currentStep: 1, answers: {} })
  let enrolled = 0
  for (const userId of targetIds) {
    const existingResult = await db.execute(sql`
      SELECT id FROM training_enrollments
      WHERE course_id = ${data.courseId} AND user_id = ${userId} AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    if (((existingResult as any).rows || existingResult)?.[0]) continue
    await db.execute(sql`
      INSERT INTO training_enrollments(id, course_id, user_id, company_id, status, percent_complete, progress, assigned_by, created_at)
      VALUES (gen_random_uuid(), ${data.courseId}, ${userId}, ${currentUser.companyId}, 'assigned', 0, ${initialProgress}::jsonb, ${currentUser.userId}, NOW())
    `)
    enrolled++
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'training_enrollment',
    entityName: `Assigned "${course.title}" to ${enrolled} user(s)`,
    metadata: { courseId: data.courseId, role: data.role || null, userIds: data.userIds || null, enrolled },
    req: c.req,
  })

  return c.json({ message: `Assigned to ${enrolled} user(s)`, enrolled }, 201)
})

// POST /enrollments/:id/advance — mark the current (non-quiz) step done and advance.
app.post('/enrollments/:id/advance', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT te.*, tc.content
    FROM training_enrollments te
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.id = ${id} AND te.company_id = ${currentUser.companyId} AND te.user_id = ${currentUser.userId}
    LIMIT 1
  `)
  const enrollment = ((result as any).rows || result)?.[0]
  if (!enrollment) return c.json({ error: 'Enrollment not found' }, 404)

  const content = parseJson(enrollment.content, [])
  const totalSteps = Array.isArray(content) ? content.length : 0
  const progress = parseJson(enrollment.progress, {})
  const newStep = Number(progress?.currentStep ?? 1) + 1
  const completed = totalSteps > 0 && newStep > totalSteps
  const completedSteps = completed ? totalSteps : Math.max(0, newStep - 1)
  const percent = totalSteps > 0 ? Math.min(100, Math.round((completedSteps / totalSteps) * 100)) : 100
  const status = completed ? 'completed' : 'in_progress'
  const newProgress = JSON.stringify({ ...progress, currentStep: newStep })

  const upd = await db.execute(sql`
    UPDATE training_enrollments SET
      progress = ${newProgress}::jsonb,
      percent_complete = ${percent},
      status = ${status},
      started_at = COALESCE(started_at, NOW()),
      completed_at = ${completed ? sql`NOW()` : sql`completed_at`}
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND user_id = ${currentUser.userId}
    RETURNING *
  `)
  const updated = camel(((upd as any).rows || upd)?.[0])

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'training_enrollment',
    entityId: id,
    metadata: { currentStep: newStep, percent, status },
    req: c.req,
  })

  return c.json(updated)
})

// POST /enrollments/:id/quiz — record a quiz answer and advance past the quiz step.
app.post('/enrollments/:id/quiz', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const quizSchema = z.object({
    stepOrder: z.number().int().min(1),
    answers: z.record(z.any()).default({}),
  })
  const data = quizSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    SELECT te.*, tc.content
    FROM training_enrollments te
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.id = ${id} AND te.company_id = ${currentUser.companyId} AND te.user_id = ${currentUser.userId}
    LIMIT 1
  `)
  const enrollment = ((result as any).rows || result)?.[0]
  if (!enrollment) return c.json({ error: 'Enrollment not found' }, 404)

  const content = parseJson(enrollment.content, [])
  const totalSteps = Array.isArray(content) ? content.length : 0
  const progress = parseJson(enrollment.progress, {})

  const quizStep = (Array.isArray(content) ? content : []).find(
    (s: any) => Number(s?.step ?? s?.order) === data.stepOrder
  )
  let correct = false
  if (quizStep) {
    const q = Array.isArray(quizStep.questions) ? quizStep.questions[0] : null
    const correctIndex = q?.correctIndex ?? quizStep?.correctIndex ?? 0
    const chosen = (data.answers as any)?.['0'] ?? (data.answers as any)?.[0]
    correct = Number(chosen) === Number(correctIndex)
  }

  const newStep = data.stepOrder + 1
  const completed = totalSteps > 0 && newStep > totalSteps
  const completedSteps = completed ? totalSteps : Math.max(0, newStep - 1)
  const percent = totalSteps > 0 ? Math.min(100, Math.round((completedSteps / totalSteps) * 100)) : 100
  const status = completed ? 'completed' : 'in_progress'
  const answersLog = { ...(progress?.answers || {}), [data.stepOrder]: { answers: data.answers, correct } }
  const newProgress = JSON.stringify({ ...progress, currentStep: newStep, answers: answersLog })

  const upd = await db.execute(sql`
    UPDATE training_enrollments SET
      progress = ${newProgress}::jsonb,
      percent_complete = ${percent},
      status = ${status},
      started_at = COALESCE(started_at, NOW()),
      completed_at = ${completed ? sql`NOW()` : sql`completed_at`}
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND user_id = ${currentUser.userId}
    RETURNING *
  `)
  const updated = camel(((upd as any).rows || upd)?.[0])

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'training_enrollment',
    entityId: id,
    metadata: { stepOrder: data.stepOrder, correct, status },
    req: c.req,
  })

  return c.json(updated)
})

export default app
