import { eq } from 'drizzle-orm'
import { tables, useDb } from '../../utils/db'
import { createSession, verifyPassword } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string, password?: string }>(event)
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
  }
  const user = useDb()
    .select()
    .from(tables.users)
    .where(eq(tables.users.email, email))
    .get()
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }
  await createSession(event, user.id)
  return { id: user.id, email: user.email, name: user.name, role: user.role }
})