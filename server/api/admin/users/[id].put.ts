import { count, eq } from 'drizzle-orm'
import { tables, useDb } from '../../../utils/db'
import { hashPassword, requireAdmin } from '../../../utils/auth'

/** edit a user's name/role, optionally reset the password (admin only) */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ name?: string, role?: string, password?: string }>(event)

  const db = useDb()
  const target = db.select().from(tables.users).where(eq(tables.users.id, id)).get()
  if (!target) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : target.role
  const name = body.name?.trim() || target.name

  // never end up with zero admins
  if (target.role === 'admin' && role !== 'admin') {
    const admins = db.select({ value: count() }).from(tables.users).where(eq(tables.users.role, 'admin')).get()?.value ?? 0
    if (admins <= 1) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot demote the last admin' })
    }
  }

  const update: Record<string, unknown> = { name, role }
  if (body.password) {
    if (body.password.length < 8) {
      throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
    }
    update.passwordHash = await hashPassword(body.password)
  }
  db.update(tables.users).set(update).where(eq(tables.users.id, id)).run()
  return { id, email: target.email, name, role }
})