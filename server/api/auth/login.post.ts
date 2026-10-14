import { eq } from 'drizzle-orm'
import { tables, useDb } from '../../utils/db'
import { createSession, verifyPassword } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string, password?: string }>(event)
  const username = body.username?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Username and password are required' })
  }
  const user = useDb()
    .select()
    .from(tables.users)
    .where(eq(tables.users.username, username))
    .get()
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid username or password' })
  }
  await createSession(event, user.id)
  return { id: user.id, username: user.username, role: user.role }
})