import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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
  if (required !== undefined) requiredFilter = sql`AND c.required = ${required === 'true'}`

  const dataResult = await db.execute(sql`
    SELECT c.*,
           (SELECT COUNT(*)::int FROM training_enrollments te WHERE te.course_id = c.id) as enrollment_count,
           (SELECT COUNT(*)::int FROM training_enrollments te WHERE te.course_id = c.id AND te.status = 'completed') as completed_count
    FROM training_courses c
    WHERE c.company_id = ${currentUser.companyId}
      AND c.active = true
      ${categoryFilter} ${requiredFilter}
    ORDER BY c.sort_order ASC, c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM training_courses c
    WHERE c.company_id = ${currentUser.companyId} AND c.active = true
      ${categoryFilter} ${requiredFilter}
  `)

  const data = (dataResult as any).rows || dataResult
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
    })),
    passingScore: z.number().int().min(0).max(100).default(80),
    estimatedMinutes: z.number().int().min(1).optional(),
    expiresAfterDays: z.number().int().optional(), // certification expiry
    sortOrder: z.number().int().default(0),
  })
  const data = courseSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO training_courses(id, title, description, category, required, content, passing_score, estimated_minutes, expires_after_days, sort_order, active, company_id, created_by_id, created_at)
    VALUES (gen_random_uuid(), ${data.title}, ${data.description || null}, ${data.category}, ${data.required}, ${JSON.stringify(data.content)}::jsonb, ${data.passingScore}, ${data.estimatedMinutes || null}, ${data.expiresAfterDays || null}, ${data.sortOrder}, true, ${currentUser.companyId}, ${currentUser.userId}, NOW())
    RETURNING *
  `)
  const course = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'training_course',
    entityId: course?.id,
    entityName: data.title,
    metadata: { category: data.category, required: data.required, steps: data.content.length },
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
      required = COALESCE(${data.required ?? null}, required),
      content = COALESCE(${data.content ? JSON.stringify(data.content) : null}::jsonb, content),
      passing_score = COALESCE(${data.passingScore ?? null}, passing_score),
      estimated_minutes = COALESCE(${data.estimatedMinutes ?? null}, estimated_minutes),
      expires_after_days = COALESCE(${data.expiresAfterDays ?? null}, expires_after_days),
      sort_order = COALESCE(${data.sortOrder ?? null}, sort_order),
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
    UPDATE training_courses SET active = false, updated_at = NOW()
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
    userIds: z.array(z.string().uuid()).min(1),
  })
  const data = assignSchema.parse(await c.req.json())

  // Verify course exists
  const courseResult = await db.execute(sql`
    SELECT * FROM training_courses WHERE id = ${id} AND company_id = ${currentUser.companyId} AND active = true LIMIT 1
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
    SELECT * FROM training_courses WHERE id = ${id} AND company_id = ${currentUser.companyId} AND active = true LIMIT 1
  `)
  const course = ((courseResult as any).rows || courseResult)?.[0]
  if (!course) return c.json({ error: 'Course not found' }, 404)

  // Get all users with the specified role
  const usersResult = await db.execute(sql`
    SELECT id FROM "user" WHERE company_id = ${currentUser.companyId} AND role = ${data.role} AND active = true
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
           tc.required as course_required
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

  const data = (dataResult as any).rows || dataResult
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
           tc.required as course_required,
           tc.estimated_minutes,
           tc.expires_after_days
    FROM training_enrollments te
    LEFT JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.user_id = ${currentUser.userId}
      AND te.company_id = ${currentUser.companyId}
      AND tc.active = true
    ORDER BY
      CASE te.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'failed' THEN 2 WHEN 'completed' THEN 3 END,
      te.created_at DESC
  `)

  const data = (dataResult as any).rows || dataResult
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
      AND tc.required = true
      AND te.status IN ('assigned', 'in_progress', 'failed')
      AND te.created_at < NOW() - INTERVAL '7 days'
    ORDER BY te.created_at ASC
  `)

  // Expiring certifications (completed courses with expiry dates)
  const expiringResult = await db.execute(sql`
    SELECT
      u.id as user_id,
      u.first_name || ' ' || u.last_name as user_name,
      tc.id as course_id,
      tc.title as course_title,
      te.completed_at,
      tc.expires_after_days,
      te.completed_at + (tc.expires_after_days || ' days')::interval as expires_at,
      CASE
        WHEN te.completed_at + (tc.expires_after_days || ' days')::interval < NOW() THEN 'expired'
        WHEN te.completed_at + (tc.expires_after_days || ' days')::interval < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'valid'
      END as certification_status
    FROM training_enrollments te
    JOIN "user" u ON u.id = te.user_id
    JOIN training_courses tc ON tc.id = te.course_id
    WHERE te.company_id = ${currentUser.companyId}
      AND te.status = 'completed'
      AND tc.expires_after_days IS NOT NULL
      AND te.completed_at + (tc.expires_after_days || ' days')::interval < NOW() + INTERVAL '90 days'
    ORDER BY te.completed_at + (tc.expires_after_days || ' days')::interval ASC
  `)

  const overdue = (overdueResult as any).rows || overdueResult
  const expiring = (expiringResult as any).rows || expiringResult

  return c.json({
    overdue,
    expiring,
    summary: {
      overdueCount: overdue.length,
      expiringCount: expiring.filter((e: any) => e.certification_status === 'expiring_soon').length,
      expiredCount: expiring.filter((e: any) => e.certification_status === 'expired').length,
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
           tc.expires_after_days,
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

  const expiresAt = enrollment.expires_after_days
    ? new Date(new Date(enrollment.completed_at).getTime() + enrollment.expires_after_days * 86400000).toISOString()
    : null

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

export default app
