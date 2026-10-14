import { tables, useDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

/** list all users (admin only) */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const users = useDb()
    .select({
      id: tables.users.id,
      username: tables.users.username,
      role: tables.users.role,
      createdAt: tables.users.createdAt
    })
    .from(tables.users)
    .all()
  const admins = users.filter(u => u.role === 'admin').length
  return users.map(u => ({ ...u, lastAdmin: u.role === 'admin' && admins === 1 }))
})