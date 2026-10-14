import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { tables, useDb } from '../../../utils/db'

/**
 * per-document pdf vision override. Body: { vision: boolean | null }
 * (null = follow the global NUXT_PDF_VISION setting).
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody(event).catch(() => ({})) as { vision?: boolean | null }
  if (typeof body.vision !== 'boolean' && body.vision !== null) {
    throw createError({ statusCode: 400, statusMessage: 'vision must be a boolean or null' })
  }
  const db = useDb()
  const row = db.select().from(tables.files).where(eq(tables.files.id, id)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'File not indexed' })
  db.update(tables.files)
    .set({ vision: body.vision === null ? null : body.vision ? 1 : 0 })
    .where(eq(tables.files.id, id))
    .run()
  return { id, vision: body.vision === null ? null : Boolean(body.vision) }
})