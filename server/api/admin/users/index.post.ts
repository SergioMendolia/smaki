import crypto from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { tables, useDb } from '../../../utils/db'
import { hashPassword, requireAdmin } from '../../../utils/auth'

const EMAIL_RE = /.+@.+\..+/

/** create a user (admin only) */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ email?: string, name?: string, password?: string, role?: string }>(event)
  const email = body.email?.trim().toLowerCase() ?? ''
  const name = body.name?.trim() || email.split('@')[0] || ''
  const password = body.password ?? ''
  const role = body.role === 'admin' ? 'admin' : 'member'

  if (!EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email is required' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  const db = useDb()
  if (db.select().from(tables.users).where(eq(tables.users.email, email)).get()) {
    throw createError({ statusCode: 409, statusMessage: 'This email is already registered' })
  }
  const user = {
    id: crypto.randomUUID(),
    email,
    name,
    passwordHash: await hashPassword(password),
    role,
    createdAt: new Date()
  }
  db.insert(tables.users).values(user).run()
  return { id: user.id, email, name, role }
})