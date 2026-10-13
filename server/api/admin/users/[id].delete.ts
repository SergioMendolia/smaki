import { count, eq } from 'drizzle-orm'
import { tables, useDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

/** remove a user and their sessions (admin only) */
export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (id === me.id) throw createError({ statusCode: 400, statusMessage: 'You cannot delete your own account' })

  const db = useDb()
  const target = db.select().from(tables.users).where(eq(tables.users.id, id)).get()
  if (!target) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  if (target.role === 'admin') {
    const admins = db.select({ value: count() }).from(tables.users).where(eq(tables.users.role, 'admin')).get()?.value ?? 0
    if (admins <= 1) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot delete the last admin' })
    }
  }
  db.delete(tables.users).where(eq(tables.users.id, id)).run()
  return { id }
})