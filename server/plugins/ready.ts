import { count } from 'drizzle-orm'
import { ensureTypesense } from '../utils/bootstrap'
import { syncAll } from '../utils/indexer'
import { tables, useDb } from '../utils/db'
import { hashPassword } from '../utils/auth'

/** on boot: init db (migrations), seed the default admin, ensure typesense collections, sync the index */
export default defineNitroPlugin(async () => {
  const db = useDb()
  const users = db.select({ value: count() }).from(tables.users).get()?.value ?? 0
  if (users === 0) {
    db.insert(tables.users).values({
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: await hashPassword('SmakiAdmin'),
      role: 'admin',
      createdAt: new Date()
    }).run()
    console.log('[smaki] created default admin user "admin" (password: SmakiAdmin) — change it after first login')
  }
  let attempts = 0
  const attempt = async () => {
    try {
      await ensureTypesense()
      const stats = await syncAll()
      console.log('[smaki] index synced:', stats)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[smaki] typesense bootstrap failed: ${message}`)
      if (++attempts < 30) {
        console.log('[smaki] retrying typesense bootstrap in 30s...')
        setTimeout(attempt, 30_000)
      }
    }
  }
  await attempt()
})