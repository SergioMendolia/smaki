import { and, eq, gt } from 'drizzle-orm'
import { SESSION_COOKIE } from '../utils/auth'
import { tables, useDb } from '../utils/db'

/** resolve the session cookie and attach the user to the request context */
export default defineEventHandler(async (event) => {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return
  const db = useDb()
  const row = db
    .select()
    .from(tables.sessions)
    .innerJoin(tables.users, eq(tables.sessions.userId, tables.users.id))
    .where(and(eq(tables.sessions.token, token), gt(tables.sessions.expiresAt, new Date())))
    .get()
  if (row) {
    (event.context as Record<string, unknown>).user = {
      id: row.users.id,
      username: row.users.username,
      role: row.users.role
    }
  } else {
    db.delete(tables.sessions)
      .where(eq(tables.sessions.token, token))
      .run()
  }
})