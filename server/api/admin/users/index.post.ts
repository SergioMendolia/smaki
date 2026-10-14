import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { tables, useDb } from '../../../utils/db'
import { hashPassword, normalizeUsername, requireAdmin } from '../../../utils/auth'

/** create a user (admin only) */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ username?: string, password?: string, role?: string }>(event)
  const username = normalizeUsername(body.username)
  const password = body.password ?? ''
  const role = body.role === 'admin' ? 'admin' : 'member'

  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  const db = useDb()
  if (db.select().from(tables.users).where(eq(tables.users.username, username)).get()) {
    throw createError({ statusCode: 409, statusMessage: 'This username is already taken' })
  }
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: await hashPassword(password),
    role,
    createdAt: new Date()
  }
  db.insert(tables.users).values(user).run()
  return { id: user.id, username, role }
})